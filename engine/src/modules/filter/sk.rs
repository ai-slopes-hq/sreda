//! SK: the MS-20's Sallen-Key pair, as a 2-pole state-variable core whose resonance is limited by a tanh on the band
//! state (so it screams and self-oscillates at RES 1 without blowing up); LP and HP 12 dB, BP normalised; run at 2×.

use super::Model;

#[derive(Default)]
pub struct Sk {
    ic1: f64,
    ic2: f64,
}

impl Model for Sk {
    fn process(&mut self, x: f64, fc: f64, res: f64, drive: f64, sr: f64) -> [f64; 3] {
        let gain = 1.0 + 9.0 * drive;
        let x = (x * gain).tanh() / gain.sqrt();
        // k from 2 (no resonance) down to just below 0 (self-oscillation, held by the tanh)
        let k = 2.0 - 2.05 * res.clamp(0.0, 1.0);
        let g = (std::f64::consts::PI * fc.min(0.45 * sr) / sr).tan();
        let a1 = 1.0 / (1.0 + g * (g + k));
        let a2 = g * a1;
        let a3 = g * a2;
        let v3 = x - self.ic2;
        let v1 = a1 * self.ic1 + a2 * v3;
        let v2 = self.ic2 + a2 * self.ic1 + a3 * v3;
        // the nonlinearity: the band state saturates
        self.ic1 = (2.0 * v1 - self.ic1).tanh() * 1.0 + 1e-20;
        self.ic2 = 2.0 * v2 - self.ic2 + 1e-20;
        let bp = v1 * k.max(0.1);
        [v2, bp, x - k * v1 - v2]
    }

    fn reset(&mut self) {
        *self = Sk::default();
    }
}
