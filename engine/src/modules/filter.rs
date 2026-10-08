//! FILTER: a state-variable filter (TPT), LP, BP and HP at once.

use crate::dsp::{Ctx, Dsp, Io};
use crate::spec::{knob, port, ModuleSpec, Role, Unit};

pub fn spec() -> ModuleSpec {
    ModuleSpec {
        type_: "filter",
        internal: false,
        label: "FILTER",
        desc: "state-variable filter: LP, BP, HP at once",
        size: (4, 1),
        inputs: vec![port("in", "IN", Role::Audio)],
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
        ],
        normals: vec![],
        display: None,
    }
}

/// Cytomic's trapezoidal (TPT) state-variable filter; f64 state with a tiny offset against denormals.
pub struct Filter {
    sample_rate: f64,
    ic1: f64,
    ic2: f64,
}

impl Filter {
    pub fn new(sample_rate: f64) -> Self {
        Filter {
            sample_rate,
            ic1: 0.0,
            ic2: 0.0,
        }
    }
}

impl Dsp for Filter {
    fn process(&mut self, io: &mut Io, _ctx: &mut Ctx, from: usize, to: usize) {
        for i in from..to {
            let fc = (io.par[0][i] as f64).clamp(10.0, 0.49 * self.sample_rate);
            let k = 2.0 - 1.96 * (io.par[1][i] as f64).clamp(0.0, 1.0);
            let g = (std::f64::consts::PI * fc / self.sample_rate).tan();
            let a1 = 1.0 / (1.0 + g * (g + k));
            let (a2, x) = (g * a1, io.inp[0][i] as f64);
            let a3 = g * a2;
            let v3 = x - self.ic2;
            let v1 = a1 * self.ic1 + a2 * v3;
            let v2 = self.ic2 + a2 * self.ic1 + a3 * v3;
            self.ic1 = 2.0 * v1 - self.ic1 + 1e-20;
            self.ic2 = 2.0 * v2 - self.ic2 + 1e-20;
            io.out[0][i] = v2 as f32;
            io.out[1][i] = v1 as f32;
            io.out[2][i] = (x - k * v1 - v2) as f32;
        }
    }

    fn reset(&mut self) {
        self.ic1 = 0.0;
        self.ic2 = 0.0;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::dsp::bench::Bench;
    use crate::dsp::BLOCK;

    const LP: usize = 0;
    const HP: usize = 2;

    /// The gain in dB of one output for a sine at `hz` through a 1 kHz filter.
    fn gain_db(sr: f64, out: usize, hz: f64) -> f64 {
        let mut b = Bench::new(sr, 1, &[1000.0, 0.2], &[], 3);
        b.connected_in = vec![true];
        let o = b.run(
            &mut Filter::new(sr),
            (0.3 * sr) as usize / BLOCK,
            |blk, i, inp| {
                inp[0][i] =
                    (std::f64::consts::TAU * hz * (blk * BLOCK + i) as f64 / sr).sin() as f32;
            },
        );
        let tail = &o[out][o[out].len() / 2..];
        let rms =
            (tail.iter().map(|x| (*x as f64).powi(2)).sum::<f64>() / tail.len() as f64).sqrt();
        20.0 * (rms / std::f64::consts::FRAC_1_SQRT_2).log10()
    }

    #[test]
    fn lp_and_hp_split_at_the_cutoff_at_48k_and_44k1() {
        for sr in [48_000.0, 44_100.0] {
            assert!(
                gain_db(sr, LP, 10_000.0) <= -30.0,
                "{sr}: LP at 10 kHz {}",
                gain_db(sr, LP, 10_000.0)
            );
            assert!(
                gain_db(sr, LP, 100.0).abs() <= 1.0,
                "{sr}: LP at 100 Hz {}",
                gain_db(sr, LP, 100.0)
            );
            assert!(
                gain_db(sr, HP, 100.0) <= -30.0,
                "{sr}: HP at 100 Hz {}",
                gain_db(sr, HP, 100.0)
            );
            assert!(
                gain_db(sr, HP, 10_000.0).abs() <= 1.0,
                "{sr}: HP at 10 kHz {}",
                gain_db(sr, HP, 10_000.0)
            );
        }
    }

    #[test]
    fn full_resonance_on_noise_stays_finite() {
        let mut b = Bench::new(48_000.0, 1, &[2000.0, 1.0], &[], 3);
        b.connected_in = vec![true];
        let mut r = crate::dsp::Rng::new(5);
        let o = b.run(&mut Filter::new(48_000.0), 750, |_, i, inp| {
            inp[0][i] = (r.next_f64() * 2.0 - 1.0) as f32
        });
        assert!(o
            .iter()
            .all(|s| s.iter().all(|x| x.is_finite() && x.abs() < 100.0)));
    }

    #[test]
    fn blockwise_equals_per_sample() {
        let n = 20 * BLOCK;
        let x: Vec<f32> = (0..n)
            .map(|i| ((i * 7919) % 101) as f32 / 50.0 - 1.0)
            .collect();
        Bench::blockwise_equals_per_sample(
            || Box::new(Filter::new(48_000.0)),
            &[x],
            &[700.0, 0.7],
            &[],
            3,
            20,
        );
    }
}
