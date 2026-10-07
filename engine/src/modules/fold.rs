//! FOLD: a sine wavefolder (ADAA, 2× oversampled).

use crate::dsp::{Ctx, Dsp, Io};
use crate::shaping::Folder;
use crate::spec::{knob, port, ModuleSpec, Role};

pub fn spec() -> ModuleSpec {
    ModuleSpec {
        type_: "fold",
        label: "FOLD",
        desc: "wavefolder",
        size: (4, 1),
        inputs: vec![port("in", "IN", Role::Audio)],
        outputs: vec![port("out", "OUT", Role::Audio)],
        params: vec![
            knob("fold", "FOLD", 0.0, 1.0, 0.3).into(),
            knob("sym", "SYM", -1.0, 1.0, 0.0).into(),
        ],
        normals: vec![],
        display: None,
    }
}

#[derive(Default)]
pub struct Fold {
    folder: Folder,
}

impl Dsp for Fold {
    fn process(&mut self, io: &mut Io, _ctx: &mut Ctx, from: usize, to: usize) {
        for i in from..to {
            io.out[0][i] = self
                .folder
                .process(io.inp[0][i], io.par[0][i], io.par[1][i]);
        }
    }
    fn reset(&mut self) {
        self.folder.reset();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::dsp::bench::Bench;
    use crate::dsp::BLOCK;

    #[test]
    fn more_fold_more_harmonics() {
        let crossings = |fold: f64| {
            let mut b = Bench::new(48_000.0, 1, &[fold, 0.0], &[], 1);
            b.connected_in = vec![true];
            let o = b.run(&mut Fold::default(), 40, |blk, i, inp| {
                inp[0][i] = (std::f64::consts::TAU * 100.0 * (blk * BLOCK + i) as f64 / 48_000.0)
                    .sin() as f32;
            });
            o[0].windows(2)
                .filter(|w| (w[0] < 0.0) != (w[1] < 0.0))
                .count()
        };
        assert!(
            crossings(1.0) > 3 * crossings(0.0),
            "{} vs {}",
            crossings(1.0),
            crossings(0.0)
        );
    }

    #[test]
    fn blockwise_equals_per_sample() {
        let x: Vec<f32> = (0..10 * BLOCK).map(|i| (i as f32 * 0.03).sin()).collect();
        Bench::blockwise_equals_per_sample(
            || Box::new(Fold::default()),
            &[x],
            &[0.6, 0.1],
            &[],
            1,
            10,
        );
    }
}
