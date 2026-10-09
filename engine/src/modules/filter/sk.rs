//! SK: the MS-20's Sallen-Key pair, as a 2-pole state-variable core whose resonance is limited by a tanh on the band
//! state (so it screams and self-oscillates at RES 1 without blowing up); LP and HP 12 dB, BP normalised; run at 2×.

use super::Model;

/// the band state's saturation: tanh(BAND·v) / BAND
const BAND: f64 = 3.0;
/// the input's faint asymmetry
const EVEN: f64 = 0.0016;
/// the input's clip: tanh(CLIP·x) / CLIP, blended in by RES³
const CLIP: f64 = 0.6;

#[derive(Default)]
pub struct Sk {
    ic1: f64,
    ic2: f64,
}

impl Model for Sk {
    fn process(&mut self, x: f64, fc: f64, res: f64, drive: f64, sr: f64) -> [f64; 3] {
        // the forward path is clean (spec revision 28, after Ableton's MS2): DRV blends in an input clip, and a faint
        // asymmetry gives the reference's 2nd harmonic
        let gain = 1.0 + 9.0 * drive;
        let x = (1.0 - drive) * x + drive * (x * gain).tanh() / gain.sqrt();
        let x = x + EVEN * x * x;
        // the MS-20's grit: the signal clips more as RES rises, before the (linear) core, so the grit grows with RES
        // without squashing the resonant peak
        let w = res.clamp(0.0, 1.0).powi(3);
        let x = x + w * ((CLIP * x).tanh() / CLIP - x);
        // k from 2 (no resonance) down to just below 0 (self-oscillation, held by the tanh)
        let k = 2.0 - 2.05 * res.clamp(0.0, 1.0);
        let g = (std::f64::consts::PI * fc.min(0.45 * sr) / sr).tan();
        let a1 = 1.0 / (1.0 + g * (g + k));
        let a2 = g * a1;
        let a3 = g * a2;
        let v3 = x - self.ic2;
        let v1 = a1 * self.ic1 + a2 * v3;
        let v2 = self.ic2 + a2 * self.ic1 + a3 * v3;
        // the nonlinearity: the band state saturates — it grows with RES, so the clipping does too
        // it only holds the self-oscillation near the top of RES; below, the core is linear
        let s = 1e-3 + BAND * ((res - 0.9) / 0.1).clamp(0.0, 1.0);
        self.ic1 = (s * (2.0 * v1 - self.ic1)).tanh() / s + 1e-20;
        self.ic2 = 2.0 * v2 - self.ic2 + 1e-20;
        let bp = v1 * k.max(0.1);
        [v2, bp, x - k * v1 - v2]
    }

    fn reset(&mut self) {
        *self = Sk::default();
    }
}
