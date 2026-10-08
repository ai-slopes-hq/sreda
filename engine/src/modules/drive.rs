//! DRIVE: a saturator — SAT (tape-like tanh), OD (asymmetric, tube-like), FUZZ (a biased hard clip); first-order ADAA
//! at 2× oversampling; a tilt TONE after the curve; the level compensated so GAIN changes character more than
//! loudness; a dry / wet MIX.

use crate::dsp::{Ctx, Dsp, Io};
use crate::shaping::{Adaa1, Asym, Clip, Os2x, Tanh};
use crate::spec::{choice, knob, port, ModuleSpec, Role, Unit};

pub fn spec() -> ModuleSpec {
    ModuleSpec {
        type_: "drive",
        internal: false,
        label: "DRIVE",
        desc: "saturation, overdrive, fuzz",
        size: (5, 1),
        inputs: vec![port("in", "IN", Role::Audio)],
        outputs: vec![port("out", "OUT", Role::Audio)],
        params: vec![
            knob("gain", "GAIN", 0.0, 24.0, 6.0).unit(Unit::Db).into(),
            knob("tone", "TONE", 0.0, 1.0, 0.5).into(),
            knob("mix", "MIX", 0.0, 1.0, 1.0).into(),
            choice("mode", "MODE", &["SAT", "OD", "FUZZ"], 1).into(),
        ],
        normals: vec![],
        display: None,
    }
}

pub struct Drive {
    sample_rate: f64,
    os: Os2x,
    sat: Adaa1<Tanh>,
    od: Adaa1<Asym>,
    fuzz: Adaa1<Clip>,
    /// the dry signal, delayed by the oversampler's latency so MIX does not comb
    dry: [f32; Os2x::LATENCY],
    dry_pos: usize,
    /// DC blocker after the (biased) curve
    dc_x: f64,
    dc_y: f64,
    /// the tilt's low band
    lp: f64,
}

impl Drive {
    pub fn new(sample_rate: f64) -> Self {
        Drive {
            sample_rate,
            os: Os2x::new(),
            sat: Adaa1::new(),
            od: Adaa1::new(),
            fuzz: Adaa1::new(),
            dry: [0.0; Os2x::LATENCY],
            dry_pos: 0,
            dc_x: 0.0,
            dc_y: 0.0,
            lp: 0.0,
        }
    }

    fn curve(&mut self, mode: usize, x: f64) -> f64 {
        match mode {
            0 => self.sat.process(x),
            1 => self.od.process(x + 0.1),
            _ => self.fuzz.process(x + 0.3),
        }
    }
}

impl Dsp for Drive {
    fn process(&mut self, io: &mut Io, _ctx: &mut Ctx, from: usize, to: usize) {
        let mode = io.fixed[0].round().clamp(0.0, 2.0) as usize;
        let dc_r = 1.0 - std::f64::consts::TAU * 5.0 / self.sample_rate;
        let lp_a = 1.0 - (-std::f64::consts::TAU * 800.0 / self.sample_rate).exp();
        for i in from..to {
            let x = io.inp[0][i];
            let g = 10f64.powf(io.par[0][i] as f64 / 20.0);
            let u = self.os.up((x as f64 * g) as f32);
            let a = self.curve(mode, u[0] as f64);
            let b = self.curve(mode, u[1] as f64);
            let y = self.os.down([a as f32, b as f32]) as f64;
            // remove the bias's DC
            let hp = y - self.dc_x + dc_r * self.dc_y;
            self.dc_x = y;
            self.dc_y = hp;
            // tilt around 800 Hz: TONE 0 = lows +6 dB / highs −6 dB, 1 the reverse
            self.lp += lp_a * (hp - self.lp);
            let t = (io.par[1][i] as f64 - 0.5) * 2.0;
            let tilted =
                self.lp * 10f64.powf(-6.0 * t / 20.0) + (hp - self.lp) * 10f64.powf(6.0 * t / 20.0);
            let wet = tilted / (1.0 + 0.6 * (g - 1.0)).sqrt();
            let dry = self.dry[self.dry_pos];
            self.dry[self.dry_pos] = x;
            self.dry_pos = (self.dry_pos + 1) % self.dry.len();
            let mix = io.par[2][i] as f64;
            io.out[0][i] = (mix * wet + (1.0 - mix) * dry as f64) as f32;
        }
    }

