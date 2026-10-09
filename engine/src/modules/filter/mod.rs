//! FILTER: one module, six models (spec §7a), LP / BP / HP at once. CUT follows PTCH (octaves); DRV drives the
//! nonlinear models; changing MODEL crossfades 10 ms from the old model to the new one. The nonlinear models (LADDER,
//! DIODE, SK) run at 2× through the shared half-band oversampler.

mod comb;
mod ladder;
mod sk;
mod svf;
mod vowel;

use crate::dsp::{Ctx, Dsp, Io};
use crate::shaping::Os2x;
use crate::spec::{choice, knob, port, ModuleSpec, Role, Unit};
use comb::Comb;
use ladder::Ladder;
use sk::Sk;
use svf::Svf;
use vowel::Vowel;

pub fn spec() -> ModuleSpec {
    ModuleSpec {
        type_: "filter",
        internal: false,
        label: "FILTER",
        desc: "SVF, ladder, diode, Sallen-Key, comb, vowel: LP, BP, HP at once",
        size: (5, 1),
        inputs: vec![
            port("in", "IN", Role::Audio),
            port("pitch", "PTCH", Role::Pitch),
        ],
        outputs: vec![
            port("lp", "LP", Role::Audio),
            port("bp", "BP", Role::Audio),
            port("hp", "HP", Role::Audio),
        ],
        params: vec![
            knob("cutoff", "CUT", 20.0, 20_000.0, 1000.0)
                .exp()
                .unit(Unit::Hz)
                .random(100.0, 8000.0)
                .mod_depth(0.25)
                .into(),
            knob("res", "RES", 0.0, 1.0, 0.2).into(),
            knob("drive", "DRV", 0.0, 1.0, 0.0).into(),
            choice(
                "model",
                "MODEL",
                &["SVF", "LADDER", "DIODE", "SK", "COMB", "VOWEL"],
                0,
            )
            .glyph("response")
            .into(),
        ],
        normals: vec![],
        display: None,
    }
}

/// One model: a sample in, LP / BP / HP out.
pub trait Model {
    fn process(&mut self, x: f64, fc: f64, res: f64, drive: f64, sr: f64) -> [f64; 3];
    fn reset(&mut self);
}

const SVF: usize = 0;
const LADDER: usize = 1;
const DIODE: usize = 2;
const SK: usize = 3;
const COMB: usize = 4;
const VOWEL: usize = 5;
const MODELS: usize = 6;

