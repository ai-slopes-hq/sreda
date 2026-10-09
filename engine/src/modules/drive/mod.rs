//! DRIVE (spec §7a, revision 26): seven models — SOFT, TUBE, OD, DIST, FUZZ, RECT, DIGI. Each: its pre-emphasis, GAIN
//! and BIAS into its curve (first-order ADAA at 2× oversampling), a DC blocker, its post voicing and TONE, then a level
//! matched across models and gains; MIX against the dry signal delayed to match. Changing MODEL crossfades 10 ms.

mod models;

use crate::dsp::{Ctx, Dsp, Io};
use crate::shaping::{Adaa1, Os2x};
use crate::spec::{choice, knob, port, ModuleSpec, Role, Unit};
use models::{Diode, Hard, SoftSine, Starved, Triode};

pub fn spec() -> ModuleSpec {
    ModuleSpec {
        type_: "drive",
        internal: false,
        label: "DRIVE",
        desc: "saturation, overdrive, distortion, fuzz",
        size: (6, 1),
        inputs: vec![port("in", "IN", Role::Audio)],
        outputs: vec![port("out", "OUT", Role::Audio)],
        params: vec![
            knob("gain", "GAIN", 0.0, 36.0, 12.0).unit(Unit::Db).into(),
            knob("bias", "BIAS", -1.0, 1.0, 0.0).into(),
            knob("tone", "TONE", 0.0, 1.0, 0.5).into(),
            knob("mix", "MIX", 0.0, 1.0, 1.0).into(),
            choice(
                "model",
                "MODEL",
                &["SOFT", "TUBE", "OD", "DIST", "FUZZ", "RECT", "DIGI"],
                2,
            )
            .into(),
        ],
        normals: vec![],
        display: None,
    }
}

pub const SOFT: usize = 0;
pub const TUBE: usize = 1;
pub const OD: usize = 2;
pub const DIST: usize = 3;
pub const FUZZ: usize = 4;
pub const RECT: usize = 5;
pub const DIGI: usize = 6;
const MODELS: usize = 7;

/// Per model: extra drive into the curve, built-in bias, and the level-match fit — the output RMS of a −6 dBFS sine
/// grows as `a·g` and saturates at `s`, joined by a soft minimum of order `p` (fitted to measured levels, see
/// `print_raw_levels`).
struct Voice {
    drive: f64,
    bias: f64,
    a: f64,
    s: f64,
    p: f64,
}
const VOICES: [Voice; MODELS] = [
    Voice {
        drive: 0.2,
        bias: 0.0,
        a: 0.1117,
        s: 1.0,
        p: 2.0,
    },
    Voice {
        drive: 1.0,
        bias: 0.1,
        a: 0.33,
        s: 0.78,
        p: 1.0,
    },
    Voice {
        drive: 1.0,
        bias: 0.0,
        a: 0.1087,
        s: 1.0,
        p: 2.0,
    },
    Voice {
        drive: 8.0,
        bias: 0.04,
        a: 1.867,
        s: 0.985,
        p: 2.0,
    },
    Voice {
        drive: 6.0,
        bias: 0.2,
        a: 2.27,
        s: 0.699,
        p: 2.0,
    },
    Voice {
        drive: 0.25,
        bias: 0.0,
        a: 0.0482,
        s: 0.5,
        p: 2.0,
    },
    Voice {
        drive: 2.0,
        bias: 0.0,
        a: 1.0,
        s: 1.0,
        p: 2.0,
    },
];

/// The level a −6 dBFS sine reaches through model `v` at linear gain `g`.
fn expected(v: &Voice, g: f64) -> f64 {
    ((v.a * g).powf(-v.p) + v.s.powf(-v.p)).powf(-1.0 / v.p)
}
/// the level DRIVE aims for: a −6 dBFS sine's RMS
const TARGET: f64 = 0.354;

