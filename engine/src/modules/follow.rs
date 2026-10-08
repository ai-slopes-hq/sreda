//! FOLLOW: an envelope follower — sound to a CV and a gate.

use crate::dsp::{Ctx, Dsp, Io};
use crate::spec::{knob, port, ModuleSpec, Role, Unit};

pub fn spec() -> ModuleSpec {
    ModuleSpec {
        type_: "follow",
        internal: false,
        label: "FOLLOW",
        desc: "envelope follower: sound to CV and gate",
        size: (6, 1),
        inputs: vec![port("in", "IN", Role::Audio)],
        outputs: vec![
            port("env", "ENV", Role::Mod),
            port("gate", "GATE", Role::Trigger),
        ],
        params: vec![
            knob("atk", "ATK", 0.001, 1.0, 0.01)
                .exp()
                .unit(Unit::S)
                .into(),
            knob("rel", "REL", 0.01, 4.0, 0.2)
                .exp()
                .unit(Unit::S)
                .into(),
            knob("gain", "GAIN", 0.0, 2.0, 1.0).into(),
            knob("thr", "THR", 0.0, 1.0, 0.3).into(),
        ],
        normals: vec![],
        display: None,
    }
}

pub struct Follow {
    sample_rate: f64,
    env: f64,
    gate: bool,
}

impl Follow {
    pub fn new(sample_rate: f64) -> Self {
        Follow {
            sample_rate,
            env: 0.0,
            gate: false,
        }
    }
}

impl Dsp for Follow {
    fn process(&mut self, io: &mut Io, _ctx: &mut Ctx, from: usize, to: usize) {
        for i in from..to {
            let x = (io.inp[0][i].abs() * io.par[2][i]) as f64;
            let t = if x > self.env {
                io.par[0][i]
            } else {
                io.par[1][i]
            } as f64;
            self.env += (1.0 - (-1.0 / (t * self.sample_rate)).exp()) * (x - self.env) + 1e-20;
            self.env = self.env.clamp(0.0, 1.0);
            let thr = io.par[3][i] as f64;
            if self.env > thr {
                self.gate = true;
            } else if self.env < thr - 0.02 {
                self.gate = false;
            }
            io.out[0][i] = self.env as f32;
            io.out[1][i] = if self.gate { 1.0 } else { 0.0 };
        }
    }

    fn reset(&mut self) {
        self.env = 0.0;
        self.gate = false;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::dsp::bench::Bench;
    use crate::dsp::BLOCK;

    #[test]
    fn a_burst_raises_env_and_gate_then_env_falls_over_rel() {
        let sr = 48_000.0;
        let mut b = Bench::new(sr, 1, &[0.005, 0.1, 1.0, 0.3], &[], 2);
        b.connected_in = vec![true];
        // 0.2 s of a loud 200 Hz tone, then silence
        let o = b.run(
            &mut Follow::new(sr),
            (0.6 * sr) as usize / BLOCK,
            |blk, i, inp| {
                let n = blk * BLOCK + i;
                inp[0][i] = if n < 9600 {
                    (std::f64::consts::TAU * 200.0 * n as f64 / sr).sin() as f32 * 0.9
                } else {
                    0.0
                };
            },
        );
        assert!(o[0][9000] > 0.5, "env up: {}", o[0][9000]);
        assert_eq!(o[1][9000], 1.0, "gate on");
        // REL is the release time constant: after REL the envelope is down to about 1/e
        let ratio = o[0][9600 + 4800] / o[0][9600];
        assert!(
            (ratio - (-1.0f32).exp()).abs() < 0.05,
            "env after REL: {ratio} of where it was"
        );
        assert_eq!(o[1][9600 + 14_400], 0.0, "gate off");
        assert!(o[0].iter().all(|x| (0.0..=1.0).contains(x)));
    }

    #[test]
    fn blockwise_equals_per_sample() {
        let x: Vec<f32> = (0..20 * BLOCK)
            .map(|i| (i as f32 * 0.07).sin() * if i % 1000 < 500 { 1.0 } else { 0.1 })
            .collect();
        Bench::blockwise_equals_per_sample(
            || Box::new(Follow::new(48_000.0)),
            &[x],
            &[0.002, 0.05, 1.5, 0.4],
            &[],
            2,
            20,
        );
    }
}