/// RES → each model's own resonance value and its passband gain, at RES 0, 1/40 … 1 (spec revision 28): fitted by
/// `print_res_tables` so SVF, LADDER, DIODE and SK all peak +7 dB at RES 0.5 and about +20 dB at 0.9 (at 1 kHz),
/// oscillate (the nonlinear ones) from 0.975, and keep their passband level at any RES.
const RES_POINTS: usize = 41;
// measured values; one of them happens to be close to 1/π
#[allow(clippy::approx_constant)]
const RES_LAW: [[(f64, f64); RES_POINTS]; 4] = [
    [
        (0.0000, 1.0121),
        (0.0860, 1.0082),
        (0.1680, 1.0048),
        (0.2500, 1.0018),
        (0.3320, 0.9990),
        (0.4140, 0.9965),
        (0.4700, 0.9950),
        (0.5140, 0.9939),
        (0.5500, 0.9931),
        (0.5800, 0.9925),
        (0.6080, 0.9919),
        (0.6340, 0.9914),
        (0.6560, 0.9910),
        (0.6780, 0.9907),
        (0.6960, 0.9904),
        (0.7140, 0.9901),
        (0.7320, 0.9899),
        (0.7480, 0.9897),
        (0.7620, 0.9895),
        (0.7760, 0.9893),
        (0.7880, 0.9892),
        (0.8100, 0.9890),
        (0.8300, 0.9888),
        (0.8480, 0.9886),
        (0.8640, 0.9885),
        (0.8780, 0.9884),
        (0.8900, 0.9883),
        (0.9020, 0.9883),
        (0.9140, 0.9882),
        (0.9240, 0.9882),
        (0.9320, 0.9881),
        (0.9400, 0.9881),
        (0.9460, 0.9881),
        (0.9540, 0.9880),
        (0.9600, 0.9880),
        (0.9640, 0.9880),
        (0.9700, 0.9880),
        (0.9800, 0.9880),
        (0.9900, 0.9880),
        (1.0000, 0.9880),
        (1.0000, 0.9880),
    ],
    [
        (0.0000, 1.0241),
        (0.0120, 1.0789),
        (0.0240, 1.1342),
        (0.0380, 1.1993),
        (0.0520, 1.2650),
        (0.0680, 1.3405),
        (0.0860, 1.4261),
        (0.1060, 1.5218),
        (0.1300, 1.6373),
        (0.1580, 1.7728),
        (0.1840, 1.8992),
        (0.2080, 2.0163),
        (0.2320, 2.1337),
        (0.2540, 2.2416),
        (0.2760, 2.3497),
        (0.2980, 2.4579),
        (0.3180, 2.5564),
        (0.3380, 2.6551),
        (0.3580, 2.7538),
        (0.3780, 2.8526),
        (0.3980, 2.9515),
        (0.4260, 3.0901),
        (0.4540, 3.2288),
        (0.4800, 3.3577),
        (0.5040, 3.4768),
        (0.5280, 3.5959),
        (0.5500, 3.7051),
        (0.5740, 3.8244),
        (0.5920, 3.9138),
        (0.6140, 4.0232),
        (0.6300, 4.1027),
        (0.6480, 4.1922),
        (0.6660, 4.2818),
        (0.6780, 4.3415),
        (0.6920, 4.4112),
        (0.7060, 4.4808),
        (0.7200, 4.5505),
        (0.7653, 4.5505),
        (0.8107, 4.5505),
        (0.8560, 4.5505),
        (1.0000, 4.5505),
    ],
    [
        (0.0000, 1.0549),
        (0.0080, 1.1235),
        (0.0160, 1.1934),
        (0.0240, 1.2646),
        (0.0340, 1.3549),
        (0.0420, 1.4281),
        (0.0520, 1.5206),
        (0.0640, 1.6327),
        (0.0740, 1.7269),
        (0.0880, 1.8599),
        (0.1020, 1.9938),
        (0.1180, 2.1478),
        (0.1360, 2.3220),
        (0.1600, 2.5555),
        (0.1860, 2.8098),
        (0.2100, 3.0453),
        (0.2360, 3.3012),
        (0.2600, 3.5379),
        (0.2840, 3.7751),
        (0.3080, 4.0126),
        (0.3320, 4.2503),
        (0.3600, 4.5280),
        (0.3880, 4.8060),
        (0.4140, 5.0643),
        (0.4400, 5.3228),
        (0.4660, 5.5814),
        (0.4900, 5.8202),
        (0.5140, 6.0592),
        (0.5360, 6.2782),
        (0.5580, 6.4974),
        (0.5780, 6.6967),
        (0.5960, 6.8760),
        (0.6160, 7.0754),
        (0.6320, 7.2349),
        (0.6480, 7.3944),
        (0.6680, 7.5939),
        (0.6780, 7.6936),
        (0.7347, 7.6936),
        (0.7913, 7.6936),
        (0.8480, 7.6936),
        (1.0000, 7.6936),
    ],
    [
        (0.0000, 1.0121),
        (0.0820, 1.0082),
        (0.1620, 1.0048),
        (0.2400, 1.0017),
        (0.3180, 0.9990),
        (0.3960, 0.9965),
        (0.4500, 0.9950),
        (0.4920, 0.9939),
        (0.5260, 0.9931),
        (0.5560, 0.9924),
        (0.5820, 0.9919),
        (0.6060, 0.9914),
        (0.6280, 0.9910),
        (0.6480, 0.9907),
        (0.6660, 0.9904),
        (0.6840, 0.9901),
        (0.7000, 0.9899),
        (0.7140, 0.9897),
        (0.7280, 0.9895),
        (0.7420, 0.9893),
        (0.7540, 0.9892),
        (0.7740, 0.9890),
        (0.7940, 0.9888),
        (0.8100, 0.9886),
        (0.8260, 0.9885),
        (0.8400, 0.9884),
        (0.8520, 0.9883),
        (0.8640, 0.9882),
        (0.8740, 0.9882),
        (0.8820, 0.9881),
        (0.8900, 0.9881),
        (0.8980, 0.9881),
        (0.9060, 0.9880),
        (0.9120, 0.9880),
        (0.9180, 0.9880),
        (0.9220, 0.9880),
        (0.9280, 0.9880),
        (0.9440, 0.9880),
        (0.9600, 0.9880),
        (0.9760, 0.9880),
        (1.0000, 0.9880),
    ],
];

/// The model's own resonance value and passband gain for RES `r`.
fn res_law(model: usize, r: f64) -> (f64, f64) {
    let t = r.clamp(0.0, 1.0) * (RES_POINTS - 1) as f64;
    let i = (t.floor() as usize).min(RES_POINTS - 2);
    let f = t - i as f64;
    let (a, b) = (RES_LAW[model][i], RES_LAW[model][i + 1]);
    (a.0 + (b.0 - a.0) * f, a.1 + (b.1 - a.1) * f)
}

/// A nonlinear model at 2×: its own down-samplers, one per output.
struct Oversampled<M: Model> {
    m: M,
    down: [Os2x; 3],
}

impl<M: Model + Default> Default for Oversampled<M> {
    fn default() -> Self {
        Oversampled {
            m: M::default(),
            down: [Os2x::new(), Os2x::new(), Os2x::new()],
        }
    }
}

impl<M: Model> Oversampled<M> {
    fn process(&mut self, u: [f32; 2], fc: f64, res: f64, drive: f64, sr: f64) -> [f64; 3] {
        let a = self.m.process(u[0] as f64, fc, res, drive, 2.0 * sr);
        let b = self.m.process(u[1] as f64, fc, res, drive, 2.0 * sr);
        let mut out = [0.0; 3];
        for (o, (d, (x, y))) in out
            .iter_mut()
            .zip(self.down.iter_mut().zip(a.iter().zip(&b)))
        {
            *o = d.down([*x as f32, *y as f32]) as f64;
        }
        out
    }
    fn reset(&mut self) {
        self.m.reset();
        for d in self.down.iter_mut() {
            d.reset();
        }
    }
}

