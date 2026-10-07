//! QUANT: pitch to the nearest degree of a scale from a root (ties go down).

use crate::dsp::{Ctx, Dsp, Io};
use crate::spec::{choice, knob, port, ModuleSpec, Role, Unit};

/// CHR MAJ MIN DOR PHR PMIN PMAJ WHL — the same table as TypeScript's `SCALES`
pub const SCALES: [&[i32]; 8] = [
    &[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
    &[0, 2, 4, 5, 7, 9, 11],
    &[0, 2, 3, 5, 7, 8, 10],
    &[0, 2, 3, 5, 7, 9, 10],
    &[0, 1, 3, 5, 7, 8, 10],
    &[0, 3, 5, 7, 10],
    &[0, 2, 4, 7, 9],
    &[0, 2, 4, 6, 8, 10],
];

pub fn spec() -> ModuleSpec {
    ModuleSpec {
        type_: "quant",
        label: "QUANT",
        desc: "scale quantiser",
        size: (3, 1),
        inputs: vec![port("in", "IN", Role::Pitch)],
        outputs: vec![port("out", "OUT", Role::Pitch)],
        params: vec![
            choice(
                "scale",
                "SCALE",
                &["CHR", "MAJ", "MIN", "DOR", "PHR", "PMIN", "PMAJ", "WHL"],
                0,
            )
            .glyph("scale")
            .into(),
            knob("root", "ROOT", 0.0, 11.0, 0.0)
                .step(1.0)
                .unit(Unit::Note)
                .into(),
        ],
        normals: vec![],
        display: None,
    }
}

/// The nearest semitone (from C) in `scale` from `root`; ties go down.
pub fn snap(semis: f64, scale: &[i32], root: i32) -> f64 {
    let rel = semis - root as f64;
    let octave = (rel / 12.0).floor() as i32;
    let mut best = f64::INFINITY;
    let mut pick = rel;
    // ascending candidates; a tie (within 1e-4, f32 inputs) keeps the lower one
    for o in octave - 1..=octave + 1 {
        for d in scale {
            let c = (12 * o + d) as f64;
            if (c - rel).abs() < best - 1e-4 {
                best = (c - rel).abs();
                pick = c;
            }
        }
    }
    pick + root as f64
}

pub struct Quant;

impl Dsp for Quant {
    fn process(&mut self, io: &mut Io, _ctx: &mut Ctx, from: usize, to: usize) {
        let scale = SCALES[(io.fixed[0] as usize).min(SCALES.len() - 1)];
        for i in from..to {
            let root = io.par[0][i].round() as i32;
            io.out[0][i] = (snap(io.inp[0][i] as f64 * 12.0, scale, root) / 12.0) as f32;
        }
    }
    fn reset(&mut self) {}
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::dsp::bench::Bench;
    use crate::dsp::BLOCK;

    fn q(input_st: f64, scale: f64, root: f64) -> f64 {
        let mut b = Bench::new(48_000.0, 1, &[root], &[scale], 1);
        b.connected_in = vec![true];
        let o = b.run(&mut Quant, 1, |_, i, inp| {
            inp[0][i] = (input_st / 12.0) as f32
        });
        o[0][0] as f64 * 12.0
    }

    #[test]
    fn major_from_c_maps_1_08_semitones_to_d() {
        assert!((q(1.08, 1.0, 0.0) - 2.0).abs() < 1e-4);
    }

    #[test]
    fn ties_go_down_and_octaves_are_kept() {
        // A minor: C# (1) lies between C (0) and D (2) → C
        assert!((q(1.0, 2.0, 9.0) - 0.0).abs() < 1e-4);
        // an octave up and below zero alike
        assert!((q(13.0, 2.0, 9.0) - 12.0).abs() < 1e-4);
        assert!((q(-11.0, 2.0, 9.0) - -12.0).abs() < 1e-4);
        // chromatic passes through rounded semitones
        assert!((q(4.4, 0.0, 0.0) - 4.0).abs() < 1e-4);
    }

    #[test]
    fn blockwise_equals_per_sample() {
        let x: Vec<f32> = (0..4 * BLOCK).map(|i| (i as f32 * 0.01).sin()).collect();
        Bench::blockwise_equals_per_sample(|| Box::new(Quant), &[x], &[3.0], &[2.0], 1, 4);
    }
}
