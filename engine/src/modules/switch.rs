//! SWITCH (4 → 1) and SPREAD (1 → 4): sequential switches stepped by ADV, reset by RST, addressed by ADDR; a 5 ms
//! crossfade between ports.

use crate::dsp::{Ctx, Dsp, Io};
use crate::spec::{choice, knob, port, ModuleSpec, Role};

pub fn switch_spec() -> ModuleSpec {
    ModuleSpec {
        type_: "switch",
        internal: false,
        label: "SWITCH",
        desc: "sequential switch 4 → 1",
        size: (4, 2),
        inputs: vec![
            port("in1", "IN1", Role::Audio),
            port("in2", "IN2", Role::Audio),
            port("in3", "IN3", Role::Audio),
            port("in4", "IN4", Role::Audio),
            port("adv", "ADV", Role::Trigger),
            port("reset", "RST", Role::Trigger),
            port("addr", "ADDR", Role::Mod),
        ],
        outputs: vec![port("out", "OUT", Role::Audio)],
        params: vec![
            knob("len", "LEN", 2.0, 4.0, 4.0).step(1.0).into(),
            choice("mode", "MODE", &["SEQ", "RAND"], 0).into(),
        ],
        normals: vec![],
        display: None,
    }
}

pub fn spread_spec() -> ModuleSpec {
    ModuleSpec {
        type_: "spread",
        internal: false,
        label: "SPREAD",
        desc: "sequential switch 1 → 4",
        size: (4, 2),
        inputs: vec![
            port("in", "IN", Role::Audio),
            port("adv", "ADV", Role::Trigger),
            port("reset", "RST", Role::Trigger),
            port("addr", "ADDR", Role::Mod),
        ],
        outputs: vec![
            port("out1", "OUT1", Role::Audio),
            port("out2", "OUT2", Role::Audio),
            port("out3", "OUT3", Role::Audio),
            port("out4", "OUT4", Role::Audio),
        ],
        params: vec![
            knob("len", "LEN", 2.0, 4.0, 4.0).step(1.0).into(),
            choice("mode", "MODE", &["SEQ", "RAND"], 0).into(),
        ],
        normals: vec![],
        display: None,
    }
}

/// One switch; `spread` picks which side has four ports.
pub struct Switch {
    spread: bool,
    index: usize,
    from: usize,
    fade_pos: f64,
    fade_len: f64,
    adv_high: bool,
    reset_high: bool,
}

impl Switch {
    pub fn new(sample_rate: f64, spread: bool) -> Self {
        let fade_len = 0.005 * sample_rate;
        Switch {
            spread,
            index: 0,
            from: 0,
            fade_pos: fade_len,
            fade_len,
            adv_high: false,
            reset_high: false,
        }
    }

    fn go(&mut self, to: usize) {
        if to != self.index {
            self.from = self.index;
            self.index = to;
            self.fade_pos = 0.0;
        }
    }
}

impl Dsp for Switch {
    fn process(&mut self, io: &mut Io, ctx: &mut Ctx, from: usize, to: usize) {
        // the ports: SWITCH in1–4 · adv · reset · addr; SPREAD in · adv · reset · addr
        let base = if self.spread { 1 } else { 4 };
        let (adv, reset, addr) = (base, base + 1, base + 2);
        let addr_patched = io.connected_in[addr];
        let rand = io.fixed[0] as u32 == 1;
        for i in from..to {
            let len = (io.par[0][i].round() as usize).clamp(2, 4);
            let a = io.inp[adv][i] > 0.5;
            let r = io.inp[reset][i] > 0.5;
            if addr_patched {
                self.go(((io.inp[addr][i] as f64).clamp(0.0, 0.999) * len as f64) as usize);
            } else if a && !self.adv_high {
                let next = if rand {
                    // another port within LEN, at random
                    let k = (ctx.rng.next_f64() * (len - 1) as f64) as usize;
                    if self.index < len && k >= self.index {
                        k + 1
                    } else {
                        k
                    }
                } else {
                    (self.index + 1) % len
                };
                self.go(next);
            }
            if r && !self.reset_high {
                self.go(0);
            }
            self.adv_high = a;
            self.reset_high = r;
            let t = (self.fade_pos / self.fade_len).min(1.0) as f32;
            self.fade_pos += 1.0;
            if self.spread {
                for k in 0..4 {
                    let w = if k == self.index {
                        t
                    } else if k == self.from {
                        1.0 - t
                    } else {
                        0.0
                    };
                    io.out[k][i] = io.inp[0][i] * w;
                }
            } else {
                io.out[0][i] = io.inp[self.from][i] * (1.0 - t) + io.inp[self.index][i] * t;
            }
        }
    }