/// One model's running state (two run while MODEL crossfades).
#[derive(Default)]
struct Chain {
    pre: f64,
    soft: Adaa1<SoftSine>,
    triode: Adaa1<Triode>,
    diode: Adaa1<Diode>,
    hard: Adaa1<Hard>,
    starved: Adaa1<Starved>,
    rect_x1: f64,
    rect_f1: f64,
    /// FUZZ's gate and TUBE's sag
    env: f64,
}

impl Chain {
    fn curve(&mut self, m: usize, x: f64, rect_a: f64) -> f64 {
        match m {
            SOFT => self.soft.process(x),
            TUBE => self.triode.process(x),
            OD | DIST => self.diode.process(x),
            FUZZ => self.starved.process(x),
            RECT => {
                let fx = models::rect_big_f(x, rect_a);
                let dx = x - self.rect_x1;
                let y = if dx.abs() > 1e-5 {
                    (fx - self.rect_f1) / dx
                } else {
                    models::rect(0.5 * (x + self.rect_x1), rect_a)
                };
                self.rect_x1 = x;
                self.rect_f1 = fx;
                // a soft ceiling after the fold-over
                y.tanh()
            }
            _ => self.hard.process(x),
        }
    }
}

pub struct Drive {
    sample_rate: f64,
    os: [Os2x; 2],
    chains: [Chain; 2],
    /// the dry signal, delayed by the oversampler's latency so MIX does not comb
    dry: [f32; Os2x::LATENCY],
    dry_pos: usize,
    /// DC blocker and post filter per chain
    dc: [(f64, f64); 2],
    post: [f64; 2],
    model: usize,
    old: usize,
    fade_left: u32,
    fade_len: u32,
    started: bool,
}

impl Drive {
    pub fn new(sample_rate: f64) -> Self {
        Drive {
            sample_rate,
            os: [Os2x::new(), Os2x::new()],
            chains: [Chain::default(), Chain::default()],
            dry: [0.0; Os2x::LATENCY],
            dry_pos: 0,
            dc: [(0.0, 0.0); 2],
            post: [0.0; 2],
            model: OD,
            old: OD,
            fade_left: 0,
            fade_len: ((0.01 * sample_rate) as u32).max(1),
            started: false,
        }
    }

    /// One sample of model `m` through chain `k`: (x, gain, bias, tone) → the level-matched wet signal.
    fn wet(&mut self, k: usize, m: usize, x: f64, g: f64, bias: f64, tone: f64) -> f64 {
        let sr = self.sample_rate;
        let v = &VOICES[m];
        let c = &mut self.chains[k];
        // pre-emphasis: OD lifts what is above ~720 Hz into the clip (a Tube Screamer's mid hump); DIST cuts below
        // ~100 Hz so the clip stays tight
        let pre = match m {
            OD | DIST => {
                let fc = if m == OD { 720.0 } else { 100.0 };
                let a = 1.0 - (-std::f64::consts::TAU * fc / sr).exp();
                c.pre += a * (x - c.pre);
                let hp = x - c.pre;
                if m == OD {
                    0.25 * x + hp
                } else {
                    hp
                }
            }
            _ => x,
        };
        // FUZZ gates and sputters as the input falls; TUBE sags under a loud input
        let level = x.abs();
        let (att, rel) = if m == TUBE {
            (0.01, 0.15)
        } else {
            (0.001, 0.05)
        };
        let coef = |t: f64| 1.0 - (-1.0 / (t * sr)).exp();
        c.env += (if level > c.env { coef(att) } else { coef(rel) }) * (level - c.env);
        let shape = match m {
            FUZZ => {
                let t = (c.env / 0.02).min(1.0);
                t * t * (3.0 - 2.0 * t)
            }
            TUBE => 1.0 - 0.25 * (c.env * g).min(1.0),
            _ => 1.0,
        };
        let rect_a = bias.max(0.0);
        // BIAS (and the model's own) shifts the signal before the gain, so the asymmetry holds at any GAIN
        let offset = if m == RECT { 0.0 } else { 0.25 * bias + v.bias };
        let into = (pre * shape + offset) * g * v.drive;
        let u = self.os[k].up(into as f32);
        let a = c.curve(m, u[0] as f64, rect_a);
        let b = c.curve(m, u[1] as f64, rect_a);
        let y = self.os[k].down([a as f32, b as f32]) as f64;
        // remove the bias's DC (5 Hz)
        let r = 1.0 - std::f64::consts::TAU * 5.0 / sr;
        let (x1, y1) = self.dc[k];
        let hp = y - x1 + r * y1;
        self.dc[k] = (y, hp);
        // voicing: OD / DIST a low-pass TONE (1…8 kHz), the others a tilt around 800 Hz (TONE 0 dark … 1 bright)
        let toned = match m {
            OD | DIST => {
                let fc = 1000.0 * 8f64.powf(tone);
                let a = 1.0 - (-std::f64::consts::TAU * fc / sr).exp();
                self.post[k] += a * (hp - self.post[k]);
                self.post[k]
            }
            _ => {
                let a = 1.0 - (-std::f64::consts::TAU * 800.0 / sr).exp();
                self.post[k] += a * (hp - self.post[k]);
                let t = (tone - 0.5) * 2.0;
                self.post[k] * 10f64.powf(-6.0 * t / 20.0)
                    + (hp - self.post[k]) * 10f64.powf(6.0 * t / 20.0)
            }
        };
        // level match: divide by the expected level of a −6 dBFS sine at this gain
        toned * TARGET / expected(v, g)
    }
}

