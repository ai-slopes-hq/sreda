//! Every module, by type id.

use crate::dsp::Dsp;
use crate::modules::{osc, out};
use crate::spec::ModuleSpec;

/// Every module's spec, in type-id order.
pub fn specs() -> Vec<ModuleSpec> {
    vec![osc::spec(), out::spec()]
}

pub fn create(type_: &str, sample_rate: f64) -> Option<Box<dyn Dsp>> {
    match type_ {
        "osc" => Some(Box::new(osc::Osc::new(sample_rate))),
        "out" => Some(Box::new(out::Out)),
        _ => None,
    }
}

/// The checked-in `specs.json` is exactly this (2-space JSON, trailing newline).
pub fn specs_json() -> String {
    serde_json::to_string_pretty(&specs()).expect("specs serialise") + "\n"
}
