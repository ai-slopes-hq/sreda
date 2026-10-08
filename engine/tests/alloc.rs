//! Nothing on the audio thread allocates: a counting global allocator watches `Engine::process`.

use std::alloc::{GlobalAlloc, Layout, System};
use std::cell::Cell;

use sreda_engine::Engine;

struct Counting;
// per thread: tests run in parallel, and another test's decoding must not count against this one
thread_local! {
    static ALLOCS: Cell<usize> = const { Cell::new(0) };
}
fn allocs() -> usize {
    ALLOCS.with(|a| a.get())
}

unsafe impl GlobalAlloc for Counting {
    unsafe fn alloc(&self, layout: Layout) -> *mut u8 {
        ALLOCS.with(|a| a.set(a.get() + 1));
        unsafe { System.alloc(layout) }
    }
    unsafe fn dealloc(&self, ptr: *mut u8, layout: Layout) {
        unsafe { System.dealloc(ptr, layout) }
    }
    unsafe fn realloc(&self, ptr: *mut u8, layout: Layout, new_size: usize) -> *mut u8 {
        ALLOCS.with(|a| a.set(a.get() + 1));
        unsafe { System.realloc(ptr, layout, new_size) }
    }
}

#[global_allocator]
static GLOBAL: Counting = Counting;

#[test]
fn process_and_knob_messages_allocate_nothing() {
    let json = std::fs::read(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/tests/fixtures/plan-self-fm.json"
    ))
    .unwrap();
    let mut e = Engine::new(48_000.0, 1);
    e.apply(sreda_engine::plan::decode(&json).unwrap()).unwrap();
    e.process();
    let before = allocs();
    for i in 0..10_000 {
        if i % 100 == 0 {
            e.knob(0, 0, (i % 1000) as f64 / 1000.0);
            e.att(0, 1, 0.5);
        }
        e.process();
    }
    assert_eq!(allocs() - before, 0);
}

fn fixture(name: &str) -> sreda_engine::plan::Plan {
    let path = format!(
        "{}/tests/fixtures/plan-{name}.json",
        env!("CARGO_MANIFEST_DIR")
    );
    sreda_engine::plan::decode(&std::fs::read(path).unwrap()).unwrap()
}

#[test]
fn fades_crossfades_triggers_and_scope_allocate_nothing() {
    let mut e = Engine::new(48_000.0, 1);
    e.apply(fixture("scope-a")).unwrap();
    for _ in 0..100 {
        e.process();
    }
    // OUT removed (fades out), the OSC moved from SCOPE A to B (crossfades) — both run inside the measured loop
    e.apply(fixture("scope-b")).unwrap();
    let before = allocs();
    for _ in 0..10_000 {
        e.process();
    }
    assert_eq!(allocs() - before, 0);
}

#[test]
fn every_module_type_together_allocates_nothing() {
    let mut e = Engine::new(48_000.0, 1);
    e.apply(fixture("all-a")).unwrap();
    for _ in 0..100 {
        e.process();
    }
    // a module removed (it fades out) and an input re-routed (it crossfades) — inside the measured loop
    e.apply(fixture("all-b")).unwrap();
    let before = allocs();
    for _ in 0..10_000 {
        e.process();
    }
    assert_eq!(allocs() - before, 0);
}

#[test]
fn frames_gated_cables_and_mute_toggles_allocate_nothing() {
    let mut e = Engine::new(48_000.0, 1);
    e.apply(fixture("frames")).unwrap();
    e.process();
    let before = allocs();
    for i in 0..10_000 {
        if i % 100 == 0 {
            e.mute(i / 100 % 2, i % 200 == 0);
        }
        e.process();
    }
    assert_eq!(allocs() - before, 0);
}

#[test]
fn the_200_module_patch_allocates_nothing() {
    let mut e = Engine::new(48_000.0, 1);
    e.apply(fixture("200")).unwrap();
    e.process();
    let before = allocs();
    for _ in 0..750 {
        e.process();
    }
    assert_eq!(allocs() - before, 0);
}
