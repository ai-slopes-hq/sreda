//! S&H: sample IN on a TRIG rise and hold it; IN unpatched samples internal noise.

use crate::dsp::{Ctx, Dsp, Io};
use crate::spec::{port, ModuleSpec, Normal, Role};

pub fn spec() -> ModuleSpec {
    ModuleSpec {
        type_: "snh",
        internal: false,
        label: "S&H",
        desc: "sample and hold",
        size: (2, 1),
        inputs: vec![
            port("in", "IN", Role::Audio),
            port("trig", "TRIG", Role::Trigger),
        ],
        outputs: vec![port("out", "OUT", Role::Mod)],
        params: vec![],
        normals: vec![Normal::Internal {
            input: "in",
            internal: "noise",
        }],
        display: None,
    }
}

#[derive(Default)]
pub struct Snh {
    hold: f32,
    trig_high: bool,
}

impl Dsp for Snh {
    fn process(&mut self, io: &mut Io, ctx: &mut Ctx, from: usize, to: usize) {
        let in_patched = io.connected_in[0];
        for i in from..to {
            let high = io.inp[1][i] > 0.5;
            if high && !self.trig_high {
                // IN unpatched: the internal white noise
                self.hold = if in_patched {
                    io.inp[0][i]
                } else {
                    (ctx.rng.next_f64() * 2.0 - 1.0) as f32
                };
            }
            self.trig_high = high;
            io.out[0][i] = self.hold;
        }
    }

    fn reset(&mut self) {
        *self = Snh::default();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::dsp::bench::Bench;
    use crate::dsp::BLOCK;

    #[test]
    fn it_holds_in_between_rises() {
        let mut b = Bench::new(48_000.0, 2, &[], &[], 1);
        b.connected_in = vec![true, true];
        let o = b.run(&mut Snh::default(), 4, |blk, i, inp| {
            let n = blk * BLOCK + i;
            inp[0][i] = n as f32 * 0.001;
            inp[1][i] = if n % 200 < 10 { 1.0 } else { 0.0 };
        });
        assert_eq!(o[0][150], 0.0);
        assert_eq!(o[0][350], 0.2);
        assert_eq!(o[0][450], 0.4);
    }

    #[test]
    fn unpatched_in_samples_noise() {
        let mut b = Bench::new(48_000.0, 2, &[], &[], 1);
        b.connected_in = vec![false, true];
        let o = b.run(&mut Snh::default(), 40, |blk, i, inp| {
            inp[1][i] = if (blk * BLOCK + i) % 100 < 10 {
                1.0
            } else {
                0.0
            }
        });
        let mut held: Vec<i64> = o[0].iter().map(|x| (x * 1e6) as i64).collect();
        held.dedup();
        assert!(held.len() > 30, "a new value per trigger: {}", held.len());
    }

    #[test]
    fn an_audio_rate_trigger_stays_finite() {
        let mut b = Bench::new(48_000.0, 2, &[], &[], 1);
        b.connected_in = vec![false, true];
        let o = b.run(&mut Snh::default(), 400, |blk, i, inp| {
            inp[1][i] = if (blk * BLOCK + i) % 24 < 12 {
                1.0
            } else {
                0.0
            }
        });
        assert!(o[0].iter().all(|x| x.is_finite() && x.abs() <= 1.0));
    }

    #[test]
    fn blockwise_equals_per_sample() {
        let t: Vec<f32> = (0..10 * BLOCK)
            .map(|i| if i % 77 < 10 { 1.0 } else { 0.0 })
            .collect();
        Bench::blockwise_equals_per_sample(
            || Box::new(Snh::default()),
            &[vec![], t],
            &[],
            &[],
            1,
            10,
        );
    }
}
