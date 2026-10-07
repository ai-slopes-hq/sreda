//! Every module, by type id: one line per module in `MODULES`.

use crate::dsp::Dsp;
use crate::modules::*;
use crate::spec::ModuleSpec;

type Make = fn(f64) -> Box<dyn Dsp>;
/// (type id, spec, constructor at a sample rate)
type Entry = (&'static str, fn() -> ModuleSpec, Make);

/// Every module, in type-id order.
const MODULES: &[Entry] = &[
    ("lpg", lpg::spec, |sr| Box::new(lpg::Lpg::new(sr))),
    ("noise", noise::spec, |_| Box::new(noise::Noise::new())),
    ("osc", osc::spec, |sr| Box::new(osc::Osc::new(sr))),
    ("out", out::spec, |_| Box::new(out::Out)),
    ("scope", scope::spec, |sr| Box::new(scope::Scope::new(sr))),
    ("slope", slope::spec, |sr| Box::new(slope::Slope::new(sr))),
];

/// Every module's spec, in type-id order (what `pnpm specs` exports).
pub fn specs() -> Vec<ModuleSpec> {
    MODULES.iter().map(|(_, spec, _)| spec()).collect()
}

/// One type's spec, including the engine's test-only modules under `cfg(test)`.
pub fn spec_of(type_: &str) -> Option<ModuleSpec> {
    #[cfg(test)]
    if let Some(s) = crate::testmods::spec(type_) {
        return Some(s);
    }
    MODULES
        .iter()
        .find(|(t, _, _)| *t == type_)
        .map(|(_, spec, _)| spec())
}

pub fn create(type_: &str, sample_rate: f64) -> Option<Box<dyn Dsp>> {
    #[cfg(test)]
    if let Some(d) = crate::testmods::create(type_) {
        return Some(d);
    }
    MODULES
        .iter()
        .find(|(t, _, _)| *t == type_)
        .map(|(_, _, make)| make(sample_rate))
}

/// The checked-in `specs.json` is exactly this (2-space JSON, trailing newline).
pub fn specs_json() -> String {
    serde_json::to_string_pretty(&specs()).expect("specs serialise") + "\n"
}

#[cfg(test)]
mod tests {
    #[test]
    fn type_ids_are_sorted_unique_and_match_their_specs() {
        let ids: Vec<&str> = super::MODULES.iter().map(|(t, _, _)| *t).collect();
        assert!(ids.windows(2).all(|w| w[0] < w[1]), "{ids:?}");
        for (t, spec, _) in super::MODULES {
            assert_eq!(spec().type_, *t);
        }
    }
}
