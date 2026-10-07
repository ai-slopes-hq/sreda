//! ATT (Quadratt style): four attenuverters with offsets; an unpatched output adds into the next one.

use crate::dsp::{Ctx, Dsp, Io};
use crate::spec::{knob, port, ModuleSpec, Normal, Param, Role};

pub fn spec() -> ModuleSpec {
    let ids = ["1", "2", "3", "4"];
    let ins = ["in1", "in2", "in3", "in4"];
    let in_labels = ["IN1", "IN2", "IN3", "IN4"];
    let outs = ["out1", "out2", "out3", "out4"];
    let out_labels = ["OUT1", "OUT2", "OUT3", "OUT4"];
    let a_ids = ["a1", "a2", "a3", "a4"];
    let a_labels = ["ATT1", "ATT2", "ATT3", "ATT4"];
    let o_ids = ["o1", "o2", "o3", "o4"];
    let o_labels = ["OFS1", "OFS2", "OFS3", "OFS4"];
    let _ = ids;
    let mut params: Vec<Param> = (0..4)
        .map(|k| knob(a_ids[k], a_labels[k], -1.0, 1.0, 1.0).into())
        .collect();
    params.extend((0..4).map(|k| knob(o_ids[k], o_labels[k], -1.0, 1.0, 0.0).into()));
    ModuleSpec {
        type_: "att",
        label: "ATT",
        desc: "4× attenuverter + offset",
        size: (6, 2),
        inputs: (0..4)
            .map(|k| port(ins[k], in_labels[k], Role::Audio))
            .collect(),
        outputs: (0..4)
            .map(|k| port(outs[k], out_labels[k], Role::Mod))
            .collect(),
        params,
        normals: (0..4)
            .map(|k| Normal::Value {
                input: ins[k],
                value: 1.0,
            })
            .collect(),
        display: None,
    }
}

#[derive(Default)]
pub struct Att;

impl Dsp for Att {
    fn process(&mut self, io: &mut Io, _ctx: &mut Ctx, from: usize, to: usize) {
        for i in from..to {
            // an unpatched output carries its value into the next one
            let mut carry = 0.0;
            for n in 0..4 {
                let v = io.inp[n][i] * io.par[n][i] + io.par[4 + n][i] + carry;
                io.out[n][i] = v;
                carry = if io.connected_out[n] { 0.0 } else { v };
            }
        }
    }
    fn reset(&mut self) {}
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::dsp::bench::Bench;
    use crate::dsp::BLOCK;

    /// inputs at the engine's normal (+1) unless given
    fn run(att: [f64; 4], ofs: [f64; 4], connected_out: [bool; 4]) -> Vec<f32> {
        let mut par = att.to_vec();
        par.extend(ofs);
        let mut b = Bench::new(48_000.0, 4, &par, &[], 4);
        b.connected_out = connected_out.to_vec();
        let o = b.run(&mut Att, 1, |_, i, inp| {
            for x in inp.iter_mut() {
                x[i] = 1.0;
            }
        });
        o.iter().map(|s| s[10]).collect()
    }

    #[test]
    fn with_nothing_patched_each_output_is_att_plus_offset() {
        let o = run([0.5, -1.0, 0.0, 1.0], [0.1, 0.2, 0.3, -0.4], [true; 4]);
        for (got, want) in o.iter().zip([0.6, -0.8, 0.3, 0.6]) {
            assert!((got - want).abs() < 1e-6, "{o:?}");
        }
    }

    #[test]
    fn an_unpatched_output_adds_into_the_next() {
        // out1 and out2 unpatched: out3 = its own + out2 (which holds out1)
        let o = run(
            [0.5, 0.25, 0.125, 0.0],
            [0.0; 4],
            [false, false, true, true],
        );
        assert!((o[2] - 0.875).abs() < 1e-6 && o[3].abs() < 1e-6, "{o:?}");
    }

    #[test]
    fn blockwise_equals_per_sample() {
        let s = |f: f32| {
            (0..4 * BLOCK)
                .map(|i| (i as f32 * f).sin())
                .collect::<Vec<f32>>()
        };
        Bench::blockwise_equals_per_sample(
            || Box::new(Att),
            &[s(0.1), s(0.2), vec![], s(0.3)],
            &[0.5, -0.5, 1.0, 0.2, 0.1, 0.0, -0.3, 0.4],
            &[],
            4,
            4,
        );
    }
}
