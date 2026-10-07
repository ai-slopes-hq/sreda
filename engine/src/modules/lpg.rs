//! LPG: a low-pass gate and VCA in one. With nothing patched it is a VCA on LEVEL; a PING strikes a vactrol-like
//! envelope; a patched CV controls it directly.

use crate::dsp::{Ctx, Dsp, Io};
use crate::spec::{choice, knob, port, ModuleSpec, Normal, Role, Unit};

pub fn spec() -> ModuleSpec {
    ModuleSpec {
        type_: "lpg",
        label: "LPG",
        desc: "low-pass gate and VCA",
        size: (4, 1),
        inputs: vec![
            port("in", "IN", Role::Audio),
            port("cv", "CV", Role::Mod),
            port("ping", "PING", Role::Trigger),
        ],
        outputs: vec![port("out", "OUT", Role::Audio)],
        params: vec![
            knob("level", "LVL", 0.0, 1.0, 1.0).into(),
            knob("decay", "DEC", 0.05, 4.0, 0.4)
                .exp()
                .unit(Unit::S)
                .random(0.08, 1.5)
                .into(),
            choice("mode", "MODE", &["VCA", "LP", "BOTH"], 2).into(),
        ],
        normals: vec![Normal::Internal {
            input: "cv",
            internal: "ping envelope, or 1 with PING unpatched",
        }],
        display: None,
    }
}

const IN: usize = 0;
const CV: usize = 1;
const PING: usize = 2;
const LEVEL: usize = 0;
const DECAY: usize = 1;
const MODE: usize = 0;

pub struct Lpg {
    sample_rate: f64,
    env: f64,
    /// attacking toward 1 (2 ms), then decaying
    attack: bool,
    ping_high: bool,
    lp: f64,
}

impl Lpg {
    pub fn new(sample_rate: f64) -> Self {
        Lpg {
            sample_rate,
            env: 0.0,
            attack: false,
            ping_high: false,
            lp: 0.0,
        }
    }
}

impl Dsp for Lpg {
    fn process(&mut self, io: &mut Io, _ctx: &mut Ctx, from: usize, to: usize) {
        let mode = io.fixed[MODE] as u32;
        let (cv_patched, ping_patched) = (io.connected_in[CV], io.connected_in[PING]);
        let attack_step = 1.0 / (0.002 * self.sample_rate);
        for i in from..to {
            let high = io.inp[PING][i] > 0.5;
            if high && !self.ping_high {
                self.attack = true;
            }
            self.ping_high = high;
            if self.attack {
                self.env += attack_step;
                if self.env >= 1.0 {
                    self.env = 1.0;
                    self.attack = false;
                }
            } else {
                // −60 dB over DECAY seconds
                self.env *= 0.001f64.powf(1.0 / (io.par[DECAY][i] as f64 * self.sample_rate));
            }
            let c = if cv_patched {
                (io.inp[CV][i] as f64).clamp(0.0, 1.0)
            } else if ping_patched {
                self.env
            } else {
                1.0
            };
            let g = io.par[LEVEL][i] as f64 * c;
            let x = io.inp[IN][i] as f64;
            let y = if mode == 0 {
                x * g
            } else {
                // a one-pole low-pass at 20 Hz … 20 kHz, opened by g
                let f = 20.0 * 1000f64.powf(g);
                let a = 1.0 - (-std::f64::consts::TAU * f / self.sample_rate).exp();
                self.lp += a * (x - self.lp) + 1e-20;
                if mode == 1 {
                    self.lp
                } else {
                    self.lp * g
                }
            };
            io.out[0][i] = y as f32;
        }
    }

