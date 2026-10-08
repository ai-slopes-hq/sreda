//! FILTER: one module, six models (spec §7a), LP / BP / HP at once. CUT follows PTCH (octaves); DRV drives the
//! nonlinear models; changing MODEL crossfades 10 ms from the old model to the new one. The nonlinear models (LADDER,
//! DIODE, SK) run at 2× through the shared half-band oversampler.

mod ladder;
mod sk;
mod svf;

use crate::dsp::{Ctx, Dsp, Io};
use crate::shaping::Os2x;
use crate::spec::{choice, knob, port, ModuleSpec, Role, Unit};
use ladder::Ladder;
use sk::Sk;
use svf::Svf;

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
const MODELS: usize = 6;

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
    up: Os2x,
    model: usize,
    /// the model being faded out, and the samples left
    old: usize,
    fade_left: u32,
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
            up: Os2x::new(),
            model: SVF,
            old: SVF,
            fade_left: 0,
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
        match (model, u) {
            (LADDER, Some(u)) => self.ladder.process(u, fc, res, drive, sr),
            (DIODE, Some(u)) => self.diode.process(u, fc, res, drive, sr),
            (SK, Some(u)) => self.sk.process(u, fc, res, drive, sr),
            // COMB and VOWEL arrive in their own task; until then they are the SVF
            _ => self.svf.process(x, fc, res, drive, sr),
        }
    }
}

const fn oversampled(m: usize) -> bool {
    matches!(m, LADDER | DIODE | SK)
}

impl Dsp for Filter {
    fn process(&mut self, io: &mut Io, _ctx: &mut Ctx, from: usize, to: usize) {
        let model = (io.fixed[0].round().max(0.0) as usize).min(MODELS - 1);
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
        let (model, sr) = (self.model, self.sample_rate);
        *self = Filter::new(sr);
        self.model = model;
        self.old = model;
        self.ladder.reset();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
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
                let hp = gain_db(sr, m, 0.0, HP, 100.0);
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
    fn the_svf_is_the_filter_it_was_bit_for_bit() {
        // the Plan 3 FILTER, inline: an old patch (no MODEL, no DRV, no PTCH) must sound the same
        let (sr, mut ic1, mut ic2) = (48_000.0f64, 0.0f64, 0.0f64);
        let mut b = Bench::new(sr, 2, &[700.0, 0.7, 0.0], &[0.0], 3);
        b.connected_in = vec![true, false];
        let x = |n: usize| ((n * 7919) % 101) as f32 / 50.0 - 1.0;
        let o = b.run(&mut Filter::new(sr), 20, |blk, i, inp| {
            inp[0][i] = x(blk * BLOCK + i)
        });
        for (n, got) in o[LP].iter().enumerate() {
            let fc = 700.0f64.clamp(10.0, 0.49 * sr);
            let k = 2.0 - 1.96 * (0.7f32 as f64);
            let g = (std::f64::consts::PI * fc / sr).tan();
            let a1 = 1.0 / (1.0 + g * (g + k));
            let (a2, xv) = (g * a1, x(n) as f64);
            let a3 = g * a2;
            let v3 = xv - ic2;
            let v1 = a1 * ic1 + a2 * v3;
            let v2 = ic2 + a2 * ic1 + a3 * v3;
            ic1 = 2.0 * v1 - ic1 + 1e-20;
            ic2 = 2.0 * v2 - ic2 + 1e-20;
            assert_eq!(*got, v2 as f32, "sample {n}");
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
