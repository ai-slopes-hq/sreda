//! The checked-in specs.json must equal the export: run `pnpm specs` after changing a module spec.

#[test]
fn specs_json_is_up_to_date() {
    let path = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../packages/core/src/generated/specs.json"
    );
    let on_disk = std::fs::read_to_string(path).unwrap_or_default();
    assert!(
        on_disk == sreda_engine::registry::specs_json(),
        "specs.json is stale: run `pnpm specs`"
    );
}
