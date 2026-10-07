//! Raw C-ABI exports for the AudioWorklet (no wasm-bindgen: the worklet has no TextDecoder).
//! The engine lives in a Box behind a pointer that JavaScript holds.

use crate::engine::Engine;

#[no_mangle]
pub extern "C" fn engine_new(sample_rate: f64, seed: u32) -> *mut Engine {
    Box::into_raw(Box::new(Engine::new(sample_rate, seed)))
}

/// # Safety
/// `e` comes from `engine_new`.
#[no_mangle]
pub unsafe extern "C" fn engine_set_tone(e: *mut Engine, hz: f64) {
    unsafe { (*e).set_tone(hz) }
}

/// 256 floats: the L block, then the R block.
///
/// # Safety
/// `e` comes from `engine_new`.
#[no_mangle]
pub unsafe extern "C" fn engine_process(e: *mut Engine) -> *const f32 {
    unsafe {
        (*e).process();
        (*e).out_ptr()
    }
}