impl Dsp for Drive {
    fn process(&mut self, io: &mut Io, _ctx: &mut Ctx, from: usize, to: usize) {
        let m = (io.fixed[0].round().max(0.0) as usize).min(MODELS - 1);
        if !self.started {
            self.started = true;
            self.model = m;
            self.old = m;
        }
        for i in from..to {
            if m != self.model {
                // the outgoing model keeps running in chain 1 while the new one starts fresh in chain 0
                self.chains.swap(0, 1);
                self.os.swap(0, 1);
                self.dc.swap(0, 1);
                self.post.swap(0, 1);
                self.chains[0] = Chain::default();
                self.os[0].reset();
                self.dc[0] = (0.0, 0.0);
                self.post[0] = 0.0;
                self.old = self.model;
                self.model = m;
                self.fade_left = self.fade_len;
            }
            let x = io.inp[0][i] as f64;
            let g = 10f64.powf(io.par[0][i] as f64 / 20.0);
            let (bias, tone, mix) = (
                io.par[1][i] as f64,
                io.par[2][i] as f64,
                io.par[3][i] as f64,
            );
            let mut wet = self.wet(0, self.model, x, g, bias, tone);
            if self.fade_left > 0 {
                let t = self.fade_left as f64 / self.fade_len as f64;
                let old = self.wet(1, self.old, x, g, bias, tone);
                wet = wet * (1.0 - t) + old * t;
                self.fade_left -= 1;
            }
            let dry = self.dry[self.dry_pos];
            self.dry[self.dry_pos] = x as f32;
            self.dry_pos = (self.dry_pos + 1) % self.dry.len();
            io.out[0][i] = (mix * wet + (1.0 - mix) * dry as f64) as f32;
        }
    }

