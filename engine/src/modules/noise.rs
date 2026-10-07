//! NOISE: white and pink.

use crate::dsp::{Ctx, Dsp, Io};
use crate::spec::{knob, port, ModuleSpec, Role};

pub fn spec() -> ModuleSpec {
    ModuleSpec {
        type_: "noise",
        label: "NOISE",
        desc: "white and pink",
        size: (3, 1),
        inputs: vec![],
        outputs: vec![
            port("white", "WHT", Role::Audio),
            port("pink", "PNK", Role::Audio),
        ],
        params: vec![knob("level", "LVL", 0.0, 1.0, 1.0).into()],
        normals: vec![],
        display: None,
    }
}

/// White from the engine's seeded RNG; pink through Paul Kellet's filter of the same white.
#[derive(Default)]
pub struct Noise {
    b: [f64; 7],
}

impl Noise {
    pub fn new() -> Self {
        Noise::default()
    }
}

impl Dsp for Noise {
    fn process(&mut self, io: &mut Io, ctx: &mut Ctx, from: usize, to: usize) {
        for i in from..to {
            let level = io.par[0][i];
            let w = ctx.rng.next_f64() * 2.0 - 1.0;
            let b = &mut self.b;
            b[0] = 0.99886 * b[0] + w * 0.0555179;
            b[1] = 0.99332 * b[1] + w * 0.0750759;
            b[2] = 0.96900 * b[2] + w * 0.1538520;
            b[3] = 0.86650 * b[3] + w * 0.3104856;
            b[4] = 0.55000 * b[4] + w * 0.5329522;
            b[5] = -0.7616 * b[5] - w * 0.0168980;
            let pink = (b[0] + b[1] + b[2] + b[3] + b[4] + b[5] + b[6] + w * 0.5362) * 0.11;
            b[6] = w * 0.115926;
            io.out[0][i] = w as f32 * level;
            io.out[1][i] = pink as f32 * level;
        }
    }

    fn reset(&mut self) {
        self.b = [0.0; 7];
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::dsp::bench::Bench;
    use crate::dsp::BLOCK;

    fn render(seed: u32, blocks: usize) -> Vec<Vec<f32>> {
        let mut b = Bench::new(48_000.0, 0, &[1.0], &[], 2);
        b.ctx.rng = crate::dsp::Rng::new(seed);
        b.run(&mut Noise::new(), blocks, |_, _, _| {})
    }

    /// energy above ~5 kHz: the mean square of a first difference (a crude high-pass)
    fn hf(s: &[f32]) -> f32 {
        s.windows(2).map(|w| (w[1] - w[0]).powi(2)).sum::<f32>() / s.len() as f32
    }

    #[test]
    fn noise_repeats_with_the_seed_and_white_is_centred() {
        let a = render(7, 375);
        assert_eq!(a, render(7, 375));
        assert_ne!(a, render(8, 375));
        let mean = a[0].iter().sum::<f32>() / a[0].len() as f32;
        assert!(mean.abs() < 0.02, "mean {mean}");
        assert!(a[0].iter().all(|x| x.abs() <= 1.0) && a[0].iter().any(|x| x.abs() > 0.9));
    }

    #[test]
    fn pink_has_less_high_frequency_energy_than_white() {
        let a = render(3, 375);
        let (w, p) = (a[0].clone(), a[1].clone());
        let scale = |s: &[f32]| s.iter().map(|x| x * x).sum::<f32>() / s.len() as f32;
        assert!(scale(&p) > 0.0);
        assert!(hf(&p) / scale(&p) < 0.5 * hf(&w) / scale(&w));
    }

    #[test]
    fn blockwise_equals_per_sample() {
        Bench::blockwise_equals_per_sample(|| Box::new(Noise::new()), &[], &[0.8], &[], 2, 10);
        let _ = BLOCK;
    }
}
