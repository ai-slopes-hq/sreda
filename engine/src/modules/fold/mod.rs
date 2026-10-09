//! FOLD (spec §7a, revision 27): four wavefolders — SINE, TRI, WRAP, CHEB. FOLD drives the signal ×1…×40 into the
//! curve (2× oversampled, ADAA where the curve has an antiderivative), SYM offsets it, a DC blocker follows, then a
//! level matched across models and FOLD, and LEVEL. FOLD's first quarter fades the folder in over the dry signal.
//! Changing MODEL crossfades 10 ms.

mod models;

use crate::dsp::{Ctx, Dsp, Io};
use crate::shaping::{Adaa1, Os2x};
use crate::spec::{choice, knob, port, ModuleSpec, Role, Unit};
use models::{Sine, Tri, Wrap};

pub fn spec() -> ModuleSpec {
    ModuleSpec {
        type_: "fold",
        internal: false,
        label: "FOLD",
        desc: "wavefolder: sine, triangle, wrap, chebyshev",
        size: (5, 1),
        inputs: vec![port("in", "IN", Role::Audio)],
        outputs: vec![port("out", "OUT", Role::Audio)],
        params: vec![
            knob("fold", "FOLD", 1.0, 40.0, 4.0).exp().into(),
            knob("sym", "SYM", -1.0, 1.0, 0.0).into(),
            knob("level", "LEVEL", -12.0, 12.0, 0.0)
                .unit(Unit::Db)
                .into(),
            choice("model", "MODEL", &["SINE", "TRI", "WRAP", "CHEB"], 0).into(),
        ],
        normals: vec![],
        display: None,
    }
}

pub const SINE: usize = 0;
pub const TRI: usize = 1;
pub const WRAP: usize = 2;
pub const CHEB: usize = 3;
const MODELS: usize = 4;
/// the level FOLD aims for: a −6 dBFS sine's RMS
const TARGET: f64 = 0.354;
/// the folder's position along FOLD, 0…1 (×1…×40)
fn amount(g: f64) -> f64 {
    (g.max(1.0).ln() / 40f64.ln()).clamp(0.0, 1.0)
}
/// The RMS a −6 dBFS sine reaches through each model's curve at FOLD amount k = 0, 1/32 … 1 (measured by
/// `print_level_table`; a folder's level rises and falls as each new fold appears, so it is a table, not a fit).
const LEVELS: [[f64; POINTS]; MODELS] = [
    [
        0.5135, 0.5646, 0.6175, 0.6707, 0.7221, 0.7687, 0.8067, 0.8311, 0.8362, 0.8167, 0.7697,
        0.6994, 0.6259, 0.5917, 0.6339, 0.7257, 0.7882, 0.7560, 0.6525, 0.6460, 0.7575, 0.7323,
        0.6421, 0.7573, 0.6730, 0.7341, 0.6690, 0.7529, 0.6877, 0.6653, 0.6905, 0.6981, 0.6808,
    ],
    [
        0.3534, 0.3965, 0.4450, 0.4994, 0.5604, 0.6288, 0.7057, 0.7292, 0.7123, 0.6740, 0.6216,
        0.5622, 0.5072, 0.4758, 0.4943, 0.5813, 0.6728, 0.6137, 0.5299, 0.5124, 0.6445, 0.5931,
        0.5178, 0.6421, 0.5472, 0.6049, 0.5446, 0.6269, 0.5505, 0.5416, 0.5615, 0.5673, 0.5545,
    ],
    [
        0.3534, 0.3965, 0.4450, 0.4994, 0.5604, 0.6288, 0.7057, 0.7259, 0.7101, 0.6705, 0.6190,
        0.5587, 0.5030, 0.4722, 0.4897, 0.5771, 0.6676, 0.6050, 0.5195, 0.5021, 0.6319, 0.5795,
        0.5040, 0.6279, 0.5303, 0.5876, 0.5201, 0.6011, 0.5259, 0.5118, 0.5269, 0.5264, 0.5100,
    ],
    [
        0.5749, 0.5906, 0.6352, 0.5115, 0.4025, 0.3142, 0.2753, 0.2186, 0.1659, 0.1606, 0.1583,
        0.1899, 0.2167, 0.2669, 0.2505, 0.2807, 0.3006, 0.3605, 0.3577, 0.3742, 0.3488, 0.3281,
        0.3029, 0.2891, 0.2575, 0.2133, 0.1925, 0.1833, 0.1977, 0.2013, 0.2237, 0.2141, 0.2314,
    ],
];
const POINTS: usize = 33;
fn expected(m: usize, k: f64) -> f64 {
    let t = k.clamp(0.0, 1.0) * (POINTS - 1) as f64;
    let i = (t.floor() as usize).min(POINTS - 2);
    let f = t - i as f64;
    let row = &LEVELS[m];
    (row[i] + (row[i + 1] - row[i]) * f).max(1e-3)
}

