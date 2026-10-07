//! Trigger inputs: every source edge-detected on its own, merged, divided or multiplied, re-emitted as 1 ms pulses.

/// Fires once when a signal rises above 0.5; re-arms below 0.25.
pub struct EdgeDetector {
    armed: bool,
}

impl Default for EdgeDetector {
    fn default() -> Self {
        EdgeDetector { armed: true }
    }
}

impl EdgeDetector {
    pub fn rise(&mut self, x: f32) -> bool {
        if self.armed && x > 0.5 {
            self.armed = false;
            true
        } else {
            if x < 0.25 {
                self.armed = true;
            }
            false
        }
    }
}

/// At most this many ×N events wait at once.
pub const MAX_PENDING: usize = 8;

pub struct TriggerInput {
    detectors: Vec<EdgeDetector>,
    ratio: i32,
    divided: u32,
    /// the sample count, and when the last incoming event was
    now: u64,
    last_in: Option<u64>,
    /// ×N events still to come, ascending
    pending: [u64; MAX_PENDING],
    pending_len: usize,
    pulse_len: u32,
    pulse_left: u32,
    count: u32,
}

impl TriggerInput {
    pub fn new(sample_rate: f64, max_sources: usize) -> Self {
        TriggerInput {
            detectors: (0..max_sources.max(1))
                .map(|_| EdgeDetector::default())
                .collect(),
            ratio: 1,
            divided: 0,
            now: 0,
            last_in: None,
            pending: [0; MAX_PENDING],
            pending_len: 0,
            pulse_len: ((0.001 * sample_rate).round() as u32).max(1),
            pulse_left: 0,
            count: 0,
        }
    }

    /// −16…−2 = ÷N, 1 = unity, 2…8 = ×N.
    pub fn set_ratio(&mut self, r: i32) {
        self.ratio = r;
    }

    /// One sample: `values` holds each source's current sample. Returns the pulse train (0 or 1).
    pub fn sample(&mut self, values: &[f32]) -> f32 {
        let mut rise = false;
        for (d, &x) in self.detectors.iter_mut().zip(values) {
            rise |= d.rise(x);
        }
        let mut event = false;
        if rise {
            if self.ratio <= -2 {
                event = self.divided.is_multiple_of((-self.ratio) as u32);
                self.divided = self.divided.wrapping_add(1);
            } else {
                event = true;
                if self.ratio >= 2 {
                    // fill the interval that just ended with N−1 more events after this one
                    self.pending_len = 0;
                    if let Some(last) = self.last_in {
                        let interval = self.now - last;
                        let n = self.ratio as u64;
                        for k in 1..n {
                            if self.pending_len < MAX_PENDING {
                                self.pending[self.pending_len] = self.now + interval * k / n;
                                self.pending_len += 1;
                            }
                        }
                    }
                }
                self.last_in = Some(self.now);
            }
        }
        let mut due = 0;
        while due < self.pending_len && self.pending[due] <= self.now {
            due += 1;
        }
        if due > 0 {
            event = true;
            self.pending.copy_within(due..self.pending_len, 0);
            self.pending_len -= due;
        }

        let mut gap = false;
        if event {
            self.count = self.count.wrapping_add(1);
            // a new event during a pulse drops to 0 for one sample so it reads as a new rising edge
            gap = self.pulse_left > 0;
            self.pulse_left = self.pulse_len;
        }
        self.now += 1;
        if gap || self.pulse_left == 0 {
            0.0
        } else {
            self.pulse_left -= 1;
            1.0
        }
    }

    /// Events emitted so far.
    pub fn count(&self) -> u32 {
        self.count
    }

    pub fn pending(&self) -> usize {
        self.pending_len
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const SR: f64 = 48_000.0;

    /// Run a trigger input over per-sample source values; return the sample indices where a pulse starts.
    fn starts(t: &mut TriggerInput, n: usize, src: impl Fn(usize) -> Vec<f32>) -> Vec<usize> {
        let mut prev = 0.0;
        let mut out = Vec::new();
        for i in 0..n {
            let y = t.sample(&src(i));
            if y > 0.5 && prev <= 0.5 {
                out.push(i);
            }
            prev = y;
        }
        out
    }

    /// a 1-sample-wide 1.0 at each of `at`
    fn clicks(at: &'static [usize]) -> impl Fn(usize) -> Vec<f32> {
        move |i| vec![if at.contains(&i) { 1.0 } else { 0.0 }]
    }

    #[test]
    fn an_edge_fires_once_and_rearms_below_a_quarter() {
        let mut e = EdgeDetector::default();
        let fired: Vec<bool> = [0.0, 0.6, 0.4, 0.6, 0.2, 0.6]
            .iter()
            .map(|&x| e.rise(x))
            .collect();
        assert_eq!(fired, [false, true, false, false, false, true]);
    }

    #[test]
    fn two_sources_fire_twice_apart_and_once_together() {
        let mut t = TriggerInput::new(SR, 2);
        let apart = starts(&mut t, 400, |i| {
            vec![
                if i == 10 { 1.0 } else { 0.0 },
                if i == 200 { 1.0 } else { 0.0 },
            ]
        });
        assert_eq!(apart, [10, 200]);
        let mut t = TriggerInput::new(SR, 2);
        let together = starts(&mut t, 400, |i| vec![if i == 10 { 1.0 } else { 0.0 }; 2]);
        assert_eq!(together, [10]);
    }

    #[test]
    fn divide_by_three_passes_the_first_of_every_three() {
        let mut t = TriggerInput::new(SR, 1);
        t.set_ratio(-3);
        let s = starts(&mut t, 2000, clicks(&[100, 200, 300, 400, 500, 600, 700]));
        assert_eq!(s, [100, 400, 700]);
    }

    #[test]
    fn times_four_fills_the_last_interval_after_two_events() {
        let mut t = TriggerInput::new(SR, 1);
        t.set_ratio(4);
        let s = starts(&mut t, 3000, clicks(&[0, 1000]));
        assert_eq!(s, [0, 1000, 1250, 1500, 1750]);
        assert_eq!(t.count(), 5);
    }

    #[test]
    fn pulses_last_one_millisecond() {
        for sr in [48_000.0, 44_100.0] {
            let mut t = TriggerInput::new(sr, 1);
            let high = (0..1000)
                .map(|i| t.sample(&[if i == 0 { 1.0 } else { 0.0 }]))
                .filter(|y| *y > 0.5)
                .count();
            assert_eq!(high, (0.001 * sr).round() as usize, "at {sr}");
        }
    }

    #[test]
    fn an_audio_rate_square_into_times_eight_stays_bounded() {
        let mut t = TriggerInput::new(SR, 1);
        t.set_ratio(8);
        let period = (SR / 2000.0) as usize;
        for i in 0..(2.0 * SR) as usize {
            let y = t.sample(&[if i % period < period / 2 { 1.0 } else { 0.0 }]);
            assert!(y.is_finite());
            assert!(t.pending() <= MAX_PENDING);
        }
        assert!(t.count() > 4000);
    }
}
