//! Every module, by type id.

use crate::dsp::Dsp;
use crate::modules::{noise, osc, out, scope, slope};
use crate::spec::ModuleSpec;

/// Every module's spec, in type-id order (what `pnpm specs` exports).
pub fn specs() -> Vec<ModuleSpec> {
    vec![
        noise::spec(),
        osc::spec(),
        out::spec(),
        scope::spec(),
        slope::spec(),
    ]
}

/// One type's spec, including the engine's test-only modules under `cfg(test)`.
pub fn spec_of(type_: &str) -> Option<ModuleSpec> {
    #[cfg(test)]
    if let Some(s) = crate::testmods::spec(type_) {
        return Some(s);
    }
    specs().into_iter().find(|s| s.type_ == type_)
}

pub fn create(type_: &str, sample_rate: f64) -> Option<Box<dyn Dsp>> {
    #[cfg(test)]
    if let Some(d) = crate::testmods::create(type_) {
        return Some(d);
    }
    match type_ {
        "osc" => Some(Box::new(osc::Osc::new(sample_rate))),
        "out" => Some(Box::new(out::Out)),
        "scope" => Some(Box::new(scope::Scope::new(sample_rate))),
        "slope" => Some(Box::new(slope::Slope::new(sample_rate))),
        "noise" => Some(Box::new(noise::Noise::new())),
        _ => None,
    }
}

/// The checked-in `specs.json` is exactly this (2-space JSON, trailing newline).
pub fn specs_json() -> String {
    serde_json::to_string_pretty(&specs()).expect("specs serialise") + "\n"
}