#[derive(Default)]
struct Chain {
    sine: Adaa1<Sine>,
    tri: Adaa1<Tri>,
    wrap: Adaa1<Wrap>,
    dc: (f64, f64),
}

impl Chain {
    fn curve(&mut self, m: usize, u: f64, n: f64) -> f64 {
        match m {
            TRI => self.tri.process(u),
            WRAP => self.wrap.process(u),
            CHEB => models::cheb(u, n),
            _ => self.sine.process(u),
        }
    }
}

pub struct Fold {
    sample_rate: f64,
    os: [Os2x; 2],
    chains: [Chain; 2],
    dry: [f32; Os2x::LATENCY],
    dry_pos: usize,
    model: usize,
    old: usize,
    fade_left: u32,
    fade_len: u32,
    started: bool,
}

impl Fold {
    pub fn new(sample_rate: f64) -> Self {
        Fold {
            sample_rate,
            os: [Os2x::new(), Os2x::new()],
            chains: [Chain::default(), Chain::default()],
            dry: [0.0; Os2x::LATENCY],
            dry_pos: 0,
            model: SINE,
            old: SINE,
            fade_left: 0,
            fade_len: ((0.01 * sample_rate) as u32).max(1),
            started: false,
        }
    }

    /// One sample of model `m` through chain `c`, level-matched.
    fn wet(&mut self, c: usize, m: usize, x: f64, g: f64, sym: f64) -> f64 {
        let k = amount(g);
        // CHEB: FOLD brings in harmonics 2…16; its input is driven ×2 so a −6 dBFS sine reaches the curve's range
        let (u, n) = if m == CHEB {
            (2.0 * x + 0.5 * sym, 1.0 + 15.0 * k)
        } else {
            (g * x + sym, 0.0)
        };
        let up = self.os[c].up(u as f32);
        let ch = &mut self.chains[c];
        let a = ch.curve(m, up[0] as f64, n);
        let b = ch.curve(m, up[1] as f64, n);
        let y = self.os[c].down([a as f32, b as f32]) as f64;
        // remove SYM's DC (5 Hz)
        let r = 1.0 - std::f64::consts::TAU * 5.0 / self.sample_rate;
        let (x1, y1) = ch.dc;
        let hp = y - x1 + r * y1;
        ch.dc = (y, hp);
        hp * TARGET / expected(m, k)
    }
}

impl Dsp for Fold {
    fn process(&mut self, io: &mut Io, _ctx: &mut Ctx, from: usize, to: usize) {
        let m = (io.fixed[0].round().max(0.0) as usize).min(MODELS - 1);
        if !self.started {
            self.started = true;
            self.model = m;
            self.old = m;
        }
        for i in from..to {
            if m != self.model {
                self.chains.swap(0, 1);
                self.os.swap(0, 1);
                self.chains[0] = Chain::default();
                self.os[0].reset();
                self.old = self.model;
                self.model = m;
                self.fade_left = self.fade_len;
            }
            let x = io.inp[0][i] as f64;
            let (g, sym) = (io.par[0][i] as f64, io.par[1][i] as f64);
            let level = 10f64.powf(io.par[2][i] as f64 / 20.0);
            let mut wet = self.wet(0, self.model, x, g, sym);
            if self.fade_left > 0 {
                let t = self.fade_left as f64 / self.fade_len as f64;
                let old = self.wet(1, self.old, x, g, sym);
                wet = wet * (1.0 - t) + old * t;
                self.fade_left -= 1;
            }
            let dry = self.dry[self.dry_pos] as f64;
            self.dry[self.dry_pos] = x as f32;
            self.dry_pos = (self.dry_pos + 1) % self.dry.len();
            // the folder fades in over FOLD's first quarter, so FOLD 0 passes the signal unchanged
            let w = (4.0 * amount(g)).min(1.0);
            io.out[0][i] = (((1.0 - w) * dry + w * wet) * level) as f32;
        }
    }

