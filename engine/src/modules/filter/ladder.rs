//! LADDER (Moog-like, 24 dB) and DIODE (TB-303-like, 18 dB): cascaded one-pole stages with a tanh each and global
//! feedback (Huovilainen's model), run at twice the rate. LP = the last stage; BP and HP are the classic multimode taps
//! of the first two stages (2-pole: BP = 2 · (y1 − y2), HP = u − 2·y1 + y2, u the stage input after feedback). DIODE's
//! three poles sit at CUT / √3 so its resonance (and self-oscillation) lands on CUT.

use super::Model;

pub struct Ladder<const N: usize> {
    y: [f64; N],
    t: [f64; N],
    /// the first stage's input (after the feedback), for the HP tap
    u: f64,
}

impl<const N: usize> Default for Ladder<N> {
    fn default() -> Self {
        Ladder {
            y: [0.0; N],
            t: [0.0; N],
            u: 0.0,
        }
    }
}

impl<const N: usize> Ladder<N> {
    /// the feedback gain at RES 1: just past where N equal poles oscillate (4 for four, 8 for three) once the explicit
    /// integration's loss is made up
    const K_MAX: f64 = if N == 4 { 5.0 } else { 10.0 };

    fn step(&mut self, x: f64, g: f64, k: f64) {
        let u = (x - k * self.y[N - 1]).tanh();
        self.u = u;
        let mut prev = u;
        for n in 0..N {
            self.y[n] += g * (prev - self.t[n]);
            self.t[n] = self.y[n].tanh();
            prev = self.t[n];
        }
    }
}

impl<const N: usize> Model for Ladder<N> {
    fn process(&mut self, x: f64, fc: f64, res: f64, drive: f64, sr: f64) -> [f64; 3] {
        // the poles' frequency: CUT for the ladder, CUT / √3 for the 3-pole diode (its 180° point is then CUT)
        let pole = if N == 4 { fc } else { fc / 3f64.sqrt() };
        // run at 2× (the caller oversamples): the rate here is already doubled
        let g = 1.0 - (-std::f64::consts::TAU * pole / sr).exp();
        let k = Self::K_MAX * res.clamp(0.0, 1.0);
        let gain = 1.0 + 9.0 * drive;
        self.step(x * gain * 0.5, g, k);
        let comp = 2.0 / gain.sqrt();
        let lp = self.y[N - 1] * comp;
        let bp = 2.0 * (self.y[0] - self.y[1]) * comp;
        let hp = (self.u - 2.0 * self.y[0] + self.y[1]) * comp;
        [lp, bp, hp]
    }

    fn reset(&mut self) {
        *self = Self::default();
    }
}
