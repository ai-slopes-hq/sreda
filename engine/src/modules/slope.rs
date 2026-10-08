//! SLOPE: a rise / fall function generator (Serge DUSG / Maths): triggered, cycling or slewing.

use crate::dsp::{Ctx, Dsp, Io};
use crate::spec::{choice, knob, port, ModuleSpec, Normal, Role, Unit, When};

pub fn spec() -> ModuleSpec {
    ModuleSpec {
        type_: "slope",
        internal: false,
        label: "SLOPE",
        desc: "rise / fall, cycle, slew",
        size: (5, 1),
        inputs: vec![
            port("trig", "TRIG", Role::Trigger),
            port("in", "IN", Role::Audio),
        ],
        outputs: vec![
            port("out", "OUT", Role::Mod),
            port("eor", "EOR", Role::Trigger),
            port("eoc", "EOC", Role::Trigger),
        ],
        params: vec![
            knob("rise", "RISE", 0.0005, 20.0, 0.01)
                .exp()
                .unit(Unit::S)
                .random(0.002, 1.0)
                .into(),
            knob("fall", "FALL", 0.0005, 20.0, 0.3)
                .exp()
                .unit(Unit::S)
                .random(0.02, 2.0)
                .into(),
            knob("shape", "SHP", -1.0, 1.0, 0.0).glyph("curve").into(),
            choice("cycle", "CYC", &["OFF", "ON"], 0).into(),
        ],
        normals: vec![Normal::Own {
            input: "trig",
            own: "eoc",
            when: Some(When {
                param: "cycle",
                value: 1,
            }),
        }],
        display: None,
    }
}

// inputs, knobs, options and outputs by position
const TRIG: usize = 0;
const IN: usize = 1;
const RISE: usize = 0;
const FALL: usize = 1;
const SHAPE: usize = 2;
const CYCLE: usize = 0;
const OUT: usize = 0;
const EOR: usize = 1;
const EOC: usize = 2;

#[derive(Clone, Copy, PartialEq)]
enum Phase {
    Idle,
    Rising,
    Falling,
}

pub struct Slope {
    sample_rate: f64,
    phase: Phase,
    /// progress through the current segment, 0…1
    x: f64,
    /// where the segment started
    from: f64,
    value: f64,
    trig_high: bool,
    pulse: u32,
    eor_left: u32,
    eoc_left: u32,
}

impl Slope {
    pub fn new(sample_rate: f64) -> Self {
        Slope {
            sample_rate,
            phase: Phase::Idle,
            x: 0.0,
            from: 0.0,
            value: 0.0,
            trig_high: false,
            pulse: ((0.001 * sample_rate).round() as u32).max(1),
            eor_left: 0,
            eoc_left: 0,
        }
    }

    fn start_rise(&mut self) {
        self.phase = Phase::Rising;
        self.x = 0.0;
        self.from = self.value;
    }
}

/// The segment's curve: s > 0 bends toward exponential, s < 0 toward logarithmic.
fn curve(x: f64, s: f64) -> f64 {
    if s > 0.0 {
        x.powf(1.0 + 2.0 * s)
    } else if s < 0.0 {
        1.0 - (1.0 - x).powf(1.0 - 2.0 * s)
    } else {
        x
    }
}

impl Dsp for Slope {
    fn process(&mut self, io: &mut Io, _ctx: &mut Ctx, from: usize, to: usize) {
        let cycle = io.fixed[CYCLE] as u32 == 1;
        let (trig_patched, in_patched) = (io.connected_in[TRIG], io.connected_in[IN]);
        for i in from..to {
            let high = io.inp[TRIG][i] > 0.5;
            let rise = high && !self.trig_high;
            self.trig_high = high;
            let (rise_s, fall_s, shape) = (
                io.par[RISE][i] as f64,
                io.par[FALL][i] as f64,
                io.par[SHAPE][i] as f64,
            );
            if rise || (cycle && !trig_patched && self.phase == Phase::Idle) {
                self.start_rise();
            }
            match self.phase {
                Phase::Rising => {
                    self.x += 1.0 / (rise_s * self.sample_rate).max(1.0);
                    if self.x >= 1.0 {
                        self.value = 1.0;
                        self.phase = Phase::Falling;
                        self.x = 0.0;
                        self.from = 1.0;
                        self.eor_left = self.pulse;
                    } else {
                        self.value = self.from + (1.0 - self.from) * curve(self.x, shape);
                    }
                }
                Phase::Falling => {
                    self.x += 1.0 / (fall_s * self.sample_rate).max(1.0);
                    if self.x >= 1.0 {
                        self.value = 0.0;
                        self.phase = Phase::Idle;
                        self.eoc_left = self.pulse;
                    } else {
                        self.value = self.from * curve(1.0 - self.x, shape);
                    }
                }
                Phase::Idle if in_patched => {
                    // slew toward IN: full scale per RISE going up, per FALL going down
                    let target = io.inp[IN][i] as f64;
                    let d = target - self.value;
                    let step = if d > 0.0 {
                        1.0 / (rise_s * self.sample_rate).max(1.0)
                    } else {
                        1.0 / (fall_s * self.sample_rate).max(1.0)
                    };
                    self.value = if d.abs() <= step {
                        target
                    } else {
                        self.value + step * d.signum()
                    };
                }
                Phase::Idle => {}
            }
            io.out[OUT][i] = self.value as f32;
            io.out[EOR][i] = if self.eor_left > 0 { 1.0 } else { 0.0 };
            io.out[EOC][i] = if self.eoc_left > 0 { 1.0 } else { 0.0 };
            self.eor_left = self.eor_left.saturating_sub(1);
            self.eoc_left = self.eoc_left.saturating_sub(1);
        }
    }