    fn reset(&mut self) {
        *self = Drive::new(self.sample_rate);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::dsp::bench::Bench;
    use crate::dsp::BLOCK;

    const SR: f64 = 48_000.0;

    fn run(
        gain_db: f64,
        tone: f64,
        mix: f64,
        mode: f64,
        amp: f64,
        hz: f64,
        blocks: usize,
    ) -> Vec<f32> {
        let mut b = Bench::new(SR, 1, &[gain_db, tone, mix], &[mode], 1);
        b.connected_in = vec![true];
        let o = b.run(&mut Drive::new(SR), blocks, |blk, i, inp| {
            let n = (blk * BLOCK + i) as f64;
            inp[0][i] = (amp * (std::f64::consts::TAU * hz * n / SR).sin()) as f32;
        });
        o[0][BLOCK * 20..].to_vec()
    }
    fn rms(s: &[f32]) -> f64 {
        (s.iter().map(|x| (*x as f64).powi(2)).sum::<f64>() / s.len() as f64).sqrt()
    }
    fn db(x: f64) -> f64 {
        20.0 * x.log10()
    }
    /// the amplitude of `hz` in `s` (one DFT bin, Hann window)
    fn level(s: &[f32], hz: f64) -> f64 {
        let n = s.len();
        let (mut re, mut im, mut wsum) = (0.0, 0.0, 0.0);
        for (i, x) in s.iter().enumerate() {
            let w = 0.5 - 0.5 * (std::f64::consts::TAU * i as f64 / n as f64).cos();
            let a = std::f64::consts::TAU * hz * i as f64 / SR;
            re += *x as f64 * w * a.cos();
            im -= *x as f64 * w * a.sin();
            wsum += w;
        }
        2.0 * (re * re + im * im).sqrt() / wsum
    }

    #[test]
    fn sat_at_0_db_on_a_quiet_signal_is_nearly_transparent() {
        let y = run(0.0, 0.5, 1.0, 0.0, 0.1, 500.0, 120);
        let r = db(rms(&y) / (0.1 / 2f64.sqrt()));
        assert!(r.abs() < 0.5, "{r} dB");
    }

    #[test]
    fn gain_changes_character_more_than_loudness() {
        for mode in [0.0, 1.0, 2.0] {
            let lo = rms(&run(0.0, 0.5, 1.0, mode, 0.5, 200.0, 120));
            let hi = rms(&run(24.0, 0.5, 1.0, mode, 0.5, 200.0, 120));
            let d = db(hi / lo);
            assert!(d.abs() < 6.0, "mode {mode}: {d} dB");
        }
    }

    #[test]
    fn fuzz_brings_out_the_third_harmonic() {
        let y = run(12.0, 0.5, 1.0, 2.0, 0.5, 375.0, 160);
        let (f1, f3) = (level(&y, 375.0), level(&y, 1125.0));
        assert!(db(f3 / f1) > -20.0, "3rd at {} dB", db(f3 / f1));
    }

    #[test]
    fn a_huge_input_stays_finite() {
        let y = run(24.0, 0.0, 1.0, 1.0, 1e6, 100.0, 60);
        assert!(y.iter().all(|x| x.is_finite() && x.abs() <= 4.0));
    }

    #[test]
    fn blockwise_equals_per_sample() {
        let x: Vec<f32> = (0..10 * BLOCK)
            .map(|i| (i as f32 * 0.05).sin() * 0.7)
            .collect();
        for mode in [0.0, 1.0, 2.0] {
            Bench::blockwise_equals_per_sample(
                || Box::new(Drive::new(SR)),
                std::slice::from_ref(&x),
                &[18.0, 0.3, 0.8],
                &[mode],
                1,
                10,
            );
        }
    }
}
