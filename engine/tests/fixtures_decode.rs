//! Every plan TypeScript wrote as a fixture (UPDATE_FIXTURES=1 pnpm test -- compile) decodes and plays.

#[test]
fn every_fixture_decodes_and_applies() {
    let dir = concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fixtures");
    let mut n = 0;
    for entry in std::fs::read_dir(dir).expect("fixtures") {
        let path = entry.unwrap().path();
        if path.extension().is_some_and(|e| e == "json") {
            let plan = sreda_engine::plan::decode(&std::fs::read(&path).unwrap())
                .unwrap_or_else(|e| panic!("{path:?}: {e:?}"));
            let mut engine = sreda_engine::Engine::new(48_000.0, 1);
            engine
                .apply(plan)
                .unwrap_or_else(|e| panic!("{path:?}: {e:?}"));
            for _ in 0..10 {
                assert!(engine.process().0.iter().all(|x| x.is_finite()));
            }
            n += 1;
        }
    }
    assert!(n >= 2, "found {n} fixtures");
}

#[test]
fn a_truncated_plan_is_a_decode_error() {
    let json = std::fs::read(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/tests/fixtures/plan-starter.json"
    ))
    .unwrap();
    assert!(matches!(
        sreda_engine::plan::decode(&json[..json.len() / 2]),
        Err(sreda_engine::plan::PlanError::Decode(_))
    ));
}
