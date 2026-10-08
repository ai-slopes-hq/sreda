//! Shared nonlinear shaping: a real 2× oversampler (half-band FIR), first-order ADAA of a curve, and the curves —
//! the sine wavefolder (FOLD, COMPLEX's timbre), tanh / asymmetric / hard clip (DRIVE, FILTER's drive).

use std::f64::consts::FRAC_PI_2;

/// y = sin(π/2·(g·x + sym)), g = 1 + 8·fold.
pub struct Folder {
    os: Os2x,
    u_prev: f64,
}

impl Default for Folder {
    fn default() -> Self {
        Self::new()
    }
}

impl Folder {
    pub fn new() -> Self {
        Folder {
            os: Os2x::new(),
            u_prev: 0.0,
        }
    }

    pub fn process(&mut self, x: f32, fold: f32, sym: f32) -> f32 {
        let (g, sym) = (1.0 + 8.0 * fold as f64, sym as f64);
        // 2× up, the curve through ADAA at the higher rate, back down
        let u = self.os.up(x);
        let a = self.adaa(g * u[0] as f64 + sym);
        let b = self.adaa(g * u[1] as f64 + sym);
        self.os.down([a as f32, b as f32])
    }

    /// First-order ADAA of sin(π/2·u): the mean of the curve between the previous and this argument.
    fn adaa(&mut self, u: f64) -> f64 {
        // F(u) = −cos(π/2·u) / (π/2), the antiderivative
        let antideriv = |v: f64| -(FRAC_PI_2 * v).cos() / FRAC_PI_2;
        let du = u - self.u_prev;
        let y = if du.abs() > 1e-5 {
            (antideriv(u) - antideriv(self.u_prev)) / du
        } else {
            (FRAC_PI_2 * 0.5 * (u + self.u_prev)).sin()
        };
        self.u_prev = u;
        y
    }

    pub fn reset(&mut self) {
        *self = Folder::new();
    }
}

/// The same curve, sample by sample, with neither ADAA nor oversampling (for comparison in tests).
pub fn naive_fold(x: f32, fold: f32, sym: f32) -> f32 {
    let g = 1.0 + 8.0 * fold as f64;
    (FRAC_PI_2 * (g * x as f64 + sym as f64)).sin() as f32
}

/// 2× oversampling with a 63-tap half-band FIR (Kaiser window, ≈ 80 dB stopband): `up` turns one sample into two at
/// twice the rate, `down` turns two back into one. Each direction delays by 31 samples at the higher rate, so a round
/// trip delays by `Os2x::LATENCY` samples at the base rate.
pub struct Os2x {
    /// base-rate inputs (up) and even / odd high-rate samples (down), each written twice so a window is contiguous
    x: [f64; 2 * SIDE],
    y0: [f64; 2 * SIDE],
    y1: [f64; 2 * SIDE],
    /// where `up` and `down` write next (independent: one up may feed several downs, one per output)
    upos: usize,
    dpos: usize,
}

const TAPS: usize = 63;
/// the half-band's non-zero side taps h[0], h[2], …, h[62]; the centre h[31] is the only odd one
const SIDE: usize = TAPS.div_ceil(2);
const CENTRE: usize = TAPS / 2;
/// h[62], h[60], …, h[0] (polyphase: the even phase, reversed) and h[31], computed once
static HALF_BAND: std::sync::OnceLock<([f64; SIDE], f64)> = std::sync::OnceLock::new();

fn half_band() -> &'static ([f64; SIDE], f64) {
    HALF_BAND.get_or_init(|| {
        // Kaiser window, β = 8; I0 by its series
        let i0 = |x: f64| {
            let (mut sum, mut term) = (1.0, 1.0);
            for k in 1..32 {
                term *= (x / 2.0) * (x / 2.0) / (k * k) as f64;
                sum += term;
            }
            sum
        };
        let beta = 8.0;
        let m = (TAPS - 1) as f64 / 2.0;
        let mut h = [0.0; TAPS];
        for (n, v) in h.iter_mut().enumerate() {
            let t = n as f64 - m;
            let sinc = if t == 0.0 {
                0.5
            } else {
                (std::f64::consts::FRAC_PI_2 * t).sin() / (std::f64::consts::PI * t)
            };
            let w = i0(beta * (1.0 - (t / m) * (t / m)).max(0.0).sqrt()) / i0(beta);
            *v = sinc * w;
        }
        let sum: f64 = h.iter().sum();
        // the even taps, reversed (oldest first) so a window is read forwards; unity gain at DC
        let mut even = [0.0; SIDE];
        for (k, e) in even.iter_mut().enumerate() {
            *e = h[2 * (SIDE - 1 - k)] / sum;
        }
        (even, h[CENTRE] / sum)
    })
}

