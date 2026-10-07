//! DELAY: up to 2 s with feedback and a dry / wet mix.

use crate::dsp::{Ctx, Dsp, Io};
use crate::spec::{knob, port, ModuleSpec, Role, Unit};

pub fn spec() -> ModuleSpec {
    ModuleSpec {
        type_: "delay",
        label: "DELAY",
        desc: "echo",
        size: (5, 1),
        inputs: vec![port("in", "IN", Role::Audio)],
        outputs: vec![port("out", "OUT", Role::Audio)],
        params: vec![
            knob("time", "TIME", 0.001, 2.0, 0.3)
                .exp()
                .unit(Unit::S)
                .random(0.05, 1.0)
                .into(),
            knob("feedback", "FB", 0.0, 0.95, 0.4).into(),
            knob("mix", "MIX", 0.0, 1.0, 0.3).into(),
        ],
        normals: vec![],
        display: None,
    }
}

const MAX_S: f64 = 2.0;

pub struct Delay {
    sample_rate: f64,
    buf: Vec<f32>,
    write: usize,
}

impl Delay {
    pub fn new(sample_rate: f64) -> Self {
        // allocated here, never in process
        Delay {
            sample_rate,
            buf: vec![0.0; (MAX_S * sample_rate) as usize + 4],
            write: 0,
        }
    }
}

impl Dsp for Delay {
    fn process(&mut self, io: &mut Io, _ctx: &mut Ctx, from: usize, to: usize) {
        let n = self.buf.len();
        for i in from..to {
            let d = (io.par[0][i] as f64 * self.sample_rate).clamp(1.0, (n - 2) as f64);
            let pos = self.write as f64 - d + n as f64;
            let (i0, frac) = (pos.floor() as usize % n, (pos - pos.floor()) as f32);
            let wet = self.buf[i0] * (1.0 - frac) + self.buf[(i0 + 1) % n] * frac;
            let x = io.inp[0][i];
            self.buf[self.write] = x + wet * io.par[1][i] + 1e-20;
            self.write = (self.write + 1) % n;
            let mix = io.par[2][i];
            io.out[0][i] = x * (1.0 - mix) + wet * mix;
        }
    }

    fn reset(&mut self) {
        self.buf.fill(0.0);
        self.write = 0;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::dsp::bench::Bench;
    use crate::dsp::BLOCK;

    fn impulse(sr: f64, time: f64, fb: f64, blocks: usize) -> Vec<f32> {
        let mut b = Bench::new(sr, 1, &[time, fb, 1.0], &[], 1);
        b.connected_in = vec![true];
        b.run(&mut Delay::new(sr), blocks, |blk, i, inp| {
            inp[0][i] = if blk == 0 && i == 0 { 1.0 } else { 0.0 }
        })
        .remove(0)
    }
    fn peak_at(s: &[f32]) -> usize {
        s.iter()
            .enumerate()
            .fold(
                (0, 0.0f32),
                |a, (i, x)| if x.abs() > a.1 { (i, x.abs()) } else { a },
            )
            .0
    }

    #[test]
    fn an_echo_comes_after_time_at_48k_and_44k1() {
        for sr in [48_000.0, 44_100.0] {
            let o = impulse(sr, 0.1, 0.0, (0.15 * sr) as usize / BLOCK);
            let at = peak_at(&o);
            assert!((at as f64 - 0.1 * sr).abs() <= 1.0, "{sr}: echo at {at}");
        }
    }

    #[test]
    fn feedback_half_halves_the_next_echo() {
        let o = impulse(48_000.0, 0.05, 0.5, 60);
        let (a, b) = (
            o[2400].abs().max(o[2401].abs()),
            o[4800].abs().max(o[4801].abs()),
        );
        assert!((b / a - 0.5).abs() < 0.02, "{a} then {b}");
    }

    #[test]
    fn blockwise_equals_per_sample() {
        let x: Vec<f32> = (0..30 * BLOCK)
            .map(|i| if i % 500 == 0 { 1.0 } else { 0.0 })
            .collect();
        Bench::blockwise_equals_per_sample(
            || Box::new(Delay::new(48_000.0)),
            &[x],
            &[0.013, 0.6, 0.5],
            &[],
            1,
            30,
        );
    }
}
