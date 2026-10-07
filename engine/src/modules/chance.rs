//! CHANCE: a Bernoulli gate — each trigger goes to A with probability P, else to B.

use crate::dsp::{Ctx, Dsp, Io};
use crate::spec::{knob, port, ModuleSpec, Role};

pub fn spec() -> ModuleSpec {
    ModuleSpec {
        type_: "chance",
        label: "CHANCE",
        desc: "bernoulli: each trigger to A or B",
        size: (3, 1),
        inputs: vec![port("trig", "TRIG", Role::Trigger)],
        outputs: vec![port("a", "A", Role::Trigger), port("b", "B", Role::Trigger)],
        params: vec![knob("p", "P", 0.0, 1.0, 0.5).into()],
        normals: vec![],
        display: None,
    }
}

pub struct Chance {
    pulse: u32,
    a_left: u32,
    b_left: u32,
    trig_high: bool,
}

impl Chance {
    pub fn new(sample_rate: f64) -> Self {
        Chance {
            pulse: ((0.001 * sample_rate).round() as u32).max(1),
            a_left: 0,
            b_left: 0,
            trig_high: false,
        }
    }
}

impl Dsp for Chance {
    fn process(&mut self, io: &mut Io, ctx: &mut Ctx, from: usize, to: usize) {
        for i in from..to {
            let high = io.inp[0][i] > 0.5;
            if high && !self.trig_high {
                if ctx.rng.next_f64() < io.par[0][i] as f64 {
                    self.a_left = self.pulse;
                } else {
                    self.b_left = self.pulse;
                }
            }
            self.trig_high = high;
            io.out[0][i] = if self.a_left > 0 { 1.0 } else { 0.0 };
            io.out[1][i] = if self.b_left > 0 { 1.0 } else { 0.0 };
            self.a_left = self.a_left.saturating_sub(1);
            self.b_left = self.b_left.saturating_sub(1);
        }
    }

    fn reset(&mut self) {
        self.a_left = 0;
        self.b_left = 0;
        self.trig_high = false;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::dsp::bench::Bench;
    use crate::dsp::BLOCK;

    fn rises(s: &[f32]) -> usize {
        (0..s.len())
            .filter(|&i| s[i] > 0.5 && (i == 0 || s[i - 1] <= 0.5))
            .count()
    }

    fn split(p: f64) -> (usize, usize) {
        let mut b = Bench::new(48_000.0, 1, &[p], &[], 2);
        b.connected_in = vec![true];
        // 10 000 triggers, 100 samples apart
        let o = b.run(
            &mut Chance::new(48_000.0),
            10_000 * 100 / BLOCK,
            |blk, i, inp| {
                inp[0][i] = if (blk * BLOCK + i) % 100 < 10 {
                    1.0
                } else {
                    0.0
                }
            },
        );
        (rises(&o[0]), rises(&o[1]))
    }

    #[test]
    fn p_sends_triggers_to_a_or_b() {
        assert_eq!(split(0.0).0, 0);
        assert_eq!(split(1.0).1, 0);
        let (a, b) = split(0.5);
        assert!(a + b >= 9990, "{a} + {b}");
        let share = a as f64 / (a + b) as f64;
        assert!((0.45..=0.55).contains(&share), "{share}");
    }

    #[test]
    fn blockwise_equals_per_sample() {
        let t: Vec<f32> = (0..20 * BLOCK)
            .map(|i| if i % 150 < 10 { 1.0 } else { 0.0 })
            .collect();
        Bench::blockwise_equals_per_sample(
            || Box::new(Chance::new(48_000.0)),
            &[t],
            &[0.4],
            &[],
            2,
            20,
        );
    }
}
