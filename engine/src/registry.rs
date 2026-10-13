//! Every module, by type id: one line per module in `MODULES`.

use crate::dsp::Dsp;
use crate::modules::*;
use crate::spec::ModuleSpec;

type Make = fn(f64) -> Box<dyn Dsp>;
/// (type id, spec, constructor at a sample rate)
type Entry = (&'static str, fn() -> ModuleSpec, Make);

/// Every module, in type-id order.
const MODULES: &[Entry] = &[
    ("a4", a4::spec, |sr| Box::new(a4::A4::new(sr))),
    ("a4clk", a4clk::spec, |sr| Box::new(a4clk::A4Clk::new(sr))),
    ("abc", abc::spec, |_| Box::new(abc::Abc)),
    ("att", att::spec, |_| Box::new(att::Att)),
    ("chance", chance::spec, |sr| {
        Box::new(chance::Chance::new(sr))
    }),
    ("clock", clock::spec, |sr| Box::new(clock::Clock::new(sr))),
    ("compare", compare::spec, |_| {
        Box::new(compare::Compare::default())
    }),
    ("complex", complex::spec, |sr| {
        Box::new(complex::Complex::new(sr))
    }),
    ("delay", delay::spec, |sr| Box::new(delay::Delay::new(sr))),
    ("drive", drive::spec, |sr| Box::new(drive::Drive::new(sr))),
    ("filter", filter::spec, |sr| {
        Box::new(filter::Filter::new(sr))
    }),
    ("fold", fold::spec, |sr| Box::new(fold::Fold::new(sr))),
    ("follow", follow::spec, |sr| {
        Box::new(follow::Follow::new(sr))
    }),
    ("grains", grains::spec, |sr| {
        Box::new(grains::Grains::new(sr))
    }),
    ("lpg", lpg::spec, |sr| Box::new(lpg::Lpg::new(sr))),
    ("metaseq", metaseq::spec, |sr| {
        Box::new(metaseq::MetaSeq::new(sr))
    }),
    ("mix", mix::spec, |_| Box::new(mix::Mix)),
    ("noise", noise::spec, |_| Box::new(noise::Noise::new())),
    ("osc", osc::spec, |sr| Box::new(osc::Osc::new(sr))),
    ("out", out::spec, |sr| Box::new(out::Out::new(sr))),
    ("quant", quant::spec, |_| Box::new(quant::Quant)),
    ("reverb", reverb::spec, |sr| {
        Box::new(reverb::Reverb::new(sr))
    }),
    ("sampler", sampler::spec, |sr| {
        Box::new(sampler::Sampler::new(sr))
    }),
    ("scope", scope::spec, |sr| Box::new(scope::Scope::new(sr))),
    ("shift", shift::spec, |sr| Box::new(shift::Shift::new(sr))),
    ("slope", slope::spec, |sr| Box::new(slope::Slope::new(sr))),
    ("snh", snh::spec, |_| Box::new(snh::Snh::default())),
    ("spread", switch::spread_spec, |sr| {
        Box::new(switch::Switch::new(sr, true))
    }),
    ("switch", switch::switch_spec, |sr| {
        Box::new(switch::Switch::new(sr, false))
    }),
    ("uncertainty", uncertainty::spec, |sr| {
        Box::new(uncertainty::Uncertainty::new(sr))
    }),
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
