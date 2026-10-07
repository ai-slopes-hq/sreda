//! The engine. For now it plays a test tone through the master stage; plans come in Task 5.

use crate::dsp::BLOCK;
use crate::master::Master;

pub struct Engine {
    sample_rate: f64,
    master: Master,
    tone_hz: f64,
    phase: f64,
    out: [[f32; BLOCK]; 2],
}

impl Engine {
    pub fn new(sample_rate: f64, _seed: u32) -> Self {
        Engine {
            sample_rate,
            master: Master::new(sample_rate),
            tone_hz: 0.0,
            phase: 0.0,
            out: [[0.0; BLOCK]; 2],
        }
    }

    /// A sine at 0.2 for checking the audio path; 0 turns it off.
    pub fn set_tone(&mut self, hz: f64) {
        self.tone_hz = hz.max(0.0);
    }

    pub fn process(&mut self) -> (&[f32; BLOCK], &[f32; BLOCK]) {
        let inc = self.tone_hz / self.sample_rate;
        for i in 0..BLOCK {
            let v = if self.tone_hz > 0.0 {
                (std::f64::consts::TAU * self.phase).sin() * 0.2
            } else {
                0.0
            };
            self.phase = (self.phase + inc).fract();
            self.out[0][i] = v as f32;
            self.out[1][i] = v as f32;
        }
        let [l, r] = &mut self.out;
        self.master.process(l, r);
        (&self.out[0], &self.out[1])
    }

    /// L block then R block, contiguous (the WASM export hands out this pointer).
    pub fn out_ptr(&self) -> *const f32 {
        self.out.as_ptr() as *const f32
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rising_crossings(sample_rate: f64, hz: f64, seconds: f64) -> Vec<usize> {
        let mut e = Engine::new(sample_rate, 1);
        e.set_tone(hz);
        let mut samples = Vec::new();
        for _ in 0..(seconds * sample_rate / BLOCK as f64) as usize {
            samples.extend_from_slice(e.process().0);
        }
        // skip the first 0.1 s (the DC blocker settles)
        let start = (0.1 * sample_rate) as usize;
        (start + 1..samples.len())
            .filter(|&i| samples[i - 1] < 0.0 && samples[i] >= 0.0)
            .collect()
    }

    fn assert_period(sample_rate: f64) {
        let c = rising_crossings(sample_rate, 220.0, 0.5);
        assert!(c.len() > 50, "the tone sounds");
        let period = sample_rate / 220.0;
        for w in c.windows(2) {
            assert!(
                ((w[1] - w[0]) as f64 - period).abs() <= 1.0,
                "period {} vs {}",
                w[1] - w[0],
                period
            );
        }
    }

    #[test]
    fn the_tone_is_220_hz_at_48k() {
        assert_period(48_000.0);
    }

    #[test]
    fn the_tone_is_220_hz_at_44k1() {
        assert_period(44_100.0);
    }

    #[test]
    fn tone_zero_is_silence() {
        let mut e = Engine::new(48_000.0, 1);
        e.set_tone(220.0);
        e.process();
        e.set_tone(0.0);
        // the DC blocker's tail of the cut-off sample dies away within half a second
        for _ in 0..(0.5 * 48_000.0 / BLOCK as f64) as usize {
            e.process();
        }
        assert!(e.process().0.iter().all(|x| x.abs() < 1e-4));
    }
}
