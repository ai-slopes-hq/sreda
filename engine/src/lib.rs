//! SREDA 2 engine: the audio engine and every module's spec and DSP.

pub mod dsp;
pub mod engine;
pub mod events;
pub mod inputs;
pub mod master;
pub mod modules;
pub mod plan;
pub mod registry;
pub mod samples;
pub mod shaping;
pub mod spec;
#[cfg(test)]
mod testmods;

#[cfg(target_arch = "wasm32")]
mod wasm;

pub use engine::Engine;