pub struct Filter {
    sample_rate: f64,
    fade_len: u32,
    svf: Svf,
    ladder: Oversampled<Ladder<4>>,
    diode: Oversampled<Ladder<3>>,
    sk: Oversampled<Sk>,
    comb: Comb,
    vowel: Vowel,
    up: Os2x,
    model: usize,
    /// the model being faded out, and the samples left
    old: usize,
    fade_left: u32,
    /// the first block takes its model as it is (a new FILTER does not fade in from the SVF)
    started: bool,
    /// calibration: RES goes to the model as it is, without the law (`print_res_tables`)
    raw_res: bool,
}

impl Filter {
    pub fn new(sample_rate: f64) -> Self {
        Filter {
            sample_rate,
            fade_len: ((0.01 * sample_rate) as u32).max(1),
            svf: Svf::default(),
            ladder: Oversampled::default(),
            diode: Oversampled::default(),
            sk: Oversampled::default(),
            comb: Comb::new(sample_rate),
            vowel: Vowel::default(),
            up: Os2x::new(),
            model: SVF,
            old: SVF,
            fade_left: 0,
            started: false,
            raw_res: false,
        }
    }

    fn run(
        &mut self,
        model: usize,
        x: f64,
        u: Option<[f32; 2]>,
        fc: f64,
        res: f64,
        drive: f64,
    ) -> [f64; 3] {
        let sr = self.sample_rate;
        let (r, comp) = if self.raw_res || model >= COMB {
            (res, 1.0)
        } else {
            res_law(model, res)
        };
        // LADDER: half the passband gain goes in before the core, so it saturates at RES as PRD does
        let half = comp.sqrt();
        let mut y = match (model, u) {
            (LADDER, Some(u)) => {
                let mut y =
                    self.ladder
                        .process([u[0] * half as f32, u[1] * half as f32], fc, r, drive, sr);
                y[0] /= half;
                y
            }
            (DIODE, Some(u)) => self.diode.process(u, fc, r, drive, sr),
            (SK, Some(u)) => self.sk.process(u, fc, r, drive, sr),
            (COMB, _) => self.comb.process(x, fc, r, drive, sr),
            (VOWEL, _) => self.vowel.process(x, fc, r, drive, sr),
            _ => self.svf.process(x, fc, r, drive, sr),
        };
        // the passband keeps its level as RES rises (LP; BP and HP as they are)
        y[0] *= comp;
        y
    }
}

const fn oversampled(m: usize) -> bool {
    matches!(m, LADDER | DIODE | SK)
}

impl Dsp for Filter {
    fn process(&mut self, io: &mut Io, _ctx: &mut Ctx, from: usize, to: usize) {
        let model = (io.fixed[0].round().max(0.0) as usize).min(MODELS - 1);
        if !self.started {
            self.started = true;
            self.model = model;
            self.old = model;
        }
        for i in from..to {
            if model != self.model {
                self.old = self.model;
                self.model = model;
                self.fade_left = self.fade_len;
            }
            let x = io.inp[0][i] as f64;
            let fc = (io.par[0][i] as f64 * (io.inp[1][i] as f64).exp2())
                .clamp(10.0, 0.49 * self.sample_rate);
            let (res, drive) = (io.par[1][i] as f64, io.par[2][i] as f64);
            let need_up = oversampled(self.model) || (self.fade_left > 0 && oversampled(self.old));
            let u = need_up.then(|| self.up.up(x as f32));
            let mut y = self.run(self.model, x, u, fc, res, drive);
            if self.fade_left > 0 {
                let o = self.run(self.old, x, u, fc, res, drive);
                let t = self.fade_left as f64 / self.fade_len as f64;
                for (a, b) in y.iter_mut().zip(o) {
                    *a = *a * (1.0 - t) + b * t;
                }
                self.fade_left -= 1;
            }
            for (k, v) in y.iter().enumerate() {
                io.out[k][i] = *v as f32;
            }
        }
    }

