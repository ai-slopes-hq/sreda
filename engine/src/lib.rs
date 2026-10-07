//! SREDA 2 engine: the audio engine and every module's spec and DSP.

pub mod dsp;
pub mod engine;
pub mod master;
pub mod modules;
pub mod registry;
pub mod spec;

#[cfg(target_arch = "wasm32")]
mod wasm;

pub use engine::Engine;
