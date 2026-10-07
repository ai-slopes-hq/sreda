//! UNCERTAINTY (Buchla 266 style): smooth, stepped and quantised random voltages, clocked by TRIG or by RATE.

use crate::dsp::{Ctx, Dsp, Io};
use crate::spec::{knob, port, ModuleSpec, Normal, Role, Unit};

pub fn spec() -> ModuleSpec {
    ModuleSpec {
        type_: "uncertainty",
        label: "UNCERTAINTY",
        desc: "smooth, stepped, quantised random",
        size: (4, 1),
        inputs: vec![port("trig", "TRIG", Role::Trigger)],
        outputs: vec![
            port("smooth", "SMTH", Role::Mod),
            port("stepped", "STEP", Role::Mod),
            port("quant", "QNT", Role::Mod),
        ],
        params: vec![
            knob("rate", "RATE", 0.01, 20.0, 1.0)
                .exp()
                .unit(Unit::Hz)
                .random(0.1, 4.0)
                .mod_depth(0.25)
                .into(),
            knob("levels", "LVLS", 2.0, 16.0, 4.0).step(1.0).into(),
        ],
        normals: vec![Normal::Internal {
            input: "trig",
            internal: "clock at RATE",
        }],
        display: None,
    }
}

pub struct Uncertainty {
    sample_rate: f64,
    phase: f64,
    trig_high: bool,
    stepped: f64,
    target: f64,
    smooth: f64,
}

impl Uncertainty {
    pub fn new(sample_rate: f64) -> Self {
        Uncertainty {
            sample_rate,
            phase: 0.0,
            trig_high: false,
            stepped: 0.0,
            target: 0.0,
            smooth: 0.0,
        }
    }
}

impl Dsp for Uncertainty {
    fn process(&mut self, io: &mut Io, ctx: &mut Ctx, from: usize, to: usize) {
        let patched = io.connected_in[0];
        for i in from..to {
            let rate = io.par[0][i] as f64;
            let high = io.inp[0][i] > 0.5;
            let event = if patched {
                high && !self.trig_high
            } else {
                // the internal clock at RATE
                self.phase += rate / self.sample_rate;
                let tick = self.phase >= 1.0;
                if tick {
                    self.phase -= 1.0;
                }
                tick
            };
            self.trig_high = high;
            if event {
                self.stepped = ctx.rng.next_f64() * 2.0 - 1.0;
                self.target = ctx.rng.next_f64() * 2.0 - 1.0;
            }
            // SMOOTH: a one-pole toward the target, τ = 1 / (2·RATE)
            self.smooth +=
                (1.0 - (-2.0 * rate / self.sample_rate).exp()) * (self.target - self.smooth);
            let levels = (io.par[1][i].round() as f64).clamp(2.0, 16.0) - 1.0;
            let quant = ((self.stepped + 1.0) * 0.5 * levels).round() / levels * 2.0 - 1.0;
            io.out[0][i] = self.smooth as f32;
            io.out[1][i] = self.stepped as f32;
            io.out[2][i] = quant as f32;
        }
    }

    fn reset(&mut self) {
        let sr = self.sample_rate;
        *self = Uncertainty::new(sr);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::dsp::bench::Bench;
    use crate::dsp::BLOCK;

    #[test]
    fn quant_takes_at_most_levels_values() {
        let mut b = Bench::new(48_000.0, 1, &[50.0_f64.min(20.0), 5.0], &[], 3);
        let o = b.run(&mut Uncertainty::new(48_000.0), 400, |_, _, _| {});
        let mut seen: Vec<i64> = o[2].iter().map(|x| (x * 1e5).round() as i64).collect();
        seen.sort();
        seen.dedup();
        assert!(seen.len() <= 5 && seen.len() >= 3, "{seen:?}");
        assert!(o.iter().all(|s| s.iter().all(|x| (-1.0..=1.0).contains(x))));
    }

    #[test]
    fn free_running_it_steps_every_one_over_rate_at_48k_and_44k1() {
        for sr in [48_000.0, 44_100.0] {
            let mut b = Bench::new(sr, 1, &[2.0, 4.0], &[], 3);
            let o = b.run(
                &mut Uncertainty::new(sr),
                (1.6 * sr) as usize / BLOCK,
                |_, _, _| {},
            );
            let changes: Vec<usize> = (1..o[1].len())
                .filter(|&i| o[1][i] != o[1][i - 1])
                .collect();
            assert!(changes.len() >= 2, "{sr}: it steps");
            for w in changes.windows(2) {
                assert!(
                    ((w[1] - w[0]) as f64 - 0.5 * sr).abs() <= 1.0,
                    "{sr}: {} samples",
                    w[1] - w[0]
                );
            }
        }
    }

    #[test]
    fn smooth_glides_toward_its_targets() {
        let mut b = Bench::new(48_000.0, 1, &[4.0, 4.0], &[], 3);
        let o = b.run(&mut Uncertainty::new(48_000.0), 200, |_, _, _| {});
        let jumps = o[0]
            .windows(2)
            .map(|w| (w[1] - w[0]).abs())
            .fold(0.0f32, f32::max);
        assert!(jumps < 0.01, "no steps in SMOOTH: {jumps}");
        assert!(o[0].iter().any(|x| x.abs() > 0.05), "it moves");
    }

    #[test]
    fn blockwise_equals_per_sample() {
        let t: Vec<f32> = (0..20 * BLOCK)
            .map(|i| if i % 300 < 48 { 1.0 } else { 0.0 })
            .collect();
        Bench::blockwise_equals_per_sample(
            || Box::new(Uncertainty::new(48_000.0)),
            &[t],
            &[3.0, 6.0],
            &[],
            3,
            20,
        );
        Bench::blockwise_equals_per_sample(
            || Box::new(Uncertainty::new(48_000.0)),
            &[vec![]],
            &[15.0, 6.0],
            &[],
            3,
            20,
        );
    }
}