    fn reset(&mut self) {
        self.index = 0;
        self.from = 0;
        self.fade_pos = self.fade_len;
    }

    fn state(&self) -> f32 {
        self.index as f32
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::dsp::bench::Bench;
    use crate::dsp::BLOCK;

    const TICK: usize = 1000;

    /// SWITCH with constant inputs 1, 2, 3, 4; ADV every TICK; returns OUT and the final index.
    fn switch(len: f64, addr: Option<f32>, ticks: usize) -> (Vec<f32>, f32) {
        let mut b = Bench::new(48_000.0, 7, &[len], &[0.0], 1);
        b.connected_in = vec![true, true, true, true, true, false, addr.is_some()];
        let mut s = Switch::new(48_000.0, false);
        let o = b.run(&mut s, (ticks * TICK).div_ceil(BLOCK), |blk, i, inp| {
            for (k, x) in inp.iter_mut().take(4).enumerate() {
                x[i] = (k + 1) as f32;
            }
            inp[4][i] = if (blk * BLOCK + i) % TICK < 48 {
                1.0
            } else {
                0.0
            };
            inp[6][i] = addr.unwrap_or(0.0);
        });
        (o.into_iter().next().unwrap(), s.state())
    }

    #[test]
    fn seq_cycles_within_len() {
        let (o, _) = switch(3.0, None, 7);
        let held: Vec<f32> = (0..7).map(|k| o[k * TICK + TICK - 10]).collect();
        assert_eq!(
            held,
            [2.0, 3.0, 1.0, 2.0, 3.0, 1.0, 2.0],
            "the first ADV steps from IN1 to IN2"
        );
    }

    #[test]
    fn addr_overrides_and_stays_in_range() {
        let (o, s) = switch(4.0, Some(0.6), 3);
        assert_eq!(o[3 * TICK - 10], 3.0);
        assert_eq!(s, 2.0);
        let (o, s) = switch(4.0, Some(2.0), 3);
        assert_eq!(o[3 * TICK - 10], 4.0);
        assert_eq!(s, 3.0);
    }

    #[test]
    fn spread_sends_in_to_one_output_at_a_time() {
        let mut b = Bench::new(48_000.0, 4, &[4.0], &[0.0], 4);
        b.connected_in = vec![true, true, false, false];
        let o = b.run(
            &mut Switch::new(48_000.0, true),
            (3 * TICK).div_ceil(BLOCK),
            |blk, i, inp| {
                inp[0][i] = 1.0;
                inp[1][i] = if (blk * BLOCK + i) % TICK < 48 && blk * BLOCK + i >= TICK {
                    1.0
                } else {
                    0.0
                };
            },
        );
        let at = |n: usize| (0..4).map(|k| o[k][n]).collect::<Vec<f32>>();
        assert_eq!(at(TICK - 10), [1.0, 0.0, 0.0, 0.0]);
        assert_eq!(at(2 * TICK - 10), [0.0, 1.0, 0.0, 0.0]);
    }

    #[test]
    fn an_audio_rate_adv_stays_finite() {
        let mut b = Bench::new(48_000.0, 7, &[4.0], &[1.0], 1);
        b.connected_in = vec![true, true, true, true, true, false, false];
        let o = b.run(&mut Switch::new(48_000.0, false), 400, |blk, i, inp| {
            for (k, x) in inp.iter_mut().take(4).enumerate() {
                x[i] = (k + 1) as f32;
            }
            inp[4][i] = if (blk * BLOCK + i) % 24 < 12 {
                1.0
            } else {
                0.0
            };
        });
        assert!(o[0]
            .iter()
            .all(|x| x.is_finite() && (0.0..=4.0).contains(x)));
    }

    #[test]
    fn blockwise_equals_per_sample() {
        let n = 20 * BLOCK;
        let s = |f: f32| (0..n).map(|i| (i as f32 * f).sin()).collect::<Vec<f32>>();
        let adv: Vec<f32> = (0..n)
            .map(|i| if i % 400 < 48 { 1.0 } else { 0.0 })
            .collect();
        Bench::blockwise_equals_per_sample(
            || Box::new(Switch::new(48_000.0, false)),
            &[s(0.1), s(0.2), s(0.3), s(0.4), adv.clone(), vec![], vec![]],
            &[3.0],
            &[1.0],
            1,
            20,
        );
        Bench::blockwise_equals_per_sample(
            || Box::new(Switch::new(48_000.0, true)),
            &[s(0.1), adv, vec![], vec![]],
            &[4.0],
            &[0.0],
            4,
            20,
        );
    }
}
