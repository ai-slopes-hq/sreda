//! The real-time budget: one of every module, patched, runs a minute of audio in well under real time.
//! Run in release: `cargo test --release -p sreda-engine --test realtime -- --ignored`.

use std::time::Instant;

use sreda_engine::Engine;

#[test]
#[ignore = "a benchmark: run in release"]
fn every_module_type_runs_a_minute_in_under_0_3_of_real_time() {
    let path = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/tests/fixtures/plan-all-a.json"
    );
    let plan = sreda_engine::plan::decode(&std::fs::read(path).unwrap()).unwrap();
    let mut e = Engine::new(48_000.0, 1);
    e.apply(plan).unwrap();
    let blocks = 60 * 48_000 / 128;
    let t = Instant::now();
    let mut sum = 0.0f32;
    for _ in 0..blocks {
        sum += e.process().0[0];
    }
    let took = t.elapsed().as_secs_f64();
    assert!(sum.is_finite());
    assert!(took < 0.3 * 60.0, "a minute of audio took {took:.2} s");
    eprintln!(
        "a minute of audio with every module type: {took:.3} s ({:.1} % of real time)",
        took / 60.0 * 100.0
    );
}

#[test]
#[ignore = "a benchmark: run in release"]
fn two_hundred_modules_run_a_minute_in_under_a_quarter_of_real_time() {
    let path = concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fixtures/plan-200.json");
    let plan = sreda_engine::plan::decode(&std::fs::read(path).unwrap()).unwrap();
    let mut e = Engine::new(48_000.0, 1);
    e.apply(plan).unwrap();
    let blocks = 60 * 48_000 / 128;
    let t = Instant::now();
    let mut sum = 0.0f32;
    for _ in 0..blocks {
        sum += e.process().0[0];
    }
    let took = t.elapsed().as_secs_f64();
    assert!(sum.is_finite());
    assert!(took < 0.25 * 60.0, "a minute of audio took {took:.2} s");
    eprintln!(
        "a minute of audio with 200 modules in 20 frames: {took:.3} s ({:.1} % of real time)",
        took / 60.0 * 100.0
    );
}
