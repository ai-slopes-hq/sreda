//! Nothing on the audio thread allocates: a counting global allocator watches `Engine::process`.

use std::alloc::{GlobalAlloc, Layout, System};
use std::sync::atomic::{AtomicUsize, Ordering};

use sreda_engine::Engine;

struct Counting;
static ALLOCS: AtomicUsize = AtomicUsize::new(0);

unsafe impl GlobalAlloc for Counting {
    unsafe fn alloc(&self, layout: Layout) -> *mut u8 {
        ALLOCS.fetch_add(1, Ordering::Relaxed);
        unsafe { System.alloc(layout) }
    }
    unsafe fn dealloc(&self, ptr: *mut u8, layout: Layout) {
        unsafe { System.dealloc(ptr, layout) }
    }
    unsafe fn realloc(&self, ptr: *mut u8, layout: Layout, new_size: usize) -> *mut u8 {
        ALLOCS.fetch_add(1, Ordering::Relaxed);
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
    let before = ALLOCS.load(Ordering::Relaxed);
    for i in 0..10_000 {
        if i % 100 == 0 {
            e.knob(0, 0, (i % 1000) as f64 / 1000.0);
            e.att(0, 1, 0.5);
        }
        e.process();
    }
    assert_eq!(ALLOCS.load(Ordering::Relaxed) - before, 0);
}
