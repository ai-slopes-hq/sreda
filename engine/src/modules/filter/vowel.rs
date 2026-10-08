//! VOWEL: three band-passes on the formants of a vowel, morphing A → E → I → O → U across CUT's knob range; RES sets
//! their Q (2…20). LP = all three, BP = the first, HP = the upper two.

use super::Model;

/// F1, F2, F3 for A, E, I, O, U (Hz)
const FORMANTS: [[f64; 3]; 5] = [
    [800.0, 1150.0, 2900.0],
    [400.0, 1600.0, 2700.0],
    [350.0, 1700.0, 2700.0],
    [450.0, 800.0, 2830.0],
    [325.0, 700.0, 2530.0],
];

#[derive(Default)]
pub struct Vowel {
    ic1: [f64; 3],
    ic2: [f64; 3],
}

impl Model for Vowel {
    fn process(&mut self, x: f64, fc: f64, res: f64, _drive: f64, sr: f64) -> [f64; 3] {
        // CUT's knob position (20 Hz … 20 kHz, exponential) picks the vowel
        let pos = ((fc / 20.0).ln() / 1000f64.ln()).clamp(0.0, 1.0) * 4.0;
        let (i, t) = ((pos.floor() as usize).min(3), pos - pos.floor().min(3.0));
        let k = 1.0 / (2.0 + 18.0 * res.clamp(0.0, 1.0));
        let mut band = [0.0; 3];
        for (f, b) in band.iter_mut().enumerate() {
            let hz = (FORMANTS[i][f] * (1.0 - t) + FORMANTS[i + 1][f] * t).min(0.45 * sr);
            let g = (std::f64::consts::PI * hz / sr).tan();
            let a1 = 1.0 / (1.0 + g * (g + k));
            let a2 = g * a1;
            let a3 = g * a2;
            let v3 = x - self.ic2[f];
            let v1 = a1 * self.ic1[f] + a2 * v3;
            let v2 = self.ic2[f] + a2 * self.ic1[f] + a3 * v3;
            self.ic1[f] = 2.0 * v1 - self.ic1[f] + 1e-20;
            self.ic2[f] = 2.0 * v2 - self.ic2[f] + 1e-20;
            // a unity-peak band-pass
            *b = k * v1;
        }
        [
            band[0] + 0.7 * band[1] + 0.5 * band[2],
            band[0],
            0.7 * band[1] + 0.5 * band[2],
        ]
    }

    fn reset(&mut self) {
        *self = Vowel::default();
    }
}
