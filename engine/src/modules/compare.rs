//! COMPARE: a gate while IN is above the threshold (with 0.01 of hysteresis).

use crate::dsp::{Ctx, Dsp, Io};
use crate::spec::{knob, port, ModuleSpec, Role};

pub fn spec() -> ModuleSpec {
    ModuleSpec {
        type_: "compare",
        internal: false,
        label: "COMPARE",
        desc: "signal to gate",
        size: (3, 1),
        inputs: vec![port("in", "IN", Role::Audio)],
        outputs: vec![port("out", "GATE", Role::Trigger)],
        params: vec![knob("thr", "THR", -1.0, 1.0, 0.0).into()],
        normals: vec![],
        display: None,
    }
}

#[derive(Default)]
pub struct Compare {
    high: bool,
}

impl Dsp for Compare {
    fn process(&mut self, io: &mut Io, _ctx: &mut Ctx, from: usize, to: usize) {
        for i in from..to {
            let (x, thr) = (io.inp[0][i], io.par[0][i]);
            if x > thr {
                self.high = true;
            } else if x < thr - 0.01 {
                self.high = false;
            }
            io.out[0][i] = if self.high { 1.0 } else { 0.0 };
        }
    }

    fn reset(&mut self) {
        self.high = false;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::dsp::bench::Bench;
    use crate::dsp::{Rng, BLOCK};

    #[test]
    fn a_noisy_sine_at_the_threshold_does_not_chatter() {
        let mut b = Bench::new(48_000.0, 1, &[0.0], &[], 1);
        b.connected_in = vec![true];
        let mut r = Rng::new(9);
        let o = b.run(&mut Compare::default(), 375, |blk, i, inp| {
            let n = (blk * BLOCK + i) as f64;
            inp[0][i] = ((std::f64::consts::TAU * 10.0 * n / 48_000.0).sin()
                + (r.next_f64() - 0.5) * 0.01) as f32;
        });
        let rises: Vec<usize> = (1..o[0].len())
            .filter(|&i| o[0][i - 1] < 0.5 && o[0][i] > 0.5)
            .collect();
        // one gate per cycle of a 10 Hz sine: rises 4800 samples apart (± the noise), never in bursts
        assert!(rises.len() >= 10, "{rises:?}");
        assert!(
            rises.windows(2).all(|w| (w[1] - w[0]).abs_diff(4800) <= 10),
            "{rises:?}"
        );
    }

    #[test]
    fn blockwise_equals_per_sample() {
        let x: Vec<f32> = (0..10 * BLOCK).map(|i| (i as f32 * 0.05).sin()).collect();
        Bench::blockwise_equals_per_sample(
            || Box::new(Compare::default()),
            &[x],
            &[0.3],
            &[],
            1,
            10,
        );
    }
}