    fn reset(&mut self) {
        // in place: reset runs on the audio thread (the NaN guard) and must not allocate the comb's lines again
        self.svf.reset();
        self.ladder.reset();
        self.diode.reset();
        self.sk.reset();
        self.comb.reset();
        self.vowel.reset();
        self.up.reset();
        self.fade_left = 0;
        self.old = self.model;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A model's small-signal response at its own resonance value `f` (RES without the law): the level at 1 kHz over
    /// 100 Hz in dB (cutoff 1 kHz), the passband gain at 110 Hz, and whether its impulse response stops decaying.
    fn measure(model: usize, f: f64) -> (f64, f64, bool) {
        measure_with(model, f, true)
    }
    fn measure_with(model: usize, f: f64, raw: bool) -> (f64, f64, bool) {
        let n = 256 * crate::dsp::BLOCK;
        let mut b =
            crate::dsp::bench::Bench::new(48_000.0, 2, &[1000.0, f, 0.0], &[model as f64], 3);
        b.connected_in = vec![true, false];
        let mut flt = Filter::new(48_000.0);
        flt.raw_res = raw;
        let amp = 1e-4;
        let o = b.run(&mut flt, 256, |blk, i, inp| {
            inp[0][i] = if blk == 0 && i == 0 { amp as f32 } else { 0.0 }
        });
        let h = |hz: f64| {
            let (mut re, mut im) = (0.0, 0.0);
            for (i, y) in o[0].iter().enumerate() {
                let a = std::f64::consts::TAU * hz * i as f64 / 48_000.0;
                re += *y as f64 * a.cos();
                im -= *y as f64 * a.sin();
            }
            (re * re + im * im).sqrt() / amp
        };
        let e = |a: usize, b: usize| o[0][a..b].iter().map(|y| (*y as f64).powi(2)).sum::<f64>();
        let rings = e(n - 4096, n) >= 0.5 * e(0, 4096);
        // the resonance's peak near the cutoff
        let peak = (0..=60)
            .map(|j| h(500.0 * 2f64.powf(j as f64 / 30.0)))
            .fold(0.0, f64::max);
        (20.0 * (peak / h(100.0)).log10(), h(110.0), rings)
    }

    #[test]
    fn res_means_the_same_on_every_model() {
        for m in [SVF, LADDER, DIODE, SK] {
            let (p50, _, _) = measure_with(m, 0.5, false);
            let (p90, _, _) = measure_with(m, 0.9, false);
            assert!(
                (p50 - 7.0).abs() <= 2.0,
                "model {m}: RES 0.5 peaks {p50:.1} dB"
            );
            assert!(
                (p90 - 20.0).abs() <= 3.0,
                "model {m}: RES 0.9 peaks {p90:.1} dB"
            );
            assert!(
                !measure_with(m, 0.95, false).2,
                "model {m} oscillates below 0.975"
            );
            if m != SVF {
                assert!(
                    measure_with(m, 1.0, false).2,
                    "model {m} oscillates at RES 1"
                );
            }
        }
    }

    /// A 110 Hz sine of 0.2117 peak (−16.5 dBFS RMS, as the references) through `model` at cutoff 1 kHz, DRV 0: the
    /// output RMS in dB and its 2nd and 3rd harmonics relative to the fundamental.
    fn sine_through(model: usize, res: f64) -> (f64, f64, f64) {
        let mut b =
            crate::dsp::bench::Bench::new(48_000.0, 2, &[1000.0, res, 0.0], &[model as f64], 3);
        b.connected_in = vec![true, false];
        let o = b.run(&mut Filter::new(48_000.0), 750, |blk, i, inp| {
            let n = (blk * crate::dsp::BLOCK + i) as f64;
            inp[0][i] = (0.2117 * (std::f64::consts::TAU * 110.0 * n / 48_000.0).sin()) as f32;
        });
        let y = &o[0][24_000..];
        let amp = |hz: f64| {
            let (mut re, mut im, mut ws) = (0.0, 0.0, 0.0);
            for (i, v) in y.iter().enumerate() {
                let w = 0.5 - 0.5 * (std::f64::consts::TAU * i as f64 / y.len() as f64).cos();
                let a = std::f64::consts::TAU * hz * i as f64 / 48_000.0;
                re += *v as f64 * w * a.cos();
                im -= *v as f64 * w * a.sin();
                ws += w;
            }
            2.0 * (re * re + im * im).sqrt() / ws
        };
        let rms = (y.iter().map(|v| (*v as f64).powi(2)).sum::<f64>() / y.len() as f64).sqrt();
        let a1 = amp(110.0);
        (
            20.0 * rms.log10(),
            20.0 * (amp(220.0) / a1).log10(),
            20.0 * (amp(330.0) / a1).log10(),
        )
    }

    #[test]
    fn the_passband_keeps_its_level_at_any_res() {
        for m in [SVF, LADDER, DIODE, SK] {
            let (l0, _, _) = sine_through(m, 0.0);
            for r in [0.5, 0.9] {
                let (l, _, _) = sine_through(m, r);
                assert!(
                    (l - l0).abs() <= 1.0,
                    "model {m} at RES {r}: {:.2} dB",
                    l - l0
                );
            }
        }
    }

    #[test]
    fn each_model_saturates_like_its_reference() {
        // the 2nd and 3rd harmonics of Ableton's SVF / PRD / DFM / MS2 renders at RES 0, 0.5, 0.9 (projects/refs/filter)
        let refs: [(usize, [(f64, f64); 3]); 4] = [
            (SVF, [(-120.9, -128.2), (-119.9, -125.6), (-119.8, -125.4)]),
            (LADDER, [(-55.5, -48.7), (-67.5, -63.0), (-73.6, -71.7)]),
            (DIODE, [(-87.6, -58.5), (-87.7, -55.1), (-84.7, -54.8)]),
            (SK, [(-75.0, -127.9), (-75.0, -68.9), (-75.2, -61.2)]),
        ];
        for (m, rows) in refs {
            for (r, (h2, h3)) in [0.0, 0.5, 0.9].into_iter().zip(rows) {
                let (_, o2, o3) = sine_through(m, r);
                for (ours, theirs, k) in [(o2, h2, 2), (o3, h3, 3)] {
                    let ok = if theirs < -100.0 {
                        ours < -90.0
                    } else {
                        (ours - theirs).abs() <= 6.0
                    };
                    assert!(
                        ok,
                        "model {m} RES {r}: harmonic {k} at {ours:.1} dB, reference {theirs:.1}"
                    );
                }
            }
        }
    }

    /// Fits RES_LAW: prints it as Rust.
    #[test]
    #[ignore = "calibration: prints RES_LAW"]
    fn print_res_tables() {
        let mut out = String::from("const RES_LAW: [[(f64, f64); RES_POINTS]; 4] = [\n");
        for m in [SVF, LADDER, DIODE, SK] {
            // the model's curve over its own resonance value
            let grid: Vec<(f64, f64, f64, bool)> = (0..=500)
                .map(|j| {
                    let f = j as f64 / 500.0;
                    let (at, pass, rings) = measure(m, f);
                    (f, at, pass, rings)
                })
                .collect();
            let osc = grid.iter().find(|g| g.3).map_or(1.0, |g| g.0);
            let (p0, pass0) = (grid[0].1, grid[0].2);
            // the target at 1 kHz: from the model's own value at RES 0 to +7 dB at 0.5 and +20 dB at 0.9
            let target = |r: f64| {
                if r <= 0.5 {
                    p0 + (7.0 - p0) * r / 0.5
                } else {
                    7.0 + 13.0 * (r - 0.5) / 0.4
                }
            };
            let mut row = Vec::new();
            for j in 0..RES_POINTS {
                let r = j as f64 / (RES_POINTS - 1) as f64;
                let (f, pass) = if r <= 0.9 {
                    let t = target(r);
                    let g = grid
                        .iter()
                        .filter(|g| g.0 < osc * 0.98)
                        .min_by(|a, b| (a.1 - t).abs().total_cmp(&(b.1 - t).abs()))
                        .unwrap();
                    (g.0, g.2)
                } else {
                    // from the 0.9 point to the oscillation threshold at 0.975, then to the model's maximum
                    let f90 = row
                        .iter()
                        .rev()
                        .find(|_: &&(f64, f64)| true)
                        .map_or(0.0, |x: &(f64, f64)| x.0);
                    let _ = f90;
                    (f64::NAN, f64::NAN)
                };
                row.push((f, pass));
            }
            // the top: 0.9 → 0.975 reaches the threshold, 0.975 → 1 the maximum; the passband gain held from 0.9
            let i90 = (0.9 * (RES_POINTS - 1) as f64).round() as usize;
            let (f90, pass90) = row[i90];
            for (j, item) in row.iter_mut().enumerate().skip(i90 + 1) {
                let r = j as f64 / (RES_POINTS - 1) as f64;
                let f = if r <= 0.975 {
                    f90 + (osc - f90) * (r - 0.9) / 0.075
                } else {
                    osc + (1.0 - osc) * (r - 0.975) / 0.025
                };
                *item = (f, pass90);
            }
            out += "    [";
            for (f, pass) in &row {
                out += &format!("({f:.4}, {:.4}), ", pass0 / pass * (1.0 / pass0));
            }
            out += "],\n";
            eprintln!("model {m}: RES 0 at 1 kHz {p0:.1} dB, oscillates from {osc:.3}");
        }
        eprintln!("{out}];");
    }

    /// Renders each model the way the reference files were made (cutoff 1 kHz, RES 0 / 0.5 / 0.9, LP; white noise at
    /// 0.2 RMS and a 110 Hz sine at −16.5 dBFS RMS, 2 s) into `$SREDA_RENDER` as 24-bit WAVs, for
    /// `analyse.py` to compare with the references.
    #[test]
    #[ignore = "renders WAVs for the reference comparison"]
    fn render_for_the_references() {
        let Ok(dir) = std::env::var("SREDA_RENDER") else {
            return;
        };
        let names = ["svf", "ladder", "diode", "sk"];
        for (m, name) in names.iter().enumerate() {
            for (res, tag) in [(0.0, "0"), (0.5, "50"), (0.9, "90")] {
                for (kind, amp) in [("noise", 0.045), ("sine-110", 0.2117)] {
                    let mut b = crate::dsp::bench::Bench::new(
                        48_000.0,
                        2,
                        &[1000.0, res, 0.0],
                        &[m as f64],
                        3,
                    );
                    b.connected_in = vec![true, false];
                    let mut rng = crate::dsp::Rng::new(7);
                    let o = b.run(&mut Filter::new(48_000.0), 750, |blk, i, inp| {
                        let n = (blk * crate::dsp::BLOCK + i) as f64;
                        inp[0][i] = if kind == "noise" {
                            ((rng.next_f64() * 2.0 - 1.0) * amp * 3f64.sqrt()) as f32
                        } else {
                            (amp * (std::f64::consts::TAU * 110.0 * n / 48_000.0).sin()) as f32
                        };
                    });
                    let mut bytes = Vec::new();
                    let data = o[0].len() * 3;
                    bytes.extend_from_slice(b"RIFF");
                    bytes.extend_from_slice(&(36 + data as u32).to_le_bytes());
                    bytes.extend_from_slice(b"WAVEfmt ");
                    bytes.extend_from_slice(&16u32.to_le_bytes());
                    bytes.extend_from_slice(&1u16.to_le_bytes());
                    bytes.extend_from_slice(&1u16.to_le_bytes());
                    bytes.extend_from_slice(&48_000u32.to_le_bytes());
                    bytes.extend_from_slice(&(48_000u32 * 3).to_le_bytes());
                    bytes.extend_from_slice(&3u16.to_le_bytes());
                    bytes.extend_from_slice(&24u16.to_le_bytes());
                    bytes.extend_from_slice(b"data");
                    bytes.extend_from_slice(&(data as u32).to_le_bytes());
                    for x in &o[0] {
                        let v = (x.clamp(-1.0, 1.0) as f64 * 8_388_607.0) as i32;
                        bytes.extend_from_slice(&v.to_le_bytes()[..3]);
                    }
                    std::fs::write(format!("{dir}/{kind}-{name}-{tag}.wav"), bytes).unwrap();
                }
            }
        }
    }
    use crate::dsp::bench::Bench;
    use crate::dsp::BLOCK;

    const LP: usize = 0;
    const BP: usize = 1;
    const HP: usize = 2;
    const NAMES: [&str; 4] = ["SVF", "LADDER", "DIODE", "SK"];

    fn sine(hz: f64, sr: f64) -> impl Fn(usize, usize, &mut [[f32; BLOCK]]) {
        move |blk, i, inp| {
            inp[0][i] = (std::f64::consts::TAU * hz * (blk * BLOCK + i) as f64 / sr).sin() as f32
        }
    }

    /// The gain in dB of one output for a sine at `hz` through a 1 kHz filter of a model.
    fn gain_db(sr: f64, model: usize, res: f64, out: usize, hz: f64) -> f64 {
        let mut b = Bench::new(sr, 2, &[1000.0, res, 0.0], &[model as f64], 3);
        b.connected_in = vec![true, false];
        let o = b.run(
            &mut Filter::new(sr),
            (0.3 * sr) as usize / BLOCK,
            sine(hz, sr),
        );
        let tail = &o[out][o[out].len() / 2..];
        let rms =
            (tail.iter().map(|x| (*x as f64).powi(2)).sum::<f64>() / tail.len() as f64).sqrt();
        20.0 * (rms / std::f64::consts::FRAC_1_SQRT_2).log10()
    }

    /// The level of the test frequency alone (one DFT bin), so a saturating model's harmonics are not read as leakage.
    fn fundamental_db(sr: f64, model: usize, res: f64, out: usize, hz: f64) -> f64 {
        let mut b = Bench::new(sr, 2, &[1000.0, res, 0.0], &[model as f64], 3);
        b.connected_in = vec![true, false];
        // a moderate level (−12 dB): the frequency response, not a full-scale sine's saturation
        let o = b.run(
            &mut Filter::new(sr),
            (0.3 * sr) as usize / BLOCK,
            |blk, n, inp| {
                inp[0][n] = (0.25
                    * (std::f64::consts::TAU * hz * (blk * BLOCK + n) as f64 / sr).sin())
                    as f32
            },
        );
        let tail = &o[out][o[out].len() / 2..];
        let (mut re, mut im, mut ws) = (0.0, 0.0, 0.0);
        for (i, v) in tail.iter().enumerate() {
            let w = 0.5 - 0.5 * (std::f64::consts::TAU * i as f64 / tail.len() as f64).cos();
            let a = std::f64::consts::TAU * hz * i as f64 / sr;
            re += *v as f64 * w * a.cos();
            im -= *v as f64 * w * a.sin();
            ws += w;
        }
        20.0 * (2.0 * (re * re + im * im).sqrt() / ws / 0.25).log10()
    }

    #[test]
    fn lp_and_hp_split_at_the_cutoff_at_48k_and_44k1() {
        for sr in [48_000.0, 44_100.0] {
            assert!(gain_db(sr, SVF, 0.2, LP, 10_000.0) <= -30.0);
            assert!(gain_db(sr, SVF, 0.2, LP, 100.0).abs() <= 1.0);
            assert!(gain_db(sr, SVF, 0.2, HP, 100.0) <= -30.0);
            assert!(gain_db(sr, SVF, 0.2, HP, 10_000.0).abs() <= 1.0);
        }
    }

    #[test]
    fn each_model_has_its_slope() {
        for sr in [48_000.0, 44_100.0] {
            let at4 = |m| gain_db(sr, m, 0.0, LP, 4000.0);
            assert!(at4(LADDER) <= -40.0, "{sr} LADDER at 4×: {}", at4(LADDER));
            assert!(
                gain_db(sr, LADDER, 0.0, LP, 100.0).abs() <= 1.0,
                "{sr} LADDER passband"
            );
            assert!(at4(DIODE) <= -28.0, "{sr} DIODE at 4×: {}", at4(DIODE));
            assert!(at4(SK) <= -20.0, "{sr} SK at 4×: {}", at4(SK));
            assert!(at4(SVF) <= -20.0, "{sr} SVF at 4×: {}", at4(SVF));
            for m in [SVF, LADDER, DIODE, SK] {
                let hp = fundamental_db(sr, m, 0.0, HP, 100.0);
                assert!(hp <= -18.0, "{sr} {} HP at CUT/10: {hp}", NAMES[m]);
            }
        }
    }

    #[test]
    fn each_band_pass_peaks_near_the_cutoff() {
        for m in [SVF, LADDER, DIODE, SK] {
            let sweep: Vec<(f64, f64)> = (0..13)
                .map(|k| {
                    let hz = 1000.0 * 2f64.powf((k as f64 - 6.0) / 2.0);
                    (hz, gain_db(48_000.0, m, 0.5, BP, hz))
                })
                .collect();
            let peak = sweep
                .iter()
                .cloned()
                .fold((0.0, f64::MIN), |a, b| if b.1 > a.1 { b } else { a })
                .0;
            assert!(
                (500.0..=2000.0).contains(&peak),
                "{} BP peaks at {peak}",
                NAMES[m]
            );
        }
    }

    #[test]
    fn the_nonlinear_models_ring_at_the_cutoff_at_full_resonance() {
        for m in [LADDER, DIODE, SK] {
            let mut b = Bench::new(48_000.0, 2, &[1000.0, 1.0, 0.0], &[m as f64], 3);
            b.connected_in = vec![true, false];
            let o = b.run(&mut Filter::new(48_000.0), 400, |blk, i, inp| {
                inp[0][i] = if blk == 0 && i < 4 { 0.5 } else { 0.0 }
            });
            let tail = &o[LP][24_000..48_000];
            assert!(tail.iter().all(|x| x.is_finite()));
            let peak = tail.iter().fold(0.0f32, |a, x| a.max(x.abs()));
            assert!(peak > 0.01, "{} does not self-oscillate ({peak})", NAMES[m]);
            let crossings = tail
                .windows(2)
                .filter(|w| w[0] < 0.0 && w[1] >= 0.0)
                .count();
            let hz = crossings as f64 / 0.5;
            assert!(
                (850.0..=1150.0).contains(&hz),
                "{} rings at {hz} Hz",
                NAMES[m]
            );
        }
    }

    #[test]
    fn ptch_plus_one_doubles_the_cutoff() {
        let sr = 48_000.0;
        let lp_at = |hz: f64, pitch: f32| {
            let mut b = Bench::new(sr, 2, &[1000.0, 0.0, 0.0], &[SVF as f64], 3);
            b.connected_in = vec![true, true];
            let o = b.run(&mut Filter::new(sr), 112, |blk, i, inp| {
                inp[0][i] =
                    (std::f64::consts::TAU * hz * (blk * BLOCK + i) as f64 / sr).sin() as f32;
                inp[1][i] = pitch;
            });
            let t = &o[LP][o[LP].len() / 2..];
            (t.iter().map(|x| (*x as f64).powi(2)).sum::<f64>() / t.len() as f64).sqrt()
        };
        let a = lp_at(1000.0, 0.0);
        let b = lp_at(2000.0, 1.0);
        assert!((20.0 * (b / a).log10()).abs() < 1.0, "{a} vs {b}");
    }

    #[test]
    fn switching_models_at_full_resonance_stays_finite_and_smooth() {
        let mut b = Bench::new(48_000.0, 2, &[800.0, 1.0, 0.5], &[0.0], 3);
        b.connected_in = vec![true, false];
        let mut f = Filter::new(48_000.0);
        let mut r = crate::dsp::Rng::new(3);
        let mut prev = 0.0f32;
        for blk in 0..750 {
            b.fixed[0] = ((blk / 37) % 4) as f64; // a new model every ~100 ms
            let o = b.run(&mut f, 1, |_, i, inp| {
                inp[0][i] = ((r.next_f64() * 2.0 - 1.0) * 0.5) as f32
            });
            for x in &o[LP] {
                assert!(
                    x.is_finite() && (x - prev).abs() <= 0.5,
                    "block {blk}: {prev} → {x}"
                );
                prev = *x;
            }
        }
    }

    #[test]
    fn the_svf_is_the_cytomic_core_at_the_res_law() {
        // the Plan 3 FILTER, inline: the same Cytomic core, with RES now going through the resonance law (revision 28)
        let (sr, mut ic1, mut ic2) = (48_000.0f64, 0.0f64, 0.0f64);
        let mut b = Bench::new(sr, 2, &[700.0, 0.7, 0.0], &[0.0], 3);
        b.connected_in = vec![true, false];
        let x = |n: usize| ((n * 7919) % 101) as f32 / 50.0 - 1.0;
        let o = b.run(&mut Filter::new(sr), 20, |blk, i, inp| {
            inp[0][i] = x(blk * BLOCK + i)
        });
        for (n, got) in o[LP].iter().enumerate() {
            let fc = 700.0f64.clamp(10.0, 0.49 * sr);
            let k = 2.0 - 1.96 * res_law(SVF, 0.7f32 as f64).0;
            let g = (std::f64::consts::PI * fc / sr).tan();
            let a1 = 1.0 / (1.0 + g * (g + k));
            let (a2, xv) = (g * a1, x(n) as f64);
            let a3 = g * a2;
            let v3 = xv - ic2;
            let v1 = a1 * ic1 + a2 * v3;
            let v2 = ic2 + a2 * ic1 + a3 * v3;
            ic1 = 2.0 * v1 - ic1 + 1e-20;
            ic2 = 2.0 * v2 - ic2 + 1e-20;
            assert_eq!(
                *got,
                (v2 * res_law(SVF, 0.7f32 as f64).1) as f32,
                "sample {n}"
            );
        }
    }

    #[test]
    fn full_resonance_on_noise_stays_finite() {
        for m in [SVF, LADDER, DIODE, SK] {
            let mut b = Bench::new(48_000.0, 2, &[2000.0, 1.0, 1.0], &[m as f64], 3);
            b.connected_in = vec![true, false];
            let mut r = crate::dsp::Rng::new(5);
            let o = b.run(&mut Filter::new(48_000.0), 750, |_, i, inp| {
                inp[0][i] = (r.next_f64() * 2.0 - 1.0) as f32
            });
            assert!(
                o.iter()
                    .all(|s| s.iter().all(|x| x.is_finite() && x.abs() < 100.0)),
                "{}",
                NAMES[m]
            );
        }
    }

    /// Welch-averaged magnitude of `s` at each of `freqs` (Hann segments of 4800 samples)
    fn spectrum(s: &[f32], freqs: &[f64], sr: f64) -> Vec<f64> {
        let seg = 4800;
        freqs
            .iter()
            .map(|hz| {
                let mut acc = 0.0;
                let mut n = 0;
                for start in (0..s.len() - seg).step_by(seg / 2) {
                    let (mut re, mut im) = (0.0, 0.0);
                    for i in 0..seg {
                        let w = 0.5 - 0.5 * (std::f64::consts::TAU * i as f64 / seg as f64).cos();
                        let a = std::f64::consts::TAU * hz * i as f64 / sr;
                        re += s[start + i] as f64 * w * a.cos();
                        im -= s[start + i] as f64 * w * a.sin();
                    }
                    acc += (re * re + im * im).sqrt();
                    n += 1;
                }
                acc / n as f64
            })
            .collect()
    }
    fn noise_through(
        model: usize,
        cutoff: f64,
        res: f64,
        seconds: f64,
    ) -> (Vec<f32>, Vec<Vec<f32>>) {
        let sr = 48_000.0;
        let mut b = Bench::new(sr, 2, &[cutoff, res, 0.0], &[model as f64], 3);
        b.connected_in = vec![true, false];
        let mut r = crate::dsp::Rng::new(9);
        let mut x = Vec::new();
        let o = b.run(
            &mut Filter::new(sr),
            (seconds * sr) as usize / BLOCK,
            |_, i, inp| {
                inp[0][i] = ((r.next_f64() * 2.0 - 1.0) * 0.3) as f32;
                x.push(inp[0][i]);
            },
        );
        (x, o)
    }
    fn db(a: f64, b: f64) -> f64 {
        20.0 * (a / b).log10()
    }

    #[test]
    fn comb_peaks_at_the_harmonics_and_its_odd_twin_at_the_odd_halves() {
        let (x, o) = noise_through(COMB, 200.0, 0.9, 3.0);
        let lp = spectrum(&o[LP], &[200.0, 300.0, 400.0, 500.0, 600.0], 48_000.0);
        for (peak, trough) in [(0, 1), (2, 1), (2, 3), (4, 3)] {
            assert!(db(lp[peak], lp[trough]) >= 10.0, "LP {lp:?}");
        }
        let bp = spectrum(&o[BP], &[100.0, 200.0, 300.0, 400.0, 500.0], 48_000.0);
        for (peak, trough) in [(0, 1), (2, 1), (2, 3), (4, 3)] {
            assert!(db(bp[peak], bp[trough]) >= 10.0, "BP {bp:?}");
        }
        for (n, (h, l)) in o[HP].iter().zip(&o[LP]).enumerate() {
            assert!(
                (h - (l - x[n])).abs() < 1e-6,
                "HP is the comb minus dry at {n}"
            );
        }
    }

    /// the frequencies (in 25 Hz steps over 200…4000 Hz) of the three largest local maxima of a spectrum
    fn three_peaks(s: &[f32]) -> Vec<f64> {
        let freqs: Vec<f64> = (8..=160).map(|k| k as f64 * 25.0).collect();
        let m = spectrum(s, &freqs, 48_000.0);
        let mut maxima: Vec<(f64, f64)> = (1..m.len() - 1)
            .filter(|&k| m[k] >= m[k - 1] && m[k] >= m[k + 1])
            .map(|k| (freqs[k], m[k]))
            .collect();
        maxima.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap());
        let mut top: Vec<f64> = maxima.iter().take(3).map(|p| p.0).collect();
        top.sort_by(|a, b| a.partial_cmp(b).unwrap());
        top
    }