impl Default for Os2x {
    fn default() -> Self {
        Self::new()
    }
}

impl Os2x {
    /// base-rate samples a value takes through `up` then `down`
    pub const LATENCY: usize = TAPS / 2;

    pub fn new() -> Self {
        half_band();
        Os2x {
            x: [0.0; 2 * SIDE],
            y0: [0.0; 2 * SIDE],
            y1: [0.0; 2 * SIDE],
            upos: 0,
            dpos: 0,
        }
    }

    /// Σ h_even[k] · buf[newest − k]: the window buf[pos + 1 ..= pos + SIDE] (oldest first) against the reversed taps
    fn even(buf: &[f64; 2 * SIDE], pos: usize) -> f64 {
        let (h, _) = half_band();
        let w = &buf[pos + 1..pos + 1 + SIDE];
        h.iter().zip(w).map(|(a, b)| a * b).sum()
    }

    fn push(buf: &mut [f64; 2 * SIDE], pos: usize, v: f64) {
        buf[pos] = v;
        buf[pos + SIDE] = v;
    }

    pub fn up(&mut self, x: f32) -> [f32; 2] {
        // zero-stuffed by 2 (the gain 2 gives the level back): the even output uses the side taps, the odd one only
        // the centre tap, i.e. the input 15 samples ago
        let (_, centre) = *half_band();
        let p = self.upos;
        Self::push(&mut self.x, p, x as f64);
        let even = 2.0 * Self::even(&self.x, p);
        let odd = 2.0 * centre * self.x[(p + SIDE - 15) % SIDE];
        self.upos = (p + 1) % SIDE;
        [even as f32, odd as f32]
    }

    pub fn down(&mut self, y: [f32; 2]) -> f32 {
        // the even output: side taps over the even samples, the centre over the odd sample 16 back
        let (_, centre) = *half_band();
        let p = self.dpos;
        Self::push(&mut self.y0, p, y[0] as f64);
        Self::push(&mut self.y1, p, y[1] as f64);
        let out = Self::even(&self.y0, p) + centre * self.y1[(p + SIDE - 16) % SIDE];
        self.dpos = (p + 1) % SIDE;
        out as f32
    }

    pub fn reset(&mut self) {
        *self = Os2x::new();
    }
}

/// A memoryless curve and its antiderivative, for first-order ADAA.
pub trait Curve {
    fn f(x: f64) -> f64;
    fn big_f(x: f64) -> f64;
}

/// SAT: tanh.
pub struct Tanh;
impl Curve for Tanh {
    fn f(x: f64) -> f64 {
        x.tanh()
    }
    fn big_f(x: f64) -> f64 {
        // ln cosh x, without overflow for large |x|
        let a = x.abs();
        a + (-2.0 * a).exp().ln_1p() - std::f64::consts::LN_2
    }
}

/// OD: an asymmetric tube-like curve — tanh above zero, a harder tanh(1.6x)/1.6 below.
pub struct Asym;
impl Curve for Asym {
    fn f(x: f64) -> f64 {
        if x >= 0.0 {
            x.tanh()
        } else {
            (1.6 * x).tanh() / 1.6
        }
    }
    fn big_f(x: f64) -> f64 {
        if x >= 0.0 {
            Tanh::big_f(x)
        } else {
            Tanh::big_f(1.6 * x) / (1.6 * 1.6)
        }
    }
}

