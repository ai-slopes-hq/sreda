//! SHIFT: delays triggers by part of the measured period — every event (ALL) or every second one (EVEN: swing).

use crate::dsp::{Ctx, Dsp, Io};
use crate::spec::{choice, knob, port, ModuleSpec, Role};

/// At most this many delayed events wait at once.
pub const MAX_PENDING: usize = 16;

pub fn spec() -> ModuleSpec {
    ModuleSpec {
        type_: "shift",
        internal: false,
        label: "SHIFT",
        desc: "delay triggers by part of the period · swing",
        size: (3, 1),
        inputs: vec![port("trig", "TRIG", Role::Trigger)],
        outputs: vec![port("out", "OUT", Role::Trigger)],
        params: vec![
            knob("amt", "AMT", 0.0, 1.0, 0.25).into(),
            choice("which", "WHICH", &["ALL", "EVEN"], 0).into(),
        ],
        normals: vec![],
        display: None,
    }
}

pub struct Shift {
    pulse: u64,
    now: u64,
    last: Option<u64>,
    period: Option<u64>,
    count: u64,
    /// when the delayed events fire, ascending
    queue: [u64; MAX_PENDING],
    len: usize,
    out_until: u64,
    gap: Option<u64>,
    trig_high: bool,
}

impl Shift {
    pub fn new(sample_rate: f64) -> Self {
        Shift {
            pulse: ((0.001 * sample_rate).round() as u64).max(1),
            now: 0,
            last: None,
            period: None,
            count: 0,
            queue: [0; MAX_PENDING],
            len: 0,
            out_until: 0,
            gap: None,
            trig_high: false,
        }
    }

    pub fn pending(&self) -> usize {
        self.len
    }

    fn fire(&mut self) {
        if self.out_until > self.now {
            self.gap = Some(self.now); // a new pulse during one: low for a sample so it reads as a new rise
        }
        self.out_until = self.now + self.pulse;
    }
}

impl Dsp for Shift {
    fn process(&mut self, io: &mut Io, _ctx: &mut Ctx, from: usize, to: usize) {
        let even = io.fixed[0] as u32 == 1;
        for i in from..to {
            let high = io.inp[0][i] > 0.5;
            if high && !self.trig_high {
                if let Some(l) = self.last {
                    self.period = Some(self.now - l);
                }
                self.last = Some(self.now);
                let delayed = !even || self.count % 2 == 1;
                self.count += 1;
                match self.period {
                    Some(p) if delayed => {
                        let due =
                            self.now + (io.par[0][i].clamp(0.0, 1.0) as f64 * p as f64) as u64;
                        if self.len < MAX_PENDING {
                            self.queue[self.len] = due;
                            self.len += 1;
                        }
                    }
                    _ => self.fire(),
                }
            }
            self.trig_high = high;
            if self.len > 0 && self.queue[0] <= self.now {
                self.queue.copy_within(1..self.len, 0);
                self.len -= 1;
                self.fire();
            }
            io.out[0][i] = if self.now < self.out_until && self.gap != Some(self.now) {
                1.0
            } else {
                0.0
            };
            self.now += 1;
        }
    }

    fn reset(&mut self) {
        self.len = 0;
        self.out_until = 0;
        self.last = None;
        self.period = None;
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

    fn run(which: f64) -> Vec<usize> {
        let mut b = Bench::new(48_000.0, 1, &[0.25], &[which], 1);
        b.connected_in = vec![true];
        // triggers every 1000 samples
        let o = b.run(&mut Shift::new(48_000.0), 6000 / BLOCK, |blk, i, inp| {
            inp[0][i] = if (blk * BLOCK + i) % 1000 < 10 {
                1.0
            } else {
                0.0
            }
        });
        rises(&o[0])
    }

    #[test]
    fn all_delays_every_event_by_amt_times_the_period() {
        // the first event passes at once (no period yet); later ones land 250 samples late
        assert_eq!(run(0.0), [0, 1250, 2250, 3250, 4250, 5250]);
    }

    #[test]
    fn even_delays_every_second_event() {
        assert_eq!(run(1.0), [0, 1250, 2000, 3250, 4000, 5250]);
    }

    #[test]
    fn audio_rate_events_keep_the_queue_bounded() {
        let mut b = Bench::new(48_000.0, 1, &[1.0], &[0.0], 1);
        b.connected_in = vec![true];
        let mut s = Shift::new(48_000.0);
        b.run(&mut s, 200, |blk, i, inp| {
            inp[0][i] = if (blk * BLOCK + i) % 24 < 12 {
                1.0
            } else {
                0.0
            }
        });
        assert!(s.pending() <= MAX_PENDING);
    }

    #[test]
    fn blockwise_equals_per_sample() {
        let t: Vec<f32> = (0..20 * BLOCK)
            .map(|i| if i % 333 < 10 { 1.0 } else { 0.0 })
            .collect();
        Bench::blockwise_equals_per_sample(
            || Box::new(Shift::new(48_000.0)),
            &[t],
            &[0.4],
            &[1.0],
            1,
            20,
        );
    }
}
