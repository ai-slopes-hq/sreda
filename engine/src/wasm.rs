//! Raw C-ABI exports for the AudioWorklet (no wasm-bindgen: the worklet has no TextDecoder).
//! The engine lives in a Box behind a pointer that JavaScript holds.

use crate::engine::Engine;
use crate::plan::{decode, PlanError};

#[no_mangle]
pub extern "C" fn engine_new(sample_rate: f64, seed: u32) -> *mut Engine {
    Box::into_raw(Box::new(Engine::new(sample_rate, seed)))
}

/// Scratch memory for a plan's JSON; `engine_apply` frees it.
#[no_mangle]
pub extern "C" fn engine_alloc(len: usize) -> *mut u8 {
    let mut v = Vec::<u8>::with_capacity(len);
    let p = v.as_mut_ptr();
    std::mem::forget(v);
    p
}

/// 0 = applied, 1 = the JSON did not decode or the plan is invalid, 2 = an unknown module type.
///
/// # Safety
/// `e` comes from `engine_new`; `ptr` / `len` from `engine_alloc`, filled with `len` bytes.
#[no_mangle]
pub unsafe extern "C" fn engine_apply(e: *mut Engine, ptr: *mut u8, len: usize) -> i32 {
    let bytes = unsafe { Vec::from_raw_parts(ptr, len, len) };
    let result = decode(&bytes).and_then(|plan| unsafe { (*e).apply(plan) });
    match result {
        Ok(()) => 0,
        Err(PlanError::UnknownType(_)) => 2,
        Err(_) => 1,
    }
}

/// # Safety
/// `e` comes from `engine_new`.
#[no_mangle]
pub unsafe extern "C" fn engine_knob(e: *mut Engine, node: u32, index: u32, value: f64) {
    unsafe { (*e).knob(node as usize, index as usize, value) }
}

/// # Safety
/// `e` comes from `engine_new`.
#[no_mangle]
pub unsafe extern "C" fn engine_fixed(e: *mut Engine, node: u32, index: u32, value: f64) {
    unsafe { (*e).fixed(node as usize, index as usize, value) }
}

/// # Safety
/// `e` comes from `engine_new`.
#[no_mangle]
pub unsafe extern "C" fn engine_att(e: *mut Engine, node: u32, input: u32, value: f64) {
    unsafe { (*e).att(node as usize, input as usize, value) }
}

/// # Safety
/// `e` comes from `engine_new`.
#[no_mangle]
pub unsafe extern "C" fn engine_ratio(e: *mut Engine, node: u32, input: u32, value: i32) {
    unsafe { (*e).ratio(node as usize, input as usize, value) }
}

/// # Safety
/// `e` comes from `engine_new`.
#[no_mangle]
pub unsafe extern "C" fn engine_mute(e: *mut Engine, frame: u32, on: i32) {
    unsafe { (*e).mute(frame as usize, on != 0) }
}

/// # Safety
/// `e` comes from `engine_new`.
#[no_mangle]
pub unsafe extern "C" fn engine_fade_in(e: *mut Engine, ms: f64) {
    unsafe { (*e).fade_in(ms) }
}

/// `node` −1 ends listening.
///
/// # Safety
/// `e` comes from `engine_new`.
#[no_mangle]
pub unsafe extern "C" fn engine_listen(e: *mut Engine, node: i32, port: i32) {
    let target = (node >= 0 && port >= 0).then_some((node as usize, port as usize));
    unsafe { (*e).listen(target) }
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

/// # Safety
/// `e` comes from `engine_new`.
#[no_mangle]
pub unsafe extern "C" fn engine_readouts(e: *mut Engine) -> *const f32 {
    unsafe { (*e).readouts().as_ptr() }
}

/// # Safety
/// `e` comes from `engine_new`.
#[no_mangle]
pub unsafe extern "C" fn engine_readouts_len(e: *mut Engine) -> u32 {
    unsafe { (*e).readouts().len() as u32 }
}
