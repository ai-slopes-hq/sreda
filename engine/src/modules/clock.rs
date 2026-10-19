//! A frame's clock (spec §5), compiled from each frame; never offered in the picker. What CLK OUT carries, highest
//! priority first: a cable in CLK IN; the frame's own clock (ON, one 1 ms pulse per beat at BPM); the parent frame's
//! clock arriving as CLK IN's normal, after this frame's ratio. Both inputs arrive prepared as 1 ms pulses.

use crate::dsp::{Ctx, Dsp, Io};
use crate::spec::{choice, knob, port, ModuleSpec, Role};

pub fn spec() -> ModuleSpec {
    ModuleSpec {
        type_: "clock",
        internal: true,
        label: "CLOCK",
        desc: "a frame's clock",
        size: (1, 1),
        inputs: vec![port("clk", "CLK", Role::Trigger)],
        outputs: vec![port("out", "CLK", Role::Trigger)],
        params: vec![
            choice("on", "ON", &["OFF", "ON"], 0).hidden().into(),
            knob("bpm", "BPM", 20.0, 300.0, 120.0).hidden().into(),
        ],
        normals: vec![],
        display: None,
    }
}

/// The beat both clocks share (a frame's and CLOCK's): one 1 ms pulse per beat, the first as soon as it runs.
pub(crate) struct Beat {
    pulse: u32,
    /// 0…1 through the beat; a tick when it reaches 1
    phase: f64,
    left: u32,
    was_on: bool,
}

impl Beat {
    pub(crate) fn new(sample_rate: f64) -> Beat {
        Beat {
            pulse: ((0.001 * sample_rate).round() as u32).max(1),
            phase: 0.0,
            left: 0,
            was_on: false,
        }
    }

    /// One sample: 1.0 while a pulse is high, else 0.0. `step` is beats per sample; while `run` is false the beat
    /// rests (0.0), and the next sample it runs starts a beat.
    pub(crate) fn next(&mut self, run: bool, step: f64) -> f32 {
        if !run {
            self.was_on = false;
            return 0.0;
        }
        if !self.was_on {
            self.phase = 1.0; // the first tick comes at once
            self.was_on = true;
        }
        if self.phase >= 1.0 {
            self.phase -= 1.0;
            self.left = self.pulse;
        }
        self.phase += step;
        let high = self.left > 0;
        self.left = self.left.saturating_sub(1);
        if high {
            1.0
        } else {
            0.0
        }
    }
}

pub struct Clock {
    sample_rate: f64,
    beat: Beat,
    out_high: bool,
    ticks: u32,
}

impl Clock {
    pub fn new(sample_rate: f64) -> Self {
        Clock {
            sample_rate,
            beat: Beat::new(sample_rate),
            out_high: false,
            ticks: 0,
        }
    }
}

impl Dsp for Clock {
    fn process(&mut self, io: &mut Io, _ctx: &mut Ctx, from: usize, to: usize) {
        let on = io.fixed[0] >= 0.5;
        let step = io.fixed[1].clamp(20.0, 300.0) / (60.0 * self.sample_rate);
        // a cable in CLK IN stops the own clock; without one, the own clock runs while ON
        let own = on && !io.connected_in[0];
        for i in from..to {
            let beat = self.beat.next(own, step);
            let v = if own { beat } else { io.inp[0][i] };
            let high = v > 0.5;
            if high && !self.out_high {
                self.ticks = (self.ticks + 1) & 0xFF_FFFF;
            }
            self.out_high = high;
            io.out[0][i] = v;
        }
    }

    fn reset(&mut self) {
        *self = Clock::new(self.sample_rate);
    }

    fn state(&self) -> f32 {
        self.ticks as f32
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::dsp::bench::Bench;
    use crate::dsp::BLOCK;

    fn rises(s: &[f32]) -> Vec<usize> {
        (0..s.len())
            .filter(|&i| s[i] > 0.5 && (i == 0 || s[i - 1] <= 0.5))
            .collect()
    }

    fn own(sr: f64, bpm: f64, blocks: usize) -> (Vec<f32>, Clock) {
        let mut b = Bench::new(sr, 1, &[], &[1.0, bpm], 1);
        let mut c = Clock::new(sr);
        let o = b.run(&mut c, blocks, |_, _, _| {});
        (o[0].clone(), c)
    }

    #[test]
    fn its_own_clock_ticks_once_per_beat_with_1_ms_pulses() {
        let (o, c) = own(48_000.0, 120.0, 800);
        let r = rises(&o);
        assert_eq!(r[0], 0, "the first tick comes at once");
        for w in r.windows(2) {
            assert!((w[1] - w[0]).abs_diff(24_000) <= 1, "{}", w[1] - w[0]);
        }
        let high = o[r[1]..r[1] + 60].iter().filter(|x| **x > 0.5).count();
        assert_eq!(high, 48);
        assert_eq!(c.state() as usize, r.len());
        let (o, _) = own(44_100.0, 120.0, 800);
        let r = rises(&o);
        for w in r.windows(2) {
            assert!((w[1] - w[0]).abs_diff(22_050) <= 1, "{}", w[1] - w[0]);
        }
    }

    #[test]
    fn a_cable_in_clk_in_wins_over_the_own_clock() {
        let mut b = Bench::new(48_000.0, 1, &[], &[1.0, 120.0], 1);
        b.connected_in = vec![true];
        let o = b.run(&mut Clock::new(48_000.0), 100, |blk, i, inp| {
            inp[0][i] = if (blk * BLOCK + i) % 1000 < 48 {
                1.0
            } else {
                0.0
            };
        });
        assert_eq!(rises(&o[0]), (0..13).map(|k| k * 1000).collect::<Vec<_>>());
    }

    #[test]
    fn with_its_clock_off_it_passes_the_parent_normal() {
        let mut b = Bench::new(48_000.0, 1, &[], &[0.0, 120.0], 1);
        let o = b.run(&mut Clock::new(48_000.0), 100, |blk, i, inp| {
            inp[0][i] = if (blk * BLOCK + i) % 3000 < 48 {
                1.0
            } else {
                0.0
            };
        });
        assert_eq!(rises(&o[0]), (0..5).map(|k| k * 3000).collect::<Vec<_>>());
    }

    #[test]
    fn a_bpm_change_keeps_the_phase() {
        let mut b = Bench::new(48_000.0, 1, &[], &[1.0, 120.0], 1);
        let mut c = Clock::new(48_000.0);
        let first = b.run(&mut c, 100, |_, _, _| {}); // 12 800 samples: half a beat at 120
        b.fixed[1] = 240.0;
        let rest = b.run(&mut c, 200, |_, _, _| {});
        assert_eq!(rises(&first[0]), vec![0]);
        let r = rises(&rest[0]);
        // 11 200 of the beat's 24 000 samples were left at 120 BPM; at 240 BPM that part of a beat takes 5 600
        assert!(r[0].abs_diff(5_600) <= 1, "{}", r[0]);
        assert!(r[1] - r[0] <= 12_001);
    }

    #[test]
    fn blockwise_equals_per_sample() {
        let t: Vec<f32> = (0..20 * BLOCK)
            .map(|i| if i % 700 < 48 { 1.0 } else { 0.0 })
            .collect();
        Bench::blockwise_equals_per_sample(
            || Box::new(Clock::new(48_000.0)),
            &[t],
            &[],
            &[0.0, 120.0],
            1,
            20,
        );
        Bench::blockwise_equals_per_sample(
            || Box::new(Clock::new(48_000.0)),
            &[vec![]],
            &[],
            &[1.0, 300.0],
            1,
            200,
        );
    }
}