/// FUZZ: a hard clip at ±1.
pub struct Clip;
impl Curve for Clip {
    fn f(x: f64) -> f64 {
        x.clamp(-1.0, 1.0)
    }
    fn big_f(x: f64) -> f64 {
        if x.abs() <= 1.0 {
            0.5 * x * x
        } else {
            x.abs() - 0.5
        }
    }
}

/// First-order antiderivative antialiasing of a curve: the mean of the curve between the previous and this input.
pub struct Adaa1<C: Curve> {
    x1: f64,
    f1: f64,
    _c: std::marker::PhantomData<C>,
}

impl<C: Curve> Default for Adaa1<C> {
    fn default() -> Self {
        Self::new()
    }
}

impl<C: Curve> Adaa1<C> {
    pub fn new() -> Self {
        Adaa1 {
            x1: 0.0,
            f1: C::big_f(0.0),
            _c: std::marker::PhantomData,
        }
    }
    pub fn process(&mut self, x: f64) -> f64 {
        let fx = C::big_f(x);
        let dx = x - self.x1;
        let y = if dx.abs() > 1e-5 {
            (fx - self.f1) / dx
        } else {
            C::f(0.5 * (x + self.x1))
        };
        self.x1 = x;
        self.f1 = fx;
        y
    }
    pub fn reset(&mut self) {
        *self = Self::new();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const SR: f64 = 48_000.0;

    /// Energy below `hz` from a Hann-windowed DFT of `s`.
    fn energy_below(s: &[f32], hz: f64) -> f64 {
        let n = s.len();
        let bins = (hz * n as f64 / SR) as usize;
        let w = |i: usize| 0.5 - 0.5 * (std::f64::consts::TAU * i as f64 / n as f64).cos();
        (1..bins)
            .map(|k| {
                let (mut re, mut im) = (0.0, 0.0);
                for (i, x) in s.iter().enumerate() {
                    let a = std::f64::consts::TAU * k as f64 * i as f64 / n as f64;
                    re += *x as f64 * w(i) * a.cos();
                    im -= *x as f64 * w(i) * a.sin();
                }
                re * re + im * im
            })
            .sum()
    }

    fn tone(hz: f64, n: usize, amp: f64) -> Vec<f32> {
        (0..n)
            .map(|i| (amp * (std::f64::consts::TAU * hz * i as f64 / SR).sin()) as f32)
            .collect()
    }
    /// the amplitude of `hz` in `s` at `rate` (a single DFT bin, Hann window)
    fn level(s: &[f32], hz: f64, rate: f64) -> f64 {
        let n = s.len();
        let (mut re, mut im, mut wsum) = (0.0, 0.0, 0.0);
        for (i, x) in s.iter().enumerate() {
            let w = 0.5 - 0.5 * (std::f64::consts::TAU * i as f64 / n as f64).cos();
            let a = std::f64::consts::TAU * hz * i as f64 / rate;
            re += *x as f64 * w * a.cos();
            im -= *x as f64 * w * a.sin();
            wsum += w;
        }
        2.0 * (re * re + im * im).sqrt() / wsum
    }

    #[test]
    fn up_then_down_returns_the_signal_delayed() {
        let mut o = Os2x::new();
        let x = tone(1000.0, 4800, 0.8);
        let y: Vec<f32> = x
            .iter()
            .map(|v| {
                let u = o.up(*v);
                o.down(u)
            })
            .collect();
        for i in 200..4800 {
            assert!(
                (y[i] - x[i - Os2x::LATENCY]).abs() < 0.01,
                "{i}: {} vs {}",
                y[i],
                x[i - Os2x::LATENCY]
            );
        }
    }

    #[test]
    fn the_half_band_passes_20_khz_and_stops_its_image() {
        let mut o = Os2x::new();
        let x = tone(20_000.0, 9600, 1.0);
        let mut up = Vec::new();
        let mut back = Vec::new();
        for v in &x {
            let u = o.up(*v);
            up.extend_from_slice(&u);
            back.push(o.down(u));
        }
        let pass = level(&back[400..], 20_000.0, SR);
        assert!(pass > 10f64.powf(-1.0 / 20.0), "20 kHz at {pass}");
        let image = level(&up[800..], 28_000.0, 2.0 * SR);
        let main = level(&up[800..], 20_000.0, 2.0 * SR);
        assert!(image < main * 1e-3, "image {image} vs {main}");
    }

    fn derivative_matches<C: Curve>() {
        for x in [-3.0, -0.7, -0.1, 0.05, 0.4, 0.99, 2.5] {
            let h = 1e-4;
            let d = (C::big_f(x + h) - C::big_f(x - h)) / (2.0 * h);
            assert!((d - C::f(x)).abs() < 1e-3, "at {x}: {d} vs {}", C::f(x));
        }
    }

    #[test]
    fn each_curves_antiderivative_matches_it() {
        derivative_matches::<Tanh>();
        derivative_matches::<Asym>();
        derivative_matches::<Clip>();
    }

    #[test]
    fn oversampled_adaa_tanh_aliases_less_than_naive_tanh() {
        let x = tone(5000.0, 4800 + 480, 1.0);
        let (mut os, mut a) = (Os2x::new(), Adaa1::<Tanh>::new());
        let good: Vec<f32> = x
            .iter()
            .map(|v| {
                let u = os.up(*v);
                os.down([
                    a.process(10.0 * u[0] as f64) as f32,
                    a.process(10.0 * u[1] as f64) as f32,
                ])
            })
            .skip(480)
            .collect();
        let bad: Vec<f32> = x
            .iter()
            .map(|v| (10.0 * *v as f64).tanh() as f32)
            .skip(480)
            .collect();
        let (g, b) = (energy_below(&good, 4000.0), energy_below(&bad, 4000.0));
        assert!(
            g < b * 10f64.powf(-12.0 / 10.0),
            "aliasing {g} vs naive {b}"
        );
    }

    #[test]
    fn oversampled_adaa_aliases_less_than_the_naive_folder() {
        let n = 4800;
        let x: Vec<f32> = (0..n + 480)
            .map(|i| (std::f64::consts::TAU * 5000.0 * i as f64 / SR).sin() as f32)
            .collect();
        let mut f = Folder::new();
        let good: Vec<f32> = x
            .iter()
            .map(|v| f.process(*v, 1.0, 0.0))
            .skip(480)
            .collect();
        let bad: Vec<f32> = x
            .iter()
            .map(|v| naive_fold(*v, 1.0, 0.0))
            .skip(480)
            .collect();
        // a 5 kHz input folds into odd harmonics ≥ 5 kHz: anything below 4 kHz is aliasing
        let (g, b) = (energy_below(&good, 4000.0), energy_below(&bad, 4000.0));
        assert!(g < 0.5 * b, "aliasing {g} vs naive {b}");
    }

    #[test]
    fn on_a_slow_signal_it_follows_the_curve() {
        let mut f = Folder::new();
        let mut worst: f32 = 0.0;
        for i in 0..4800 {
            let x = (std::f64::consts::TAU * 30.0 * i as f64 / SR).sin() as f32;
            let y = f.process(x, 0.7, 0.2);
            // the oversampler delays by its latency
            let xd = (std::f64::consts::TAU * 30.0 * (i as f64 - Os2x::LATENCY as f64) / SR).sin()
                as f32;
            if i > 100 {
                worst = worst.max((y - naive_fold(xd, 0.7, 0.2)).abs());
            }
        }
        assert!(worst < 0.08, "off the curve by {worst}");
    }

    #[test]
    fn at_fold_zero_it_is_a_gentle_monotonic_shaper() {
        let mut f = Folder::new();
        for _ in 0..80 {
            f.process(-1.0, 0.0, 0.0); // settle the state (and the oversampler) at the start of the ramp
        }
        let mut prev = -2.0;
        for i in 0..=200 {
            let x = -1.0 + i as f32 / 100.0;
            // a slow ramp: ADAA's half-sample delay barely shows
            let y = f.process(x, 0.0, 0.0);
            assert!(y >= prev - 1e-3 && y.abs() <= 1.0 + 1e-3, "x {x}: {y}");
            prev = y;
        }
        for _ in 0..80 {
            prev = f.process(1.0, 0.0, 0.0); // the oversampler's latency
        }
        assert!(prev > 0.95, "full scale maps to full scale: {prev}");
    }
}