    fn reset(&mut self) {
        let m = self.model;
        *self = Fold::new(self.sample_rate);
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

    /// [fold ×, sym, level dB], model; a sine of `amp` at `hz`; the settled output
    fn run(g: f64, sym: f64, model: usize, amp: f64, hz: f64, blocks: usize) -> Vec<f32> {
        let mut b = Bench::new(SR, 1, &[g, sym, 0.0], &[model as f64], 1);
        b.connected_in = vec![true];
        let o = b.run(&mut Fold::new(SR), blocks, |blk, i, inp| {
            let n = (blk * BLOCK + i) as f64;
            inp[0][i] = (amp * (std::f64::consts::TAU * hz * n / SR).sin()) as f32;
        });
        o[0][BLOCK * 40..].to_vec()
    }
    fn rms(s: &[f32]) -> f64 {
        (s.iter().map(|x| (*x as f64).powi(2)).sum::<f64>() / s.len() as f64).sqrt()
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
    /// harmonics 2…9 in dB relative to the fundamental, a 120 Hz sine at −6 dBFS
    fn signature(model: usize, k: f64, sym: f64) -> [f64; 8] {
        let y = run(40f64.powf(k), sym, model, 0.5, 120.0, 200);
        let f1 = level(&y, 120.0).max(1e-9);
        let mut h = [0.0; 8];
        for (j, v) in h.iter_mut().enumerate() {
            *v = 20.0 * (level(&y, 120.0 * (j + 2) as f64) / f1).max(1e-9).log10();
        }
        h
    }

    /// the energy of harmonics 10…30 relative to all of them, in dB: how bright the folds are
    fn brightness(model: usize, k: f64) -> f64 {
        let y = run(40f64.powf(k), 0.0, model, 0.5, 120.0, 200);
        let e = |n: usize| level(&y, 120.0 * n as f64).powi(2);
        let high: f64 = (10..=30).map(e).sum();
        let all: f64 = (1..=30).map(e).sum();
        10.0 * (high / all).max(1e-12).log10()
    }

    #[test]
    fn every_model_has_its_own_harmonics_at_a_moderate_fold() {
        let feats: Vec<Vec<f64>> = (0..MODELS)
            .map(|m| {
                let mut f: Vec<f64> = signature(m, 0.4, 0.0)
                    .iter()
                    .map(|x| x.max(-80.0))
                    .collect();
                f.push(brightness(m, 0.4).max(-80.0));
                f
            })
            .collect();
        for a in 0..MODELS {
            for b in a + 1..MODELS {
                let apart = (0..feats[a].len())
                    .filter(|&k| (feats[a][k] - feats[b][k]).abs() >= 6.0)
                    .count();
                assert!(
                    apart >= 2,
                    "models {a} and {b} are alike: {:?} / {:?}",
                    feats[a],
                    feats[b]
                );
            }
        }
        assert!(
            brightness(TRI, 0.4) >= brightness(SINE, 0.4) + 6.0,
            "TRI is brighter than SINE"
        );
    }

    #[test]
    fn more_fold_more_crossings() {
        let crossings = |m: usize, k: f64| {
            run(40f64.powf(k), 0.0, m, 0.5, 100.0, 120)
                .windows(2)
                .filter(|w| (w[0] < 0.0) != (w[1] < 0.0))
                .count()
        };
        for m in [SINE, TRI, WRAP, CHEB] {
            let (lo, hi) = (crossings(m, 0.0), crossings(m, 1.0));
            assert!(hi >= 5 * lo, "model {m}: {hi} vs {lo}");
        }
    }

    #[test]
    fn cheb_keeps_its_energy_among_the_low_harmonics() {
        let y = run(40f64.powf(0.5), 0.0, CHEB, 0.5, 120.0, 200);
        let e = |n: usize| level(&y, 120.0 * n as f64).powi(2);
        let below: f64 = (2..10).map(e).sum();
        let above: f64 = (10..=30).map(e).sum();
        assert!(below > 4.0 * above, "{below} vs {above}");
        assert!(below > 0.1 * e(1), "CHEB adds harmonics");
    }

    #[test]
    fn sym_brings_a_second_harmonic() {
        for m in [SINE, TRI, WRAP, CHEB] {
            let h2 = signature(m, 0.4, 0.5)[0];
            assert!(h2 >= -30.0, "model {m}: {h2:.1} dB");
        }
    }

    #[test]
    fn fold_zero_is_the_dry_signal_delayed() {
        let x = |n: usize| (0.9 * (n as f64 * 0.05).sin()) as f32;
        let mut b = Bench::new(SR, 1, &[1.0, 0.0, 0.0], &[0.0], 1);
        b.connected_in = vec![true];
        let o = b.run(&mut Fold::new(SR), 8, |blk, i, inp| {
            inp[0][i] = x(blk * BLOCK + i)
        });
        for (n, y) in o[0].iter().enumerate().skip(Os2x::LATENCY) {
            assert!((y - x(n - Os2x::LATENCY)).abs() < 1e-6, "{n}");
        }
    }

    #[test]
    fn switching_model_while_playing_is_smooth() {
        let mut b = Bench::new(SR, 1, &[8.0, 0.2, 0.0], &[0.0], 1);
        b.connected_in = vec![true];
        let mut d = Fold::new(SR);
        let mut prev = 0.0f32;
        for blk in 0..400 {
            // WRAP's own waveform jumps by design, so it is switched to and from without the smoothness check
            let order = [SINE, TRI, CHEB, WRAP];
            let m = order[(blk / 37) % 4];
            b.fixed[0] = m as f64;
            let o = b.run(&mut d, 1, |_, i, inp| {
                inp[0][i] = (0.5
                    * (std::f64::consts::TAU * 110.0 * (blk * BLOCK + i) as f64 / SR).sin())
                    as f32
            });
            // WRAP, and the 10 ms after leaving it, are only checked to be finite
            let wrap_near = m == WRAP || (blk % 37 < 4 && order[(blk / 37 + 3) % 4] == WRAP);
            for x in &o[0] {
                assert!(
                    x.is_finite() && (wrap_near || (x - prev).abs() <= 0.5),
                    "block {blk}: {prev} → {x}"
                );
                prev = *x;
            }
        }
    }

    #[test]
    fn a_huge_input_stays_finite() {
        for m in 0..MODELS {
            let y = run(40.0, 1.0, m, 1e6, 100.0, 60);
            assert!(
                y.iter().all(|x| x.is_finite() && x.abs() <= 8.0),
                "model {m}"
            );
        }
    }

    #[test]
    fn aliasing_stays_below_the_folds() {
        // 3 kHz at FOLD 1: energy between the harmonics of 3 kHz below 2.9 kHz is folded-back aliasing
        for m in [SINE, TRI, WRAP] {
            let y = run(40.0, 0.0, m, 0.5, 3_000.0, 200);
            let total: f64 = y.iter().map(|x| (*x as f64).powi(2)).sum();
            let low: f64 = (1..29)
                .map(|k| level(&y, 100.0 * k as f64).powi(2))
                .sum::<f64>()
                * y.len() as f64
                / 2.0;
            let db = 10.0 * (low / total).log10();
            assert!(db < -40.0, "model {m}: {db:.1} dB");
        }
    }

    #[test]
    fn blockwise_equals_per_sample() {
        let x: Vec<f32> = (0..10 * BLOCK)
            .map(|i| (i as f32 * 0.05).sin() * 0.7)
            .collect();
        for m in 0..MODELS {
            Bench::blockwise_equals_per_sample(
                || Box::new(Fold::new(SR)),
                std::slice::from_ref(&x),
                &[12.0, 0.3, 3.0],
                &[m as f64],
                1,
                10,
            );
        }
    }

    #[test]
    #[ignore = "prints each model's harmonics"]
    fn print_signatures() {
        for k in [0.4, 0.7] {
            for m in 0..MODELS {
                let h = signature(m, k, 0.0);
                eprintln!(
                    "k {k} model {m}: {} | bright {:.1}",
                    h.iter()
                        .map(|x| format!("{x:6.1}"))
                        .collect::<Vec<_>>()
                        .join(" "),
                    brightness(m, k)
                );
            }
        }
    }

    #[test]
    fn levels_match_across_models_and_fold() {
        let mut worst = (0.0f64, 0usize, 0.0f64);
        for m in 0..MODELS {
            for j in 0..=60 {
                let k = 0.25 + 0.75 * j as f64 / 60.0;
                let l = 20.0 * (rms(&run(40f64.powf(k), 0.0, m, 0.5, 120.0, 120)) / TARGET).log10();
                if l.abs() > worst.0.abs() {
                    worst = (l, m, k);
                }
            }
        }
        assert!(
            worst.0.abs() <= 1.5,
            "model {} at FOLD {:.3}: {:.2} dB",
            worst.1,
            worst.2,
            worst.0
        );
    }

    #[test]
    #[ignore = "calibration: prints LEVELS"]
    fn print_level_table() {
        let mut out = String::from("const LEVELS: [[f64; POINTS]; MODELS] = [\n");
        for m in 0..MODELS {
            out += "    [";
            for j in 0..POINTS {
                let k = j as f64 / (POINTS - 1) as f64;
                let g = 40f64.powf(k);
                let mut f = Fold::new(SR);
                let mut acc = 0.0;
                let n = 48_000;
                for i in 0..n {
                    let x = 0.5 * (std::f64::consts::TAU * 120.0 * i as f64 / SR).sin();
                    let y = f.wet(0, m, x, g, 0.0) * expected(m, k) / TARGET;
                    if i >= 4_800 {
                        acc += y * y;
                    }
                }
                out += &format!("{:.4}, ", (acc / (n - 4_800) as f64).sqrt());
            }
            out += "],\n";
        }
        eprintln!("{out}];");
    }

    #[test]
    #[ignore = "calibration: prints each model's raw level"]
    fn print_raw_levels() {
        for m in 0..MODELS {
            let mut row = String::new();
            for k in [0.25, 0.4, 0.55, 0.7, 0.85, 1.0] {
                let g = 40f64.powf(k);
                let raw = rms(&run(g, 0.0, m, 0.5, 120.0, 200)) * expected(m, k) / TARGET;
                row += &format!(" {raw:.3}");
            }
            eprintln!("model {m}:{row}");
        }
    }
}