    fn reset(&mut self) {
        let sr = self.sample_rate;
        *self = Lpg::new(sr);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::dsp::bench::Bench;
    use crate::dsp::BLOCK;

    const VCA: f64 = 0.0;
    const LP: f64 = 1.0;

    fn decay_time(sr: f64, decay: f64) -> f64 {
        let mut b = Bench::new(sr, 3, &[1.0, decay], &[VCA], 1);
        b.connected_in = vec![true, false, true];
        let blocks = ((decay + 0.2) * sr) as usize / BLOCK;
        let o = b.run(&mut Lpg::new(sr), blocks, |blk, i, inp| {
            inp[0][i] = 1.0;
            inp[2][i] = if blk == 0 && i < 48 { 1.0 } else { 0.0 };
        });
        let peak = o[0].iter().position(|v| *v >= 0.999).expect("reaches full");
        let quiet = o[0][peak..]
            .iter()
            .position(|v| *v < 0.001)
            .expect("decays")
            + peak;
        (quiet - peak) as f64 / sr
    }

    #[test]
    fn a_ping_decays_by_60_db_over_decay() {
        for sr in [48_000.0, 44_100.0] {
            let t = decay_time(sr, 0.4);
            assert!((t - 0.4).abs() < 0.02, "{sr}: −60 dB after {t} s");
        }
    }

    fn rms(s: &[f32]) -> f32 {
        (s.iter().map(|x| x * x).sum::<f32>() / s.len() as f32).sqrt()
    }

    #[test]
    fn with_nothing_patched_it_is_a_vca_on_level() {
        let mut b = Bench::new(48_000.0, 3, &[0.5, 0.4], &[VCA], 1);
        b.connected_in = vec![true, false, false];
        let o = b.run(&mut Lpg::new(48_000.0), 4, |_, i, inp| {
            inp[0][i] = (i as f32 * 0.1).sin()
        });
        for (n, y) in o[0].iter().enumerate() {
            assert!((y - 0.5 * ((n % BLOCK) as f32 * 0.1).sin()).abs() < 1e-6);
        }
    }

    #[test]
    fn lp_mode_darkens_more_than_vca_mode() {
        let tone = |mode: f64| {
            let mut b = Bench::new(48_000.0, 3, &[0.25, 0.4], &[mode], 1);
            b.connected_in = vec![true, false, false];
            let o = b.run(&mut Lpg::new(48_000.0), 40, |blk, i, inp| {
                inp[0][i] = (std::f64::consts::TAU * 10_000.0 * (blk * BLOCK + i) as f64 / 48_000.0)
                    .sin() as f32;
            });
            rms(&o[0][2000..])
        };
        assert!(
            tone(LP) < 0.2 * tone(VCA),
            "LP {} vs VCA {}",
            tone(LP),
            tone(VCA)
        );
    }

    #[test]
    fn a_patched_cv_controls_the_gate() {
        let mut b = Bench::new(48_000.0, 3, &[1.0, 0.4], &[VCA], 1);
        b.connected_in = vec![true, true, true];
        let o = b.run(&mut Lpg::new(48_000.0), 2, |_, i, inp| {
            inp[0][i] = 1.0;
            inp[1][i] = 0.3;
            inp[2][i] = if i < 48 { 1.0 } else { 0.0 };
        });
        assert!(
            (o[0][200] - 0.3).abs() < 1e-6,
            "CV wins over the ping: {}",
            o[0][200]
        );
    }

    #[test]
    fn blockwise_equals_per_sample() {
        let n = 30 * BLOCK;
        let input: Vec<f32> = (0..n).map(|i| (i as f32 * 0.05).sin()).collect();
        let cv = Vec::new(); // unpatched: the envelope controls the gate
        let ping: Vec<f32> = (0..n)
            .map(|i| if i % 1000 < 48 { 1.0 } else { 0.0 })
            .collect();
        let make = || -> Box<dyn Dsp> { Box::new(Lpg::new(48_000.0)) };
        for mode in [0.0, 1.0, 2.0] {
            Bench::blockwise_equals_per_sample(
                make,
                &[input.clone(), cv.clone(), ping.clone()],
                &[0.8, 0.1],
                &[mode],
                1,
                30,
            );
        }
    }
}
