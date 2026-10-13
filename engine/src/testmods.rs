//! Tiny modules for the engine's own tests (compiled only under `cfg(test)`).

use std::sync::atomic::{AtomicU32, Ordering};

use crate::dsp::{Ctx, Dsp, Io};
use crate::spec::{knob, port, ModuleSpec, Role};

/// How many times a `boom` was reset.
pub static BOOM_RESETS: AtomicU32 = AtomicU32::new(0);

fn m(
    type_: &'static str,
    inputs: Vec<crate::spec::Port>,
    params: Vec<crate::spec::Param>,
) -> ModuleSpec {
    ModuleSpec {
        type_,
        internal: false,
        label: type_,
        desc: "",
        size: (3, 1),
        inputs,
        outputs: vec![port("out", "OUT", Role::Audio)],
        params,
        normals: vec![],
        display: None,
    }
}

pub fn spec(type_: &str) -> Option<ModuleSpec> {
    Some(match type_ {
        // out = v
        "dc" => m("dc", vec![], vec![knob("v", "V", -10.0, 10.0, 0.0).into()]),
        // out = in · g
        "gain" => m(
            "gain",
            vec![port("in", "IN", Role::Audio)],
            vec![knob("g", "G", 0.0, 2.0, 1.0).into()],
        ),
        // out = cv input as prepared (to see attenuverters and normals)
        "cvthru" => m("cvthru", vec![port("cv", "CV", Role::Mod)], vec![]),
        // out = the prepared trigger input
        "trig" => m("trig", vec![port("clk", "CLK", Role::Trigger)], vec![]),
        // out = the prepared held input
        "held" => m("held", vec![port("g", "G", Role::Trigger).held()], vec![]),
        // inputs: a held one, then a trigger (to check the trigger readout slots)
        "held2" => m(
            "held2",
            vec![
                port("g", "G", Role::Trigger).held(),
                port("t", "T", Role::Trigger),
            ],
            vec![],
        ),
        // out = NaN
        "boom" => m("boom", vec![], vec![]),
        // state() = 3, trace() = 0, 1, 2, …
        "stater" => ModuleSpec {
            display: Some(crate::spec::Display {
                lanes: 4,
                kind: "scope",
            }),
            ..m("stater", vec![], vec![])
        },
        _ => return None,
    })
}

struct Dc;
impl Dsp for Dc {
    fn process(&mut self, io: &mut Io, _ctx: &mut Ctx, from: usize, to: usize) {
        io.out[0][from..to].copy_from_slice(&io.par[0][from..to]);
    }
    fn reset(&mut self) {}
}

struct Gain;
impl Dsp for Gain {
    fn process(&mut self, io: &mut Io, _ctx: &mut Ctx, from: usize, to: usize) {
        for i in from..to {
            io.out[0][i] = io.inp[0][i] * io.par[0][i];
        }
    }
    fn reset(&mut self) {}
}

struct Thru;
impl Dsp for Thru {
    fn process(&mut self, io: &mut Io, _ctx: &mut Ctx, from: usize, to: usize) {
        io.out[0][from..to].copy_from_slice(&io.inp[0][from..to]);
    }
    fn reset(&mut self) {}
}

struct Boom;
impl Dsp for Boom {
    fn process(&mut self, io: &mut Io, _ctx: &mut Ctx, from: usize, to: usize) {
        io.out[0][from..to].fill(f32::NAN);
    }
    fn reset(&mut self) {
        BOOM_RESETS.fetch_add(1, Ordering::Relaxed);
    }
}

struct Stater(Vec<f32>);
impl Dsp for Stater {
    fn process(&mut self, _io: &mut Io, _ctx: &mut Ctx, _from: usize, _to: usize) {}
    fn reset(&mut self) {}
    fn state(&self) -> f32 {
        3.0
    }
    fn trace(&self) -> Option<&[f32]> {
        Some(&self.0)
    }
}

pub fn create(type_: &str) -> Option<Box<dyn Dsp>> {
    Some(match type_ {
        "dc" => Box::new(Dc),
        "gain" => Box::new(Gain),
        "cvthru" | "trig" | "held" | "held2" => Box::new(Thru),
        "boom" => Box::new(Boom),
        "stater" => Box::new(Stater(
            (0..crate::dsp::TRACE_LEN).map(|i| i as f32).collect(),
        )),
        _ => return None,
    })
}