    fn reset(&mut self) {
        let m = self.model;
        *self = Drive::new(self.sample_rate);
        self.model = m;
        self.old = m;
        self.started = true;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::dsp::bench::Bench;
    use crate::dsp::BLOCK;

    const SR: f64 = 48_000.0;

    /// [gain dB, bias, tone, mix], model; a sine of `amp` at `hz`; the settled output
    fn run(
        gain: f64,
        bias: f64,
        tone: f64,
        model: usize,
        amp: f64,
        hz: f64,
        blocks: usize,
    ) -> Vec<f32> {
        let mut b = Bench::new(SR, 1, &[gain, bias, tone, 1.0], &[model as f64], 1);
        b.connected_in = vec![true];
        let o = b.run(&mut Drive::new(SR), blocks, |blk, i, inp| {
            let n = (blk * BLOCK + i) as f64;
            inp[0][i] = (amp * (std::f64::consts::TAU * hz * n / SR).sin()) as f32;
        });
        o[0][BLOCK * 40..].to_vec()
    }
    fn rms(s: &[f32]) -> f64 {
        (s.iter().map(|x| (*x as f64).powi(2)).sum::<f64>() / s.len() as f64).sqrt()
    }

    #[test]
    fn levels_match_across_models_at_each_gain() {
        for gdb in [0.0, 12.0, 18.0, 24.0, 36.0] {
            let lv: Vec<f64> = (0..MODELS)
                .map(|m| 20.0 * (rms(&run(gdb, 0.0, 0.5, m, 0.5, 110.0, 160)) / TARGET).log10())
                .collect();
            for (m, l) in lv.iter().enumerate() {
                assert!(
                    l.abs() <= 1.5,
                    "gain {gdb} dB, model {m}: {l:.2} dB ({lv:?})"
                );
            }
        }
    }

    /// the amplitude of `hz` in `s` (one DFT bin, Hann window)
    fn level(s: &[f32], hz: f64) -> f64 {
        let n = s.len();
        let (mut re, mut im, mut wsum) = (0.0, 0.0, 0.0);
        for (i, x) in s.iter().enumerate() {
            let w = 0.5 - 0.5 * (std::f64::consts::TAU * i as f64 / n as f64).cos();
            let a = std::f64::consts::TAU * hz * i as f64 / SR;
            re += *x as f64 * w * a.cos();
            im -= *x as f64 * w * a.sin();
            wsum += w;
        }
        2.0 * (re * re + im * im).sqrt() / wsum
    }
    /// harmonics 2…7 in dB relative to the fundamental (an exact number of periods: 110 Hz at 48 k → use 120 Hz)
    fn signature(model: usize, gain: f64, bias: f64) -> [f64; 6] {
        let y = run(gain, bias, 0.5, model, 0.5, 120.0, 200);
        let f1 = level(&y, 120.0);
        let mut h = [0.0; 6];
        for (k, v) in h.iter_mut().enumerate() {
            *v = 20.0 * (level(&y, 120.0 * (k + 2) as f64) / f1).max(1e-9).log10();
        }
        h
    }

    #[test]
    fn every_model_has_its_own_harmonics() {
        let sig: Vec<[f64; 6]> = (0..MODELS).map(|m| signature(m, 18.0, 0.0)).collect();
        for a in 0..MODELS {
            for b in a + 1..MODELS {
                let apart = (0..6)
                    .filter(|&k| (sig[a][k].max(-80.0) - sig[b][k].max(-80.0)).abs() >= 6.0)
                    .count();
                assert!(
                    apart >= 2,
                    "models {a} and {b} are alike: {:?} / {:?}",
                    sig[a],
                    sig[b]
                );
            }
        }
        assert!(
            sig[DIST][1] - sig[SOFT][1] >= 10.0,
            "SOFT's 3rd {} vs DIST's {}",
            sig[SOFT][1],
            sig[DIST][1]
        );
        assert!(
            sig[TUBE][0] >= -30.0 && sig[FUZZ][0] >= -30.0,
            "built-in asymmetry: {} {}",
            sig[TUBE][0],
            sig[FUZZ][0]
        );
    }

    #[test]
    fn rect_full_wave_moves_the_energy_to_even_harmonics() {
        let y = run(12.0, 1.0, 0.5, RECT, 0.5, 120.0, 200);
        let e = |k: usize| level(&y, 120.0 * k as f64).powi(2);
        let even: f64 = (1..6).map(|k| e(2 * k)).sum();
        let all: f64 = (1..12).map(e).sum();
        assert!(even / all >= 0.8, "{}", even / all);
    }

    #[test]
    fn digi_never_exceeds_its_ceiling_before_the_level_match() {
        // a hard clip: the output's peak stays at the level match's scale of ±1
        let y = run(36.0, 0.0, 0.5, DIGI, 0.5, 120.0, 120);
        let peak = y.iter().fold(0.0f32, |a, x| a.max(x.abs())) as f64;
        let scale = TARGET / expected(&VOICES[DIGI], 10f64.powf(36.0 / 20.0));
        assert!(peak <= scale * 1.25, "{peak} vs {scale}");
    }

    #[test]
    fn bias_at_the_ends_with_full_gain_is_finite_and_has_no_dc() {
        for m in 0..MODELS {
            for bias in [-1.0, 1.0] {
                let y = run(36.0, bias, 0.5, m, 0.5, 120.0, 400);
                let mean = y.iter().map(|x| *x as f64).sum::<f64>() / y.len() as f64;
                assert!(
                    y.iter().all(|x| x.is_finite()) && mean.abs() < 0.01,
                    "model {m} bias {bias}: mean {mean}"
                );
            }
        }
    }

    #[test]
    fn switching_model_while_playing_is_smooth() {
        let mut b = Bench::new(SR, 1, &[18.0, 0.3, 0.5, 1.0], &[0.0], 1);
        b.connected_in = vec![true];
        let mut d = Drive::new(SR);
        let mut prev = 0.0f32;
        for blk in 0..700 {
            b.fixed[0] = ((blk / 37) % MODELS) as f64;
            let o = b.run(&mut d, 1, |_, i, inp| {
                inp[0][i] = (0.5
                    * (std::f64::consts::TAU * 110.0 * (blk * BLOCK + i) as f64 / SR).sin())
                    as f32
            });
            for x in &o[0] {
                assert!(
                    x.is_finite() && (x - prev).abs() <= 0.5,
                    "block {blk}: {prev} → {x}"
                );
                prev = *x;
            }
        }
    }

    #[test]
    fn a_huge_input_stays_finite() {
        for m in 0..MODELS {
            let y = run(36.0, 0.0, 0.0, m, 1e6, 100.0, 60);
            assert!(
                y.iter().all(|x| x.is_finite() && x.abs() <= 8.0),
                "model {m}"
            );
        }
    }

    #[test]
    fn aliasing_stays_low_at_full_gain() {
        // 5 kHz at 36 dB: the energy below 4 kHz (no harmonic of 5 kHz lives there) is folded-back aliasing
        for m in [SOFT, TUBE, OD, DIST, FUZZ, DIGI] {
            let y = run(36.0, 0.0, 1.0, m, 0.5, 5_000.0, 200);
            let total: f64 = y.iter().map(|x| (*x as f64).powi(2)).sum();
            let low: f64 = (1..40)
                .map(|k| level(&y, 100.0 * k as f64).powi(2))
                .sum::<f64>()
                * y.len() as f64
                / 2.0;
            let db = 10.0 * (low / total).log10();
            assert!(db < -50.0, "model {m}: {db:.1} dB");
        }
    }

    #[test]
    fn blockwise_equals_per_sample() {
        let x: Vec<f32> = (0..10 * BLOCK)
            .map(|i| (i as f32 * 0.05).sin() * 0.7)
            .collect();
        for m in 0..MODELS {
            Bench::blockwise_equals_per_sample(
                || Box::new(Drive::new(SR)),
                std::slice::from_ref(&x),
                &[18.0, 0.3, 0.3, 0.8],
                &[m as f64],
                1,
                10,
            );
        }
    }

    #[test]
    #[ignore = "prints each model's harmonics"]
    fn print_signatures() {
        for m in 0..MODELS {
            let h = signature(m, 18.0, 0.0);
            eprintln!(
                "model {m}: {}",
                h.iter()
                    .map(|x| format!("{x:6.1}"))
                    .collect::<Vec<_>>()
                    .join(" ")
            );
        }
    }

    #[test]
    #[ignore = "calibration: prints each model's raw level"]
    fn print_raw_levels() {
        for (m, v) in VOICES.iter().enumerate() {
            let mut row = String::new();
            for gdb in [0.0, 6.0, 12.0, 18.0, 24.0, 30.0, 36.0] {
                let g: f64 = 10f64.powf(gdb / 20.0);
                let raw = rms(&run(gdb, 0.0, 0.5, m, 0.5, 110.0, 200)) * expected(v, g) / TARGET;
                row += &format!(" {raw:.3}");
            }
            eprintln!("model {m}:{row}");
        }
    }
}
