//! OUT: to the speakers. R unpatched follows L.

use crate::dsp::{Ctx, Dsp, Io};
use crate::spec::{knob, port, ModuleSpec, Normal, Role};

pub fn spec() -> ModuleSpec {
    ModuleSpec {
        type_: "out",
        internal: false,
        label: "OUT",
        desc: "to speakers",
        size: (3, 1),
        inputs: vec![port("l", "L", Role::Audio), port("r", "R", Role::Audio)],
        outputs: vec![],
        params: vec![knob("level", "LVL", 0.0, 1.0, 0.7).into()],
        normals: vec![Normal::Internal {
            input: "r",
            internal: "L",
        }],
        display: None,
    }
}

pub struct Out;

impl Dsp for Out {
    fn process(&mut self, io: &mut Io, ctx: &mut Ctx, from: usize, to: usize) {
        let (l, level) = (&io.inp[0], &io.par[0]);
        let r = if io.connected_in[1] { &io.inp[1] } else { l };
        for i in from..to {
            ctx.master[0][i] += l[i] * level[i];
            ctx.master[1][i] += r[i] * level[i];
        }
    }

    fn reset(&mut self) {}
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::dsp::bench::Bench;

    #[test]
    fn only_l_patched_writes_both_channels_at_level() {
        let mut b = Bench::new(48_000.0, 2, &[0.5], &[], 0);
        b.connected_in[0] = true;
        b.run(&mut Out, 1, |_, i, inp| {
            inp[0][i] = 0.8 * (i as f32 / 128.0)
        });
        for i in 0..128 {
            let want = 0.4 * (i as f32 / 128.0);
            assert!((b.ctx.master[0][i] - want).abs() < 1e-6);
            assert!((b.ctx.master[1][i] - want).abs() < 1e-6);
        }
    }

    #[test]
    fn both_patched_keep_their_channels() {
        let mut b = Bench::new(48_000.0, 2, &[1.0], &[], 0);
        b.connected_in = vec![true, true];
        b.run(&mut Out, 1, |_, i, inp| {
            inp[0][i] = 0.3;
            inp[1][i] = -0.2;
        });
        assert!((b.ctx.master[0][5] - 0.3).abs() < 1e-6 && (b.ctx.master[1][5] + 0.2).abs() < 1e-6);
    }
}