    #[test]
    fn vowel_morphs_from_a_to_u_across_cut() {
        let near = |got: &[f64], want: [f64; 3]| {
            got.iter().zip(want).all(|(g, w)| (g - w).abs() <= 0.1 * w)
        };
        let (_, a) = noise_through(VOWEL, 20.0, 0.7, 3.0);
        let pa = three_peaks(&a[LP]);
        assert!(near(&pa, [800.0, 1150.0, 2900.0]), "A: {pa:?}");
        let (_, u) = noise_through(VOWEL, 20_000.0, 0.7, 3.0);
        let pu = three_peaks(&u[LP]);
        assert!(near(&pu, [325.0, 700.0, 2530.0]), "U: {pu:?}");
    }

    #[test]
    fn comb_and_vowel_stay_finite_at_full_resonance() {
        for m in [COMB, VOWEL] {
            let (_, o) = noise_through(m, 300.0, 1.0, 2.0);
            assert!(o
                .iter()
                .all(|s| s.iter().all(|x| x.is_finite() && x.abs() < 100.0)));
        }
    }

    #[test]
    fn blockwise_equals_per_sample() {
        let x: Vec<f32> = (0..20 * BLOCK)
            .map(|i| ((i * 7919) % 101) as f32 / 50.0 - 1.0)
            .collect();
        for m in 0..MODELS {
            Bench::blockwise_equals_per_sample(
                || Box::new(Filter::new(48_000.0)),
                &[x.clone(), vec![]],
                &[700.0, 0.7, 0.4],
                &[m as f64],
                3,
                20,
            );
        }
    }
}
