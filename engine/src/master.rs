//! The master stage every output passes through: an input clamp (±16), a 5 Hz DC blocker, a soft limiter and a NaN
//! guard.

use crate::dsp::BLOCK;

const DC_HZ: f64 = 5.0;
/// The input is clamped here before the DC blocker.
const INPUT_LIMIT: f64 = 16.0;

pub struct Master {
    /// DC blocker pole: y = x − x₁ + pole·y₁
    pole: f64,
    x1: [f64; 2],
    y1: [f64; 2],
    gain: f64,
    gain_step: f64,
    /// the fader (0…1), gliding 10 ms toward `level`
    level: f64,
    level_target: f64,
    sample_rate: f64,
}

impl Master {
    pub fn new(sample_rate: f64) -> Self {
        Master {
            pole: (-2.0 * std::f64::consts::PI * DC_HZ / sample_rate).exp(),
            x1: [0.0; 2],
            y1: [0.0; 2],
            gain: 1.0,
            gain_step: 0.0,
            level: 1.0,
            level_target: 1.0,
            sample_rate,
        }
    }

    /// Ramp the output from silence to full over `ms`.
    pub fn fade_in(&mut self, ms: f64) {
        self.gain = 0.0;
        self.gain_step = 1.0 / (ms * 0.001 * self.sample_rate).max(1.0);
    }

    /// The master fader, 0…1; the output glides there over 10 ms.
    pub fn set_level(&mut self, v: f64) {
        self.level_target = if v.is_finite() {
            v.clamp(0.0, 1.0)
        } else {
            1.0
        };
    }

    pub fn process(&mut self, l: &mut [f32; BLOCK], r: &mut [f32; BLOCK]) {
        let (pole, gain0, step) = (self.pole, self.gain, self.gain_step);
        let (level0, target) = (self.level, self.level_target);
        let level_step = 1.0 / (0.010 * self.sample_rate).max(1.0);
        for (ch, buf) in [l, r].into_iter().enumerate() {
            let (mut x1, mut y1, mut gain) = (self.x1[ch], self.y1[ch], gain0);
            let mut level = level0;
            for s in buf.iter_mut() {
                if level < target {
                    level = (level + level_step).min(target);
                } else if level > target {
                    level = (level - level_step).max(target);
                }
                let x = *s as f64 * level;
                if !x.is_finite() {
                    // a non-finite sample is dropped and the filter restarts
                    x1 = 0.0;
                    y1 = 0.0;
                    *s = 0.0;
                    continue;
                }
                // a runaway upstream must not charge the DC blocker for seconds
                let x = x.clamp(-INPUT_LIMIT, INPUT_LIMIT);
                let y = x - x1 + pole * y1;
                x1 = x;
                y1 = y;
                gain = (gain + step).min(1.0);
                *s = limit(y * gain) as f32;
            }
            self.x1[ch] = x1;
            self.y1[ch] = y1;
            if ch == 1 {
                self.gain = gain;
                self.level = level;
            }
        }
        if self.gain >= 1.0 {
            self.gain_step = 0.0;
        }
    }
}

/// Identity up to |x| 0.9, then a tanh knee that never exceeds 1.
fn limit(x: f64) -> f64 {
    let a = x.abs();
    if a <= 0.9 {
        x
    } else {
        x.signum() * (0.9 + 0.1 * ((a - 0.9) / 0.1).tanh())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const SR: f64 = 48_000.0;

    fn run(m: &mut Master, seconds: f64, input: impl Fn(usize) -> f32) -> Vec<f32> {
        let blocks = (seconds * SR / BLOCK as f64).ceil() as usize;
        let mut out = Vec::with_capacity(blocks * BLOCK);
        for b in 0..blocks {
            let mut l = [0.0f32; BLOCK];
            let mut r = [0.0f32; BLOCK];
            for i in 0..BLOCK {
                l[i] = input(b * BLOCK + i);
                r[i] = l[i];
            }
            m.process(&mut l, &mut r);
            out.extend_from_slice(&l);
        }
        out
    }

    #[test]
    fn dc_decays_below_one_percent_within_half_a_second() {
        let mut m = Master::new(SR);
        let out = run(&mut m, 0.6, |_| 0.5);
        let at = (0.5 * SR) as usize;
        assert!(out[0] > 0.4, "the step passes at first: {}", out[0]);
        assert!(out[at].abs() < 0.01, "after 0.5 s: {}", out[at]);
    }

    #[test]
    fn a_loud_input_stays_within_one() {
        let mut m = Master::new(SR);
        let out = run(&mut m, 0.1, |i| if i % 100 < 50 { 10.0 } else { -10.0 });
        assert!(
            out.iter().all(|x| x.abs() <= 1.0),
            "peak {}",
            out.iter().fold(0.0f32, |a, x| a.max(x.abs()))
        );
    }

    #[test]
    fn non_finite_input_gives_finite_output() {
        let mut m = Master::new(SR);
        let out = run(&mut m, 0.05, |i| match i % 3 {
            0 => f32::NAN,
            1 => f32::INFINITY,
            _ => 0.3,
        });
        assert!(out.iter().all(|x| x.is_finite()));
        let after = run(&mut m, 0.05, |i| (i as f32 * 0.05).sin() * 0.3);
        assert!(after.iter().all(|x| x.is_finite()));
        assert!(after.iter().any(|x| x.abs() > 0.1), "recovers after NaN");
    }

    #[test]
    fn it_recovers_quickly_after_a_runaway() {
        let mut m = Master::new(SR);
        run(&mut m, 1.0, |_| 1e30);
        let after = run(&mut m, 0.6, |_| 0.0);
        let at = (0.5 * SR) as usize;
        assert!(
            after[at..].iter().all(|x| x.abs() < 0.01),
            "still {} after 0.5 s",
            after[at]
        );
    }

    #[test]
    fn fade_in_ramps_over_its_time() {
        let mut m = Master::new(SR);
        m.fade_in(200.0);
        let sine =
            |i: usize| (2.0 * std::f64::consts::PI * 1000.0 * i as f64 / SR).sin() as f32 * 0.5;
        let out = run(&mut m, 0.4, sine);
        let peak = |from: f64, to: f64| {
            out[(from * SR) as usize..(to * SR) as usize]
                .iter()
                .fold(0.0f32, |a, x| a.max(x.abs()))
        };
        assert!(
            peak(0.0, 0.003) < 0.02,
            "starts silent: {}",
            peak(0.0, 0.003)
        );
        assert!(
            (peak(0.09, 0.11) - 0.25).abs() < 0.03,
            "half way at 100 ms: {}",
            peak(0.09, 0.11)
        );
        let full_at = 0.2 + BLOCK as f64 / SR;
        assert!(
            (peak(full_at, full_at + 0.01) - 0.5).abs() < 0.01,
            "full after 200 ms + 1 block"
        );
    }
}
