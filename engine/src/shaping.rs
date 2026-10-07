//! Shared nonlinear shaping: a sine wavefolder with first-order ADAA, 2× oversampled (FOLD, COMPLEX's timbre).

use std::f64::consts::FRAC_PI_2;

/// y = sin(π/2·(g·x + sym)), g = 1 + 8·fold.
pub struct Folder {
    x_prev: f64,
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
            x_prev: 0.0,
            u_prev: 0.0,
        }
    }

    pub fn process(&mut self, x: f32, fold: f32, sym: f32) -> f32 {
        let (x, g, sym) = (x as f64, 1.0 + 8.0 * fold as f64, sym as f64);
        // 2×: the midpoint, then the sample; each through ADAA; averaged back down
        let mid = 0.5 * (self.x_prev + x);
        let a = self.adaa(g * mid + sym);
        let b = self.adaa(g * x + sym);
        self.x_prev = x;
        (0.5 * (a + b)) as f32
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
            if i > 100 {
                worst = worst.max((y - naive_fold(x, 0.7, 0.2)).abs());
            }
        }
        assert!(worst < 0.08, "off the curve by {worst}");
    }

    #[test]
    fn at_fold_zero_it_is_a_gentle_monotonic_shaper() {
        let mut f = Folder::new();
        for _ in 0..4 {
            f.process(-1.0, 0.0, 0.0); // settle the state at the start of the ramp
        }
        let mut prev = -2.0;
        for i in 0..=200 {
            let x = -1.0 + i as f32 / 100.0;
            // a slow ramp: ADAA's half-sample delay barely shows
            let y = f.process(x, 0.0, 0.0);
            assert!(y >= prev - 1e-3 && y.abs() <= 1.0 + 1e-3, "x {x}: {y}");
            prev = y;
        }
        assert!(prev > 0.95, "full scale maps to full scale: {prev}");
    }
}
