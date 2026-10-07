//! OSC: SIN / TRI / SAW / SQR with pulse width, linear through-zero FM and hard sync.

use crate::dsp::{Ctx, Dsp, Io};
use crate::spec::{choice, knob, port, ModuleSpec, Role, Unit};

pub fn spec() -> ModuleSpec {
    ModuleSpec {
        type_: "osc",
        label: "OSC",
        desc: "oscillator",
        size: (5, 1),
        inputs: vec![
            port("pitch", "PTCH", Role::Pitch),
            port("fm", "FM", Role::Audio),
            port("sync", "SYNC", Role::Trigger),
        ],
        outputs: vec![port("out", "OUT", Role::Audio)],
        params: vec![
            knob("freq", "FREQ", 0.1, 20_000.0, 110.0)
                .exp()
                .unit(Unit::Hz)
                .random(40.0, 880.0)
                .mod_depth(0.25)
                .into(),
            choice("wave", "WAVE", &["SIN", "TRI", "SAW", "SQR"], 0)
                .glyph("wave")
                .into(),
            knob("pw", "PW", 0.05, 0.95, 0.5).into(),
            knob("fmi", "FM", 0.0, 1.0, 0.0).into(),
        ],
        normals: vec![],
        display: None,
    }
}

// inputs, knobs (par) and options (fixed) by position
const PITCH: usize = 0;
const FM: usize = 1;
const SYNC: usize = 2;
const FREQ: usize = 0;
const PW: usize = 1;
const FMI: usize = 2;
const WAVE: usize = 0;

pub struct Osc {
    sample_rate: f64,
    /// 0…1
    phase: f64,
    sync_high: bool,
}

impl Osc {
    pub fn new(sample_rate: f64) -> Self {
        Osc {
            sample_rate,
            phase: 0.0,
            sync_high: false,
        }
    }
}

/// PolyBLEP residual for a step at phase 0 of a ramp advancing `dt` per sample.
pub(crate) fn blep(t: f64, dt: f64) -> f64 {
    if t < dt {
        let t = t / dt;
        t + t - t * t - 1.0
    } else if t > 1.0 - dt {
        let t = (t - 1.0) / dt;
        t * t + t + t + 1.0
    } else {
        0.0
    }
}

impl Dsp for Osc {
    fn process(&mut self, io: &mut Io, _ctx: &mut Ctx, from: usize, to: usize) {
        let wave = io.fixed[WAVE] as u32;
        let (pitch, fm, sync) = (&io.inp[PITCH], &io.inp[FM], &io.inp[SYNC]);
        let (freq, pw, fmi) = (&io.par[FREQ], &io.par[PW], &io.par[FMI]);
        for i in from..to {
            let s = sync[i] > 0.5;
            if s && !self.sync_high {
                self.phase = 0.0;
            }
            self.sync_high = s;

            let f = freq[i] as f64
                * (pitch[i] as f64).exp2()
                * (1.0 + 4.0 * fmi[i] as f64 * fm[i] as f64);
            let inc = f / self.sample_rate;
            let dt = inc.abs().min(0.5);
            let p = self.phase;
            let y = match wave {
                0 => (std::f64::consts::TAU * p).sin(),
                1 => 1.0 - 4.0 * (p - 0.5).abs(),
                2 => 2.0 * p - 1.0 - blep(p, dt),
                _ => {
                    let w = (pw[i] as f64).clamp(0.05, 0.95);
                    let sq = if p < w { 1.0 } else { -1.0 };
                    sq + blep(p, dt) - blep((p + 1.0 - w).fract(), dt)
                }
            };
            io.out[0][i] = y as f32;
            self.phase = (p + inc).rem_euclid(1.0);
        }
    }

    fn reset(&mut self) {
        self.phase = 0.0;
        self.sync_high = false;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::dsp::bench::{rising, Bench};
    use crate::dsp::BLOCK;

    const SAW: f64 = 2.0;
    const SQR: f64 = 3.0;

    fn bench(sr: f64, freq: f64, wave: f64) -> Bench {
        Bench::new(sr, 3, &[freq, 0.5, 0.0], &[wave], 1)
    }

    fn assert_period(sr: f64) {
        let mut b = bench(sr, 440.0, SAW);
        let s = &b.run(&mut Osc::new(sr), (0.2 * sr) as usize / BLOCK, |_, _, _| {})[0];
        let c = rising(s);
        assert!(c.len() > 40);
        for w in c.windows(2) {
            assert!(
                ((w[1] - w[0]) as f64 - sr / 440.0).abs() <= 1.0,
                "period {} at {}",
                w[1] - w[0],
                sr
            );
        }
    }

    #[test]
    fn saw_440_has_the_right_period_at_48k() {
        assert_period(48_000.0);
    }

    #[test]
    fn saw_440_has_the_right_period_at_44k1() {
        assert_period(44_100.0);
    }

    #[test]
    fn pitch_plus_one_octave_halves_the_period() {
        let mut b = bench(48_000.0, 110.0, SAW);
        b.connected_in[PITCH] = true;
        let s = &b.run(&mut Osc::new(48_000.0), 100, |_, i, inp| {
            inp[PITCH][i] = 1.0
        })[0];
        let c = rising(s);
        assert!(c.len() > 40, "it sounds");
        for w in c.windows(2) {
            assert!(((w[1] - w[0]) as f64 - 48_000.0 / 220.0).abs() <= 1.0);
        }
    }

    #[test]
    fn a_square_at_pw_half_is_positive_half_the_time() {
        let mut b = bench(48_000.0, 100.0, SQR);
        let s = &b.run(&mut Osc::new(48_000.0), 375, |_, _, _| {})[0];
        let pos = s.iter().filter(|x| **x >= 0.0).count() as f64 / s.len() as f64;
        assert!((pos - 0.5).abs() < 0.01, "positive {pos}");
    }

    #[test]
    fn sync_restarts_the_phase() {
        let sr = 48_000.0;
        let mut b = bench(sr, 100.0, SAW);
        b.connected_in[SYNC] = true;
        // a 1 ms pulse at the start of block 3
        let synced = b.run(&mut Osc::new(sr), 6, |blk, i, inp| {
            inp[SYNC][i] = if blk == 3 && i < 48 { 1.0 } else { 0.0 }
        })[0]
            .clone();
        let fresh = bench(sr, 100.0, SAW).run(&mut Osc::new(sr), 3, |_, _, _| {})[0].clone();
        assert!(fresh.iter().any(|x| x.abs() > 0.5), "it sounds");
        for i in 1..(2 * BLOCK) {
            assert!(
                (synced[3 * BLOCK + i] - fresh[i]).abs() < 1e-4,
                "sample {i}"
            );
        }
    }

    #[test]
    fn the_saw_stays_within_one() {
        let s = &bench(48_000.0, 5000.0, SAW).run(&mut Osc::new(48_000.0), 50, |_, _, _| {})[0];
        assert!(s.iter().all(|x| x.abs() <= 1.05));
        assert!(
            s.iter().any(|x| x.abs() > 0.5),
            "it sounds (a band-limited 5 kHz saw peaks below 1)"
        );
    }
}
