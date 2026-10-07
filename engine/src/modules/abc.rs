//! A×B+C (Befaco style): two channels of multiply and add; B unpatched is 1; c2 takes out1 while out1 is unpatched.

use crate::dsp::{Ctx, Dsp, Io};
use crate::spec::{knob, port, ModuleSpec, Normal, Role};

pub fn spec() -> ModuleSpec {
    ModuleSpec {
        type_: "abc",
        label: "A×B+C",
        desc: "multiply and add, 2 channels",
        size: (5, 2),
        inputs: vec![
            port("a1", "A1", Role::Audio),
            port("b1", "B1", Role::Audio),
            port("c1", "C1", Role::Audio),
            port("a2", "A2", Role::Audio),
            port("b2", "B2", Role::Audio),
            port("c2", "C2", Role::Audio),
        ],
        outputs: vec![
            port("out1", "OUT1", Role::Audio),
            port("out2", "OUT2", Role::Audio),
        ],
        params: vec![
            knob("ga1", "A1", -1.0, 1.0, 1.0).into(),
            knob("gb1", "B1", -1.0, 1.0, 1.0).into(),
            knob("c1", "C1", -1.0, 1.0, 0.0).into(),
            knob("ga2", "A2", -1.0, 1.0, 1.0).into(),
            knob("gb2", "B2", -1.0, 1.0, 1.0).into(),
            knob("c2", "C2", -1.0, 1.0, 0.0).into(),
        ],
        normals: vec![
            Normal::Value {
                input: "b1",
                value: 1.0,
            },
            Normal::Value {
                input: "b2",
                value: 1.0,
            },
            Normal::Internal {
                input: "c2",
                internal: "out1 while out1 is unpatched",
            },
        ],
        display: None,
    }
}

#[derive(Default)]
pub struct Abc;

impl Dsp for Abc {
    fn process(&mut self, io: &mut Io, _ctx: &mut Ctx, from: usize, to: usize) {
        // c2 takes out1 while c2 is unpatched and out1 is unpatched
        let cascade = !io.connected_in[5] && !io.connected_out[0];
        for i in from..to {
            let (inp, par) = (&io.inp, &io.par);
            let out1 = inp[0][i] * par[0][i] * (inp[1][i] * par[1][i]) + inp[2][i] + par[2][i];
            let c2 = if cascade { out1 } else { inp[5][i] };
            io.out[0][i] = out1;
            io.out[1][i] = inp[3][i] * par[3][i] * (inp[4][i] * par[4][i]) + c2 + par[5][i];
        }
    }
    fn reset(&mut self) {}
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::dsp::bench::Bench;
    use crate::dsp::BLOCK;

    const PAR: [f64; 6] = [1.0, 1.0, 0.0, 1.0, 1.0, 0.0];

    #[test]
    fn a_times_b_ring_modulates() {
        let mut b = Bench::new(48_000.0, 6, &PAR, &[], 2);
        b.connected_in = vec![true, true, false, false, false, false];
        let o = b.run(&mut Abc, 2, |_, i, inp| {
            inp[0][i] = (i as f32 * 0.1).sin();
            inp[1][i] = (i as f32 * 0.03).sin();
        });
        for (i, y) in o[0].iter().take(BLOCK).enumerate() {
            assert!((y - (i as f32 * 0.1).sin() * (i as f32 * 0.03).sin()).abs() < 1e-6);
        }
    }

    #[test]
    fn b_at_its_normal_passes_a_times_gain_plus_c() {
        let mut b = Bench::new(48_000.0, 6, &[0.5, 1.0, 0.25, 1.0, 1.0, 0.0], &[], 2);
        b.connected_in = vec![true, false, false, false, false, false];
        let o = b.run(&mut Abc, 1, |_, i, inp| {
            inp[0][i] = 0.8;
            inp[1][i] = 1.0; // the engine's normal for an unpatched B
        });
        assert!((o[0][7] - (0.8 * 0.5 + 0.25)).abs() < 1e-6);
    }

    #[test]
    fn out1_cascades_into_c2_only_while_out1_is_unpatched() {
        let run = |out1_patched: bool| {
            let mut b = Bench::new(48_000.0, 6, &[1.0, 1.0, 0.3, 1.0, 1.0, 0.0], &[], 2);
            b.connected_in = vec![false; 6];
            b.connected_out = vec![out1_patched, true];
            b.run(&mut Abc, 1, |_, i, inp| {
                inp[1][i] = 1.0;
                inp[4][i] = 1.0;
            })[1][5]
        };
        assert!((run(false) - 0.3).abs() < 1e-6, "out2 = 0 + out1 (0.3)");
        assert!(run(true).abs() < 1e-6, "out1 patched: no cascade");
    }

    #[test]
    fn blockwise_equals_per_sample() {
        let s = |f: f32| {
            (0..4 * BLOCK)
                .map(|i| (i as f32 * f).sin())
                .collect::<Vec<f32>>()
        };
        Bench::blockwise_equals_per_sample(
            || Box::new(Abc),
            &[s(0.1), s(0.2), vec![], s(0.3), vec![], vec![]],
            &[0.5, -0.5, 0.2, 0.7, 1.0, -0.1],
            &[],
            2,
            4,
        );
    }
}
