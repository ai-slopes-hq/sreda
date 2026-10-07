//! `pnpm specs`: print every module spec as JSON for TypeScript.
fn main() {
    print!("{}", sreda_engine::registry::specs_json());
}
