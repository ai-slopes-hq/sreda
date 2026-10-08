//! SVF: Cytomic's trapezoidal (TPT) state-variable filter, 12 dB; f64 state with a tiny offset against denormals.

use super::Model;

#[derive(Default)]
pub struct Svf {
    ic1: f64,
    ic2: f64,
}

impl Model for Svf {
    fn process(&mut self, x: f64, fc: f64, res: f64, _drive: f64, sr: f64) -> [f64; 3] {
        let k = 2.0 - 1.96 * res.clamp(0.0, 1.0);
        let g = (std::f64::consts::PI * fc / sr).tan();
        let a1 = 1.0 / (1.0 + g * (g + k));
        let a2 = g * a1;
        let a3 = g * a2;
        let v3 = x - self.ic2;
        let v1 = a1 * self.ic1 + a2 * v3;
        let v2 = self.ic2 + a2 * self.ic1 + a3 * v3;
        self.ic1 = 2.0 * v1 - self.ic1 + 1e-20;
        self.ic2 = 2.0 * v2 - self.ic2 + 1e-20;
        [v2, v1, x - k * v1 - v2]
    }

    fn reset(&mut self) {
        *self = Svf::default();
    }
}