    fn reset(&mut self) {
        let sr = self.sample_rate;
        *self = Slope::new(sr);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::dsp::bench::Bench;
    use crate::dsp::BLOCK;

    const OUT: usize = 0;
    const EOR: usize = 1;
    const EOC: usize = 2;

    fn bench(sr: f64, rise: f64, fall: f64, cycle: f64) -> Bench {
        Bench::new(sr, 2, &[rise, fall, 0.0], &[cycle], 3)
    }
    fn first_above(s: &[f32], x: f32) -> Option<usize> {
        s.iter().position(|v| *v >= x)
    }

    fn reaches_one_in(sr: f64) -> (usize, usize) {
        let mut b = bench(sr, 0.01, 0.1, 0.0);
        b.connected_in[0] = true;
        let o = b.run(&mut Slope::new(sr), 20, |blk, i, inp| {
            inp[0][i] = if blk == 0 && i < 48 { 1.0 } else { 0.0 }
        });
        (
            first_above(&o[OUT], 0.9999).expect("reaches 1"),
            first_above(&o[EOR], 0.5).expect("an EOR pulse"),
        )
    }

    #[test]
    fn a_trigger_rises_over_rise_seconds_with_an_eor_pulse() {
        let (top, eor) = reaches_one_in(48_000.0);
        assert!((top as i64 - 480).abs() <= 1, "top at {top}");
        assert!((eor as i64 - 480).abs() <= 2, "EOR at {eor}");
        let (top, _) = reaches_one_in(44_100.0);
        assert!((top as i64 - 441).abs() <= 1, "44.1 k: top at {top}");
    }

    #[test]
    fn it_falls_over_fall_seconds_and_fires_eoc() {
        let sr = 48_000.0;
        let mut b = bench(sr, 0.01, 0.1, 0.0);
        b.connected_in[0] = true;
        let o = b.run(&mut Slope::new(sr), 60, |blk, i, inp| {
            inp[0][i] = if blk == 0 && i < 48 { 1.0 } else { 0.0 }
        });
        let eoc = first_above(&o[EOC], 0.5).expect("an EOC pulse");
        assert!((eoc as i64 - (480 + 4800)).abs() <= 3, "EOC at {eoc}");
        assert!(o[OUT][eoc + 10].abs() < 1e-6);
    }

    #[test]
    fn exp_shape_falls_concave_up_and_log_shape_bulges() {
        let half_fall = |shape: f64| {
            let sr = 48_000.0;
            let mut b = Bench::new(sr, 2, &[0.001, 0.1, shape], &[0.0], 3);
            b.connected_in[0] = true;
            let o = b.run(&mut Slope::new(sr), 60, |blk, i, inp| {
                inp[0][i] = if blk == 0 && i < 48 { 1.0 } else { 0.0 }
            });
            // the rise takes 48 samples; half way through the 4800-sample fall
            o[OUT][48 + 2400]
        };
        assert!(
            half_fall(1.0) < 0.2,
            "exp: a quick drop then a long tail: {}",
            half_fall(1.0)
        );
        assert!(
            half_fall(-1.0) > 0.8,
            "log: holds up then drops: {}",
            half_fall(-1.0)
        );
        assert!(
            (half_fall(0.0) - 0.5).abs() < 0.02,
            "lin: {}",
            half_fall(0.0)
        );
    }

    #[test]
    fn cycle_runs_by_itself_and_repeats() {
        let sr = 48_000.0;
        let mut b = bench(sr, 0.005, 0.005, 1.0);
        let o = b.run(&mut Slope::new(sr), 40, |_, _, _| {});
        let eocs = o[EOC]
            .windows(2)
            .filter(|w| w[0] <= 0.5 && w[1] > 0.5)
            .count();
        assert!(eocs >= 4, "{eocs} cycles in ~0.1 s");
    }

    #[test]
    fn an_audio_rate_trigger_keeps_out_in_range() {
        let sr = 48_000.0;
        let mut b = bench(sr, 0.002, 0.002, 0.0);
        b.connected_in[0] = true;
        let o = b.run(&mut Slope::new(sr), 400, |blk, i, inp| {
            inp[0][i] = if (blk * BLOCK + i) % 24 < 12 {
                1.0
            } else {
                0.0
            }
        });
        assert!(o[OUT]
            .iter()
            .all(|v| v.is_finite() && (0.0..=1.0).contains(v)));
    }

    #[test]
    fn a_patched_input_is_slewed() {
        let sr = 48_000.0;
        let mut b = bench(sr, 0.01, 0.01, 0.0);
        b.connected_in[1] = true;
        let o = b.run(&mut Slope::new(sr), 10, |_, i, inp| inp[1][i] = 0.5);
        assert!(
            o[OUT][100] > 0.0 && o[OUT][100] < 0.5,
            "on its way: {}",
            o[OUT][100]
        );
        assert!((o[OUT][10 * BLOCK - 1] - 0.5).abs() < 1e-6, "arrived");
    }

    #[test]
    fn blockwise_equals_per_sample() {
        let n = 30 * BLOCK;
        let trig: Vec<f32> = (0..n)
            .map(|i| if i % 900 < 48 { 1.0 } else { 0.0 })
            .collect();
        let input: Vec<f32> = (0..n).map(|i| (i as f32 * 0.003).sin()).collect();
        Bench::blockwise_equals_per_sample(
            || Box::new(Slope::new(48_000.0)),
            &[trig, input],
            &[0.004, 0.006, 0.4],
            &[0.0],
            3,
            30,
        );
    }
}
