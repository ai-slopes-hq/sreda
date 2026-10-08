//! MIX: four audio inputs with levels.

use crate::dsp::{Ctx, Dsp, Io};
use crate::spec::{knob, port, ModuleSpec, Role};

pub fn spec() -> ModuleSpec {
    ModuleSpec {
        type_: "mix",
        internal: false,
        label: "MIX",
        desc: "4 audio inputs",
        size: (4, 2),
        inputs: vec![
            port("a", "A", Role::Audio),
            port("b", "B", Role::Audio),
            port("c", "C", Role::Audio),
            port("d", "D", Role::Audio),
        ],
        outputs: vec![port("out", "OUT", Role::Audio)],
        params: vec![
            knob("la", "A", 0.0, 1.0, 1.0).into(),
            knob("lb", "B", 0.0, 1.0, 1.0).into(),
            knob("lc", "C", 0.0, 1.0, 1.0).into(),
            knob("ld", "D", 0.0, 1.0, 1.0).into(),
        ],
        normals: vec![],
        display: None,
    }
}

pub struct Mix;

impl Dsp for Mix {
    fn process(&mut self, io: &mut Io, _ctx: &mut Ctx, from: usize, to: usize) {
        for i in from..to {
            io.out[0][i] = (0..4).map(|k| io.inp[k][i] * io.par[k][i]).sum();
        }
    }
    fn reset(&mut self) {}
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::dsp::bench::Bench;
    use crate::dsp::BLOCK;

    #[test]
    fn it_sums_with_levels() {
        let mut b = Bench::new(48_000.0, 4, &[1.0, 0.5, 0.25, 0.0], &[], 1);
        b.connected_in = vec![true; 4];
        let o = b.run(&mut Mix, 1, |_, i, inp| {
            for (k, x) in inp.iter_mut().enumerate() {
                x[i] = (k + 1) as f32 * 0.1;
            }
        });
        assert!((o[0][5] - (0.1 + 0.5 * 0.2 + 0.25 * 0.3)).abs() < 1e-6);
    }

    #[test]
    fn blockwise_equals_per_sample() {
        let n = 4 * BLOCK;
        let s = |f: f32| (0..n).map(|i| (i as f32 * f).sin()).collect::<Vec<f32>>();
        Bench::blockwise_equals_per_sample(
            || Box::new(Mix),
            &[s(0.1), s(0.2), vec![], s(0.3)],
            &[1.0, 0.3, 0.6, 0.9],
            &[],
            1,
            4,
        );
    }
}
