# SREDA 2 · Plan 1 — Foundation: document (TS), engine and 24 modules (Rust → WASM)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Everything below the UI: the patch document, edits, frames, undo and compile in TypeScript; the engine and
all 24 modules in Rust, built natively for tests and to WASM for the app; factory patches rendered end to end
(TypeScript compiles, the WASM engine plays) into WAV files you can listen to.

**Architecture:** pnpm workspace for TypeScript (`packages/core`, `packages/protocol`) and a Cargo crate `engine/`
for Rust. Each module's spec lives next to its DSP in Rust; the `export-specs` binary writes
`packages/core/src/generated/specs.json`, which TypeScript reads. The boundary is the plan (JSON) and numeric
messages through raw WASM exports (no wasm-bindgen: the AudioWorklet has no TextDecoder). No Electron, no UI here.

**Tech Stack:** TypeScript ~6.0.3, pnpm@12.8.1, Node ≥ 22, Vitest ^5.0.3, ESLint ^10.11.0 + typescript-eslint
^8.71.0, Prettier ^3.9.9, tsx; Rust stable with the `wasm32-unknown-unknown` target, `serde` + `serde_json`
(plan decoding and spec export only, never inside `process`).

**Spec:** `docs/superpowers/specs/2026-10-07-canvas-ux-design.md` (revision 12, approved). The prototype
`docs/prototype/Main.dc.html` holds plain-JS versions of the frame geometry (`recomputeParents`, `layoutRows`,
`stackFrame`, `landingFrame`, `extractGroup`, `mergeInto`), the panel layout (`lay`), the generators (`euclid`,
`genNotes`, `diceModule`), the module specs (`SPECS`, `SIZES`) and the factory content (`SEEDS`, `FACTORY_GROUPS`,
`buildWith`): port them, do not re-derive them. Its `Sim` is not a DSP reference.

**This plan is 1 of 3.** Plan 2 — the Electron app and the canvas (window, worklet host, store, autosave, modules
and cables on screen, patching gestures, the module picker, readouts). Plan 3 — frames UI, WIRE FIX / STACK / MUTE,
the sidebar and WIRES, the library folder and pickers for groups and projects, e2e. Both are written after this one.

## Global Constraints

- TS package boundaries `core ← protocol`; ESLint enforces it. Rust never depends on TS; TS reads Rust only through
  `specs.json` and the WASM exports.
- Audio thread rule: nothing inside `Engine::process` or a `Dsp::process` allocates, locks, logs or panics on valid
  input; buffers and queues are allocated on construction or on `apply`. Enforced by a counting global allocator test.
- Sample rate is whatever the engine is created with (tests use 48 000 and 44 100); `BLOCK = 128`.
- Roles: `audio` nominal ±1; `mod` ±1 or 0…1 per output; `pitch` octaves (+1.0 = one octave up); `trigger` fires on a
  rising edge above 0.5, re-arms below 0.25; trigger outputs 0/1, triggers 1 ms, gates as long as they last.
- Stacking: audio / mod / pitch inputs sum their cables; trigger inputs merge (each source edge-detected on its own).
- Attenuverter (−1…+1) on mod and pitch inputs and every knob mod jack, after the sum; default 1, mod-jack default =
  the param's `modDepth` (0.25 for frequency-type knobs). Audio inputs have none.
- Ratio on every trigger input, signed integer: −16…−2 = ÷N, 1 = unity, 2…8 = ×N, after the merge. ÷N passes the
  1st of every N; ×N adds N−1 evenly spaced events over the last incoming interval (nothing extra until two events).
- Knob modulation: ±1 at attenuverter 1 sweeps the whole knob range in knob space (taper included); knob changes
  glide 10 ms in knob space.
- Sound: f32 buffers, f64 state; polyBLEP on OSC SAW / SQR; FOLD and COMPLEX's timbre use first-order ADAA with 2×
  oversampling; a 1e-20 offset in filter and feedback state keeps out of denormals.
- Master: 5 Hz DC blocker, soft limiter (identity to |x| 0.9, `sign·(0.9 + 0.1·tanh((|x|−0.9)/0.1))` above), nothing
  non-finite reaches the output; the listen path goes through it too; several OUT modules sum before it.
- Fades: removed nodes and re-routed inputs 10 ms; frame mute 50 ms; factory projects fade in over 200 ms.
- Panel grammar (spec §2): header 24 px; lanes 28 px (1U = 3, 2U = 7, 3U = 11); IN column 1 HP | control area
  N − 2 HP | OUT column 1 HP; one jack per lane in spec order; control area = display (whole lanes) → knob rows
  (2 lanes each) → mode strip (bottom lane; options from the left, actions from the right; 1 HP per button, 2 HP for
  a `▾` list with words). Displays: STAGES 8 lanes, RHYTHM 4, SCOPE 4. HP = 48, U = 112.
- Sizes (HP × U): OSC 5×1, COMPLEX 6×1, NOISE 3×1, UNCERTAINTY 4×1, SLOPE 5×1, LPG 4×1, FILTER 4×1, FOLD 4×1,
  STAGES 10×3, RHYTHM 10×2, CHANCE 3×1, SHIFT 3×1, COMPARE 3×1, FOLLOW 6×1, SWITCH 4×2, SPREAD 4×2, S&H 2×1,
  QUANT 3×1, MIX 4×2, ATT 6×2, A×B+C 5×2, DELAY 5×1, SCOPE 6×2, OUT 3×1.
- Frames: header 28 px, padding 16 px, WIRE FIX channel 32 px, minimum 352 × 96, grid 16 px.
- Names: English; same-type modules are numbered in names (`SLOPE 1`, `SLOPE 2`).

## Review Focus

1. A runaway feedback patch — DELAY out → its own in at feedback 0.95, through FILTER at res 1 — stays finite and
   within ±1 at the output (test in Task 9).
2. A broken or future document — unknown type, cable to a missing port or module, `parent` naming a missing frame,
   `version: 2` — is rejected by `validateDoc` (null), never half-loaded (test in Task 3).
3. Audio-rate signals in trigger inputs — a 2 kHz square into a ×8 input and into RHYTHM's CLK — keep the pending
   queue bounded and produce no NaN (tests in Task 8 and Task 12).
4. A plan JSON the engine cannot decode (truncated, unknown module type) is refused by `apply` with an error code and
   the previous plan keeps playing (test in Task 15).
5. A sample rate other than 48 kHz (44 100) keeps tuning and timings right: OSC at 440 Hz and a 0.1 s DELAY measure
   the same in seconds at both rates (tests in Task 10 and Task 14).

---

## File structure

```
package.json · pnpm-workspace.yaml · tsconfig.base.json · eslint.config.js · .prettierrc.json · .gitignore
vitest.config.ts · rust-toolchain.toml · Cargo.toml (workspace)
packages/core/src/
  spec.ts        TS types for specs.json; toKnob / fromKnob; inputPorts; SPECS (from generated/specs.json)
  generated/specs.json                      written by `pnpm specs`, checked in
  doc.ts · rng.ts · panel.ts · ops.ts · names.ts · frames.ts · history.ts · plan.ts · compile.ts
  generators.ts · factory.ts · index.ts
packages/protocol/src/
  messages.ts    message shapes used by the worklet glue (plan 2)
  readouts.ts    readout layout helpers
  engine.ts      loadEngine(): the WASM engine wrapped for TS (Node tests now, the worklet in plan 2)
  render.ts      renderDoc(doc, seconds) for tests and the WAV script
scripts/render.ts                           pnpm render <factory name> [seconds] → <name>.wav
engine/
  Cargo.toml     crate sreda-engine: lib (rlib + cdylib), bin export-specs
  src/lib.rs · spec.rs · registry.rs · plan.rs · dsp.rs · inputs.rs · master.rs · clock.rs · engine.rs · wasm.rs
  src/modules/<type>.rs                     spec() + the DSP struct + unit tests, one file per module
  src/bin/export_specs.rs
  tests/alloc.rs · tests/realtime.rs · tests/specs_json.rs · tests/fixtures/
```

Module type ids: `osc complex noise uncertainty slope lpg filter fold stages rhythm chance shift compare follow switch
spread sah quant mix att abc delay scope out`.

---

### Task 1: Workspace scaffold

**Files:** root configs above, `rust-toolchain.toml` (`channel = "stable"`, `targets = ["wasm32-unknown-unknown"]`),
`engine/Cargo.toml`, `engine/src/lib.rs`, `packages/{core,protocol}/{package.json,tsconfig.json,src/index.ts}`,
`packages/core/src/smoke.test.ts`; modify `CLAUDE.md`.

**Interfaces:**
- Produces root scripts: `test` (vitest run), `typecheck`, `lint` (eslint + `cargo clippy -- -D warnings`),
  `test:rust` (`cargo test`), `wasm` (`cargo build -p sreda-engine --release --target wasm32-unknown-unknown`, then
  copy the `.wasm` to `engine/pkg/sreda_engine.wasm`), `specs` (`cargo run -p sreda-engine --bin export-specs >
  packages/core/src/generated/specs.json`), `check` (typecheck && lint && test:rust && wasm && test), `render`
  (`tsx scripts/render.ts`), `format`.

- [ ] **Step 1:** TS tooling mirrors `../sreda` (scripts, tsconfig flags, Prettier, ESLint `forbid` helper with
  `core ← protocol`); `vitest.config.ts` includes `packages/*/src/**/*.test.ts`. Cargo workspace with member
  `engine`; `crate-type = ["rlib", "cdylib"]`; release profile `opt-level = 3`, `lto = true`, `panic = "abort"`.
- [ ] **Step 2:** `smoke.test.ts` `expect(1 + 1).toBe(2)`; `engine/src/lib.rs` with one `#[test]`. `pnpm check` → green.
- [ ] **Step 3:** `CLAUDE.md`: replace the "no code yet" lines with the commands above (`pnpm check`, `pnpm test --
  <path>`, `cargo test -p sreda-engine <name>`, `pnpm specs` after changing a module spec, `pnpm render <name>`);
  rewrite the audio-thread section for Rust (no allocation / locks / logging / panics in `process`, checked by
  `engine/tests/alloc.rs`); keep the package-boundary section with the TS/Rust split; point to `docs/prototype/`.
- [ ] **Step 4:** Commit `chore: scaffold TS workspace and Rust engine crate`.

### Task 2: Module specs in Rust, exported to TS

**Files:** `engine/src/{spec.rs,registry.rs}`, `engine/src/bin/export_specs.rs`, `engine/tests/specs_json.rs`,
`packages/core/src/{spec.ts,generated/specs.json}`; test `spec.test.ts`.

**Interfaces:**
```rust
// spec.rs — serde Serialize with camelCase field names; the JSON is the TS ModuleSpec
pub enum Role { Audio, Mod, Pitch, Trigger }                 // "audio" | "mod" | "pitch" | "trigger"
pub struct Port { pub id: &'static str, pub label: &'static str, pub role: Role, pub polarity: Option<Polarity> }
pub enum Param {                                             // tagged by "kind": "knob" | "option" | "action"
  Knob { id, label, min: f64, max: f64, def: f64, taper: Taper, step: Option<f64>, unit: Option<Unit>,
         random_range: Option<(f64, f64)>, mod_depth: Option<f64>, hidden: bool, glyph: Option<&'static str> },
  Option { id, label, options: &'static [&'static str], def: u32, glyph: Option<&'static str>, hidden: bool },
  Action { id, label } }
pub enum Normal { Own { input, own, when: Option<(&'static str, u32)> }, Internal { input, internal }, Value { input, value: f64 } }
pub struct ModuleSpec { pub type_: &'static str /* "type" */, pub label, pub desc, pub size: (u8, u8),
  pub inputs: Vec<Port>, pub outputs: Vec<Port>, pub params: Vec<Param>, pub normals: Vec<Normal>,
  pub display: Option<Display /* { lanes, kind: scope | contour | pads } */> }
pub fn from_knob(p: &Param, k: f64) -> f64;   pub fn to_knob(p: &Param, v: f64) -> f64;
// registry.rs
pub fn specs() -> Vec<ModuleSpec>;            // every module's spec(), in type-id order (empty until Task 10)
pub fn create(type_: &str, sample_rate: f64) -> Option<Box<dyn Dsp>>;
```
```ts
// spec.ts — the same shapes as TS types (Role, Port, KnobParam, OptionParam, ActionParam, Param, Normal, ModuleSpec, Specs)
export const SPECS: Specs;                                   // from generated/specs.json, keyed by type
export function toKnob(p: KnobParam, value: number): number; // exp taper: log space
export function fromKnob(p: KnobParam, knob: number): number; // clamped, snapped to step
export function inputPorts(spec: ModuleSpec): Port[];        // inputs + a role-'mod' '@id' port per visible knob
```
- [ ] **Step 1: Failing tests:** Rust and TS share these numbers — exp taper 20…20000 maps 0.5 to √(20·20000) ± 1e-6;
  step 1 over 1…16 maps 0.52 to 9; `inputPorts` skips hidden knobs. `engine/tests/specs_json.rs`: the export equals
  `packages/core/src/generated/specs.json` byte for byte (a stale JSON fails `cargo test`).
- [ ] **Step 2:** → FAIL. **Step 3:** Implement; run `pnpm specs`. **Step 4:** `pnpm check` → PASS.
- [ ] **Step 5:** Commit `feat: module specs in Rust, exported to TS`.

### Task 3: Document, validation, panel layout

**Files:** `packages/core/src/{doc.ts,rng.ts,panel.ts}`; tests `doc.test.ts`, `panel.test.ts`.

**Interfaces:**
```ts
export interface ModuleDoc { id: string; type: string; x: number; y: number; parent: string | null;
  params: Record<string, number>; atts: Record<string, number>; ratios: Record<string, number> }  // knob 0…1 | option index
export interface Cable { from: [string, string]; to: [string, string] }
export interface Frame { id: string; name: string; x: number; y: number; w: number; h: number; parent: string | null;
  ratio: number; tint: number; layout: 'free' | 'route'; muted: boolean; clock: { on: boolean; bpm: number } }
export interface Doc { version: 1; modules: ModuleDoc[]; cables: Cable[]; groups: Frame[]; nextId: number }
export const emptyDoc: Doc;
export function validateDoc(json: unknown, specs: Specs): Doc | null;
export function mulberry32(seed: number): () => number;
// panel.ts — port the prototype's lay(); positions relative to the module's top-left
export const HEAD = 24, LANE = 28, LANES = { 1: 3, 2: 7, 3: 11 } as const, HP = 48, U = 112;
export interface PanelLayout { w: number; h: number; lanes: number;
  jacks: Record<string, { x: number; y: number }>;     // ins x 10, outs x w − 10, y 40 + 28·i; mod jacks at a knob cell + (5, 5)
  cells: Record<string, { x: number; y: number; w: number; mode: boolean }>;
  display: { x: number; y: number; w: number; h: number } | null;   // x 50, y 28, w (N−2)·48 − 4, h lanes·28 − 4
  fits: boolean }
export function layoutPanel(spec: ModuleSpec): PanelLayout;
```
Ids: modules `m<n>`, frames `g<n>`; frame jacks `[frameId, 'clkIn' | 'clkOut']`.

- [ ] **Step 1: Failing tests:** `validateDoc` returns null for `version: 2`, an unknown type, a cable to a missing
  port, a cable to a missing module, a `parent` naming a missing frame, a cable to `[frame, 'nope']` (Review
  Focus 2); fills missing params with defaults and keeps atts / ratios. `layoutPanel` on an inline 5×1 spec with 3
  knobs and one 3-value option: knob cells at x 48 / 96 / 144, y 26; the option at the bottom lane (y 82), 2 HP;
  display null; `fits`. `mulberry32(7)` repeats.
- [ ] **Step 2:** → FAIL. **Step 3:** Implement. **Step 4:** → PASS. **Step 5:** Commit `feat(core): document, validation, panel layout`.

### Task 4: Edits and names

**Files:** `packages/core/src/{ops.ts,names.ts}`; tests `ops.test.ts`, `names.test.ts`.

**Interfaces** (pure; new `Doc`; `RuleError` for structural errors only):
```ts
export class RuleError extends Error {}
export function addModule(doc: Doc, specs: Specs, type: string, x: number, y: number): { doc: Doc; id: string };
export function moveObjects(doc: Doc, ids: readonly string[], dx: number, dy: number): Doc;
export function connect(doc: Doc, specs: Specs, from: [string, string], to: [string, string]): Doc;  // stacking; identical cable not duplicated
export function removeCable(doc: Doc, cable: Cable): Doc;
export function setParam(doc: Doc, specs: Specs, id: string, param: string, value: number): Doc;
export function setAtt(doc: Doc, id: string, port: string, v: number | null): Doc;
export function setRatio(doc: Doc, id: string, port: string, r: number): Doc;   // module input or frame 'clkIn'
export function randomize(doc: Doc, specs: Specs, id: string, rng: () => number): Doc;
export function duplicate(doc: Doc, ids: readonly string[], dx: number, dy: number): { doc: Doc; ids: string[] };
export function replaceModule(doc: Doc, specs: Specs, id: string, type: string): { doc: Doc; id: string };
export function insertIntoCable(doc: Doc, specs: Specs, id: string, cable: Cable): Doc;
export function nameOf(doc: Doc, specs: Specs, id: string): string;          // 'SLOPE 2' when several
export function portLabel(doc: Doc, specs: Specs, id: string, port: string): string;
```
Port the prototype's `replaceModule`, `insertIntoCable`, `randomize`; rules in spec §4.

- [ ] **Step 1: Failing tests:** ids never reused; positions snap to 16; two cables into one input both kept, an
  identical third ignored; output→output throws; self-patching allowed; `duplicate` copies only inner cables;
  `randomize` respects `randomRange`, skips options and hidden knobs; `replaceModule` OSC→COMPLEX keeps `freq` in Hz
  and moves `out`, drops unmatched cables; `insertIntoCable` OSC→FILTER with a free FOLD gives OSC→FOLD→FILTER;
  `nameOf` numbers two SLOPEs. → FAIL → implement → PASS.
- [ ] **Step 2:** Commit `feat(core): edits and names`.

### Task 5: Frames

**Files:** `packages/core/src/frames.ts`; test `frames.test.ts`.

**Interfaces** (port the prototype's functions of the same purpose):
```ts
export const GHEAD = 28, GPAD = 16, RGAP = 32, FRAME_MIN = { w: 352, h: 96 };
export function recomputeParents(doc: Doc, specs: Specs, only?: readonly string[]): Doc;
export function descendants(doc: Doc, frameId: string): string[];
export function chainOf(doc: Doc, id: string): string[];
export function createFrame(doc: Doc, specs: Specs, ids: readonly string[]): { doc: Doc; id: string };  // ⌘G: 'route', packed
export function removeFrame(doc: Doc, specs: Specs, frameId: string): Doc;   // ⇧⌘G
export function deleteObjects(doc: Doc, ids: readonly string[]): Doc;        // frames take descendants and touching cables
export function moveDropped(doc: Doc, specs: Specs, roots: readonly string[]): Doc;
export function resizeFrame(doc: Doc, specs: Specs, frameId: string, r: { x: number; y: number; w: number; h: number }): Doc;
export function layoutRows(doc: Doc, specs: Specs, frameId: string): Doc;
export function stackFrame(doc: Doc, specs: Specs, frameId: string): Doc;
export function landingFrame(doc: Doc, specs: Specs, roots: readonly string[], dx: number, dy: number): string | null;
export function extractGroup(doc: Doc, frameId: string): Doc;
export function mergeInto(doc: Doc, src: Doc, dx: number, dy: number): { doc: Doc; map: Record<string, string> };
```
- [ ] **Step 1: Failing tests:** dropped in → parent set, dragged out → null; a moved frame does not capture modules
  it lands on, a resize does; equal-area overlapping frames are never each other's parent; `createFrame` packs two
  modules in one row with 32 px gaps under a 28 px header and a 32 px channel; `layoutRows` wraps at the inner width;
  `stackFrame` leaves no gaps; `removeFrame` re-parents to the grandparent; `deleteObjects([frame])` removes its
  contents and a cable from its `clkOut` to an outside module, and `validateDoc` accepts the result;
  `extractGroup` + `mergeInto` twice gives unique ids. → FAIL → implement → PASS.
- [ ] **Step 2:** Commit `feat(core): frames`.

### Task 6: Undo history

**Files:** `packages/core/src/history.ts`; test `history.test.ts`.
```ts
export type Merge = { key: string; stroke?: boolean } | undefined;
export class History { constructor(initial: Doc, now?: () => number); readonly current: Doc;
  commit(doc: Doc, merge?: Merge): void; replace(doc: Doc): void; undo(): Doc | null; redo(): Doc | null }
```
- [ ] Tests with an injected clock: key 300 ms apart merges, 800 ms does not; `stroke` merges until another key;
  commit after undo clears redo; `replace` adds no step. → FAIL → implement → PASS. Commit `feat(core): undo history`.

### Task 7: Compile

**Files:** `packages/core/src/{plan.ts,compile.ts}`, `packages/protocol/src/readouts.ts`; test `compile.test.ts`.

**Interfaces** (the JSON the Rust engine decodes in Task 9 — field names exactly as here):
```ts
export interface Source { node: number; port: number; late: boolean }
export interface InputPlan { sources: Source[]; normal: { node: number; port: number } | { value: number } | 'internal' | null;
  kind: 'sum' | 'cv' | 'trigger'; att: number; ratio: number; muted: boolean[] }
export interface PlanNode { id: string; type: string;            // a frame compiles to type "__clock"
  knobs: number[];                                                // visible knobs, knob positions 0…1, spec order
  fixed: number[];                                                // options (index) and hidden knobs (real units), spec order
  inputs: InputPlan[];                                            // inputPorts(spec) order: inputs, then mod jacks
  connectedOut: boolean[]; outMuted: boolean }
export type Step = { node: number } | { loop: number[] };
export interface ReadoutLayout { size: number; nodes: { knobs: number; trigs: number; outs: number; state: number; trace: number | null }[] }
export interface Plan { seq: number; nodes: PlanNode[]; steps: Step[]; layout: ReadoutLayout; fadeInMs: number }
export function compile(doc: Doc, specs: Specs, seq: number): Plan;
```
Rules: one node per module and one `__clock` per frame (input 0 CLK in with the frame's ratio; `fixed` = `[on, bpm]`;
output 0 CLK out); a nested frame's unpatched CLK in is normalled to its parent's `__clock`; normals: `own` → a late
self `normal` (with `when` evaluated now; a plan is re-sent when that option changes), `internal` → `'internal'`,
`value` → `{ value }`, all only while the input has no cables; `kind` trigger / cv (mod, pitch, mod jacks) / sum
(audio); Tarjan SCCs in topological order, single nodes without a self-edge are `{ node }`, the rest `{ loop }` in
document order with back edges `late`; `muted[i]` for sources inside a muted frame feeding outside it; `outMuted` for
an OUT in a muted frame; readout offsets disjoint, index 0 = seq; `state` 1 float; `trace` 4·256 floats for SCOPE.
Write `engine/tests/fixtures/plan-*.json` from these tests when `UPDATE_FIXTURES=1` (the Rust decoder test reads them).

- [ ] **Step 1: Failing tests** (inline specs): chain order; A→B→A one loop with one late edge; a self-patch is a loop
  with a late source; two cables → two sources; SLOPE-like own normal only with the option on and the input free;
  nested frame clock normal; muted marks; disjoint layout; a document left by `deleteObjects([frame])` compiles.
- [ ] **Step 2:** → FAIL. **Step 3:** Implement; `UPDATE_FIXTURES=1 pnpm test -- compile` writes the fixtures.
  **Step 4:** → PASS. **Step 5:** Commit `feat(core): compile documents into plans`.

### Task 8: Engine contract, inputs, master (Rust)

**Files:** `engine/src/{dsp.rs,inputs.rs,master.rs}` with `#[cfg(test)]` modules.

**Interfaces:**
```rust
pub const BLOCK: usize = 128;
pub struct Ctx { pub sample_rate: f64, pub rng: Rng /* mulberry32-compatible */, pub master: [[f32; BLOCK]; 2], pub dice: bool }
pub struct Io<'a> { pub inp: &'a [&'a [f32; BLOCK]], pub par: &'a [&'a [f32; BLOCK]], pub fixed: &'a [f64],
  pub out: &'a mut [[f32; BLOCK]], pub connected_in: &'a [bool], pub connected_out: &'a [bool] }  // inp excludes mod jacks (they feed par)
pub trait Dsp {
  fn process(&mut self, io: &mut Io, ctx: &mut Ctx, from: usize, to: usize);
  fn reset(&mut self);
  fn state(&self) -> f32 { 0.0 }                 // current index for STAGES / RHYTHM / SWITCH / SPREAD
  fn trace(&self) -> Option<&[f32]> { None }     // SCOPE: 4 × 256
}
pub struct EdgeDetector { … }  impl EdgeDetector { pub fn rise(&mut self, x: f32) -> bool }   // > 0.5 once, re-arm < 0.25
pub struct TriggerInput { pub ratio: i32, … }    // merge + ratio + 1 ms re-emit; pending ×N events capped at 8
impl TriggerInput { pub fn new(sample_rate: f64, max_sources: usize) -> Self; pub fn sample(&mut self, values: &[f32]) -> f32; pub fn count(&self) -> u32 }
pub struct Master { … } impl Master { pub fn new(sr: f64) -> Self; pub fn fade_in(&mut self, ms: f64); pub fn process(&mut self, l: &mut [f32; BLOCK], r: &mut [f32; BLOCK]) }
```
- [ ] **Tests:** 0→0.6→0.4→0.6 fires once; two sources on different samples fire twice, together once; ÷3 passes
  1, 4, 7; ×4 after two events 1000 samples apart adds 3 at 250-sample spacing; pulses last 1 ms at 48 k and 44.1 k;
  a 2 kHz square into ×8 for 2 s keeps the queue ≤ 8 and output finite (Review Focus 3); Master: DC 0.5 decays below
  0.01 within 0.5 s, 10 stays ≤ 1, NaN → finite, `fade_in(200)` ramps. FAIL → implement → PASS. Commit
  `feat(engine): DSP contract, inputs, master`.

### Task 9: Engine core (Rust)

**Files:** `engine/src/{plan.rs,clock.rs,engine.rs}`, `engine/tests/alloc.rs`.

**Interfaces:**
```rust
// plan.rs — serde Deserialize of Task 7's JSON (camelCase)
pub fn decode(json: &[u8]) -> Result<Plan, PlanError>;
// engine.rs
pub struct Engine { … }
impl Engine {
  pub fn new(sample_rate: f64, seed: u32) -> Self;
  pub fn apply(&mut self, plan: Plan) -> Result<(), PlanError>;   // unknown type → Err, previous plan kept
  pub fn knob(&mut self, node: usize, index: usize, value: f64);  pub fn att(&mut self, node: usize, input: usize, value: f64);
  pub fn ratio(&mut self, node: usize, input: usize, value: i32); pub fn mute(&mut self, clock_node: usize, on: bool);
  pub fn listen(&mut self, target: Option<(usize, usize)>);
  pub fn process(&mut self) -> (&[f32; BLOCK], &[f32; BLOCK]);
  pub fn readouts(&self) -> &[f32];
  pub fn take_dice(&mut self) -> Option<usize>;                  // node index of a DICE rise, one per call
}
```
Rules (spec §8): instances keyed by node id survive plan swaps; knobs glide 10 ms in knob space, then
`knob + att·modSum` clamped and mapped by `from_knob` into `par`; `{ node }` steps run the block, `{ loop }` steps run
per sample with late sources from a one-sample delay; a non-finite output zeroes that node's outputs and calls
`reset()`; OUT adds into `ctx.master`; listen replaces master L/R with the target (mono to both) before `Master`;
changed inputs crossfade 10 ms; removed nodes run 10 ms ramping out (re-adding the id keeps the instance); muted
sources and OUTs ramp 50 ms; `__clock` (clock.rs): CLK in rises after the ratio pass through, else the own clock
emits 1 ms triggers every 60/bpm s while on, else nothing; readouts written once per block. All buffers, queues and
instance storage are sized on `apply`; `process` allocates nothing.

- [ ] **Step 1: Failing tests** (test DSPs registered under test-only types: `dc`, `gain`, `boom` writing NaN,
  `out`, `counter`): a cable carries samples; two cables into an audio input sum; a mod jack at att 1 sweeps the
  range, att −1 inverts; a knob change glides ~10 ms; NaN → 0 and reset; listen replaces the output; a per-sample
  loop matches a hand computation; removal ramps over 10 ms ± 1 block; mute ramps over 50 ms; a 120 BPM frame clock
  rises every 0.5 s at 48 k and at 44.1 k; a nested frame at ratio −2 every 1 s; runaway feedback (`gain` 1.9 into
  itself) stays finite and ≤ 1 (Review Focus 1); readouts hold seq, knob position, trigger counts, held peaks;
  every `engine/tests/fixtures/plan-*.json` decodes. `tests/alloc.rs`: a counting `#[global_allocator]` shows zero
  allocations across 10 000 `process` calls after `apply`.
- [ ] **Step 2:** → FAIL. **Step 3:** Implement. **Step 4:** → PASS. **Step 5:** Commit `feat(engine): engine core`.

### Tasks 10–14: The 24 modules (Rust)

Each module is one file `engine/src/modules/<type>.rs`: `pub fn spec() -> ModuleSpec` (values from spec §7 and the
prototype's `SPECS`: labels, ranges, defaults, tapers, `randomRange`, `modDepth`, normals, size, display in lanes), a
DSP struct implementing `Dsp`, and `#[cfg(test)]` tests driving it through `process` with hand-built buffers;
registered in `registry.rs`; then `pnpm specs`. Normals the `Normal` type cannot express (A×B+C's `c2 ← out1 while
out1 is unpatched`, ATT's output cascade, OUT's `r ← l`) are done inside the DSP from `connected_in` /
`connected_out` and declared `Internal` for display. Trigger outputs are 1 ms. Behaviour:

| Type | DSP |
|---|---|
| osc | phase accumulator (f64); `f = freq·2^pitch·(1 + 4·fmi·fm)` (linear, through-zero); SIN / TRI / SAW / SQR (pw); polyBLEP on SAW and SQR; SYNC rise resets phase |
| complex | modulator at `freq·ratio` (SIN / TRI / SAW); carrier sine at `freq·2^pitch·(1 + 4·index·m)`, `m` = FM input, else the modulator; OUT = carrier through FOLD's folder at `fold = timbre`; MOD = modulator |
| noise | WHITE uniform ±1·level; PINK Paul Kellet ·level |
| uncertainty | TRIG rise (else every 1/rate s): STEPPED new ±1, QUANT = STEPPED on `levels` evenly spaced values; SMOOTH glides to a new random target every 1/rate s (one-pole, τ = 1/(2·rate)) |
| slope | TRIG rise → rise from the current value over RISE, EOR at the top, fall over FALL, EOC at 0; shape `s>0: x^(1+2s)`, `s<0: 1−(1−x)^(1−2s)`; CYCLE on, idle, TRIG unpatched → starts by itself; IN patched and idle → slews toward IN with RISE / FALL as rates |
| lpg | PING rise → vactrol env to 1 in 2 ms, then `×0.001^(1/(decay·sr))`; control `c` = CV (0…1) if patched, else the env if PING is patched, else 1 (a VCA on LEVEL); `g = level·c`; VCA `in·g`; LP one-pole at `20·1000^g` Hz; BOTH LP then `·g` |
| filter | TPT state-variable, `k = 2 − 1.96·res`; LP, BP, HP |
| fold | `y = sin(π/2·(g·x + sym))`, `g = 1 + 8·fold`, first-order ADAA, 2× oversampled |
| stages | 16 stages (hidden v1–16 V, t1–16 s, p1–16 pulse, g1–16 slide); ADV rise (or, unpatched, the stage time elapsing) → next within LEN, PULSE if on, EOC on wrap; RESET → next ADV plays stage 1; ADDR patched → `⌊clamp(addr,0,0.999)·LEN⌋`, a change counts as an advance; a slide glides 80 ms from the previous output; DICE rise → `ctx.dice = true`; `state()` = stage |
| rhythm | 16 steps (hidden g1–16: 0 off / 1 on / 2 tie; a1–16 accent); CLK rise advances within LEN; EUCLID hit `((i − rot) mod n · k) mod n < k`, GRID g; ON (or TIE after a rest) raises GATE to `now + interval/2` (`·1.05` if the next step is TIE) and fires ACC if accented; TIE after a sounding step only extends GATE; EOC on wrap; DICE rise → `ctx.dice`; `state()` = step |
| chance | TRIG rise → A with probability P (`ctx.rng`), else B |
| shift | measures the period; ALL delays every event by AMT·period, EVEN every second; ≤ 16 pending |
| compare | 1 while `in > thr`, 0 below `thr − 0.01` |
| follow | `|in|·gain` → one-pole up ATK, down REL → ENV (0…1); GATE while ENV > THR (hysteresis 0.02) |
| switch / spread | index: ADV → next (SEQ) or random (RAND) within LEN; RESET → 0; ADDR overrides; 5 ms crossfade; SWITCH OUT = selected IN; SPREAD selected OUT = IN; `state()` = index |
| sah | TRIG rise → hold IN (unpatched → internal white noise) |
| quant | `in·12 − root` → nearest SCALE degree (ties down) `+ root`, `/12` |
| mix | `a·la + b·lb + c·lc + d·ld` |
| att | `outN = inN·attN + ofsN` (inN unpatched → 1); an unpatched outN adds into out(N+1) |
| abc | `outN = aN·gaN·(bN·gbN) + cN + offsetN`, bN unpatched → 1; c2 and out1 unpatched → c2 = out1 |
| delay | 2 s buffer allocated in `new`, linear interpolation; write `in + wet·fb`; OUT `in·(1−mix) + wet·mix` |
| scope | THRU A/B = A/B; trace min/max of A·ga, B·gb per column over TIME into `trace()`; sweep restarts on a TRIG rise, else on A rising through 0, else free-running; XY writes pairs |
| out | adds `l·level`, `r·level` into `ctx.master`; R unpatched → R = L |

### Task 10: Sources — osc, complex, noise, uncertainty
- [ ] Tests: OSC SAW 440 Hz zero-crossing period equals 1/440 s ± 1 sample at 48 k and at 44.1 k (Review Focus 5);
  pitch +1 halves it; SQR 2 Hz ≥ 0.5 for half its period; SYNC restarts; COMPLEX index 0 is a pure sine, MOD at ratio
  2 has twice the carrier frequency, FM patched replaces the modulator; NOISE repeats with the seed, mean ≈ 0;
  UNCERTAINTY QUANT ≤ `levels` distinct values. Commit `feat(engine): sources`.

### Task 11: Shaping — slope, lpg, filter, fold
- [ ] Tests: SLOPE rise 0.01 s reaches 1 at 480 ± 1 samples with EOR; fall 0.1 s ends with EOC near 4800; CYCLE runs
  alone; a 2 kHz square into TRIG stays within 0…1; LPG ping env −60 dB at DECAY; LPG with nothing patched at LEVEL
  0.5 halves its input; FILTER LP 1 kHz attenuates 10 kHz ≥ 30 dB, passes 100 Hz within 1 dB, HP the reverse, res 1
  on noise finite for 2 s; FOLD fold 0 ≈ identity for |x| < 0.3, and a hard-folded 5 kHz sine has less aliased energy
  below 4 kHz than the same folder without oversampling. Commit `feat(engine): shaping`.

### Task 12: Sequencing — stages, rhythm
- [ ] Tests: STAGES advances on ADV, wraps at LEN with EOC, skips PULSE on a rest stage, slides over 80 ms,
  free-runs on stage times when ADV is unpatched, sets `ctx.dice` on a DICE rise; RHYTHM `x.x-..x.x.xx-.x.` gives 7
  GATE rises per pattern pass (the ties do not retrigger) and ACC on accented hits; a 2 kHz square into CLK stays
  finite (Review Focus 3). Commit `feat(engine): sequencing`.

### Task 13: Logic — chance, shift, compare, follow, switch, spread, sah, quant
- [ ] Tests: CHANCE P 0 / 1 / 0.5 (45–55 % over 10 000); SHIFT EVEN delays every second event by AMT·period; COMPARE
  does not chatter on a sine with 0.005 noise at the threshold; FOLLOW rises with a burst and falls over REL, GATE
  above THR; SWITCH SEQ cycles at LEN 3, ADDR overrides; SPREAD one output at a time; S&H holds, samples noise when
  IN is unpatched; QUANT major root 0 maps 1.08 st → 2 st. Commit `feat(engine): logic`.

### Task 14: Mix, FX, out — mix, att, abc, delay, scope, out
- [ ] Tests: MIX sums with levels; ATT with nothing patched gives offsets, an unpatched OUT1 adds into OUT2; A×B+C
  ring-modulates two sines, B unpatched passes A·gain + C, out1 cascades into c2; DELAY 0.1 s echoes at 0.1 s ± 1
  sample at 48 k and 44.1 k (Review Focus 5), feedback 0.5 halves the next echo; SCOPE THRU equals the input, trace
  holds min/max per column; OUT with only L writes both channels. Commit `feat(engine): mix, fx, out`.

### Task 15: The WASM boundary

**Files:** `engine/src/wasm.rs` (`#[cfg(target_arch = "wasm32")]`), `packages/protocol/src/{engine.ts,messages.ts,render.ts}`;
test `packages/protocol/src/engine.test.ts`.

**Interfaces:**
```rust
// raw C ABI exports; the engine lives in a Box behind a pointer; no wasm-bindgen
#[no_mangle] pub extern "C" fn engine_new(sample_rate: f64, seed: u32) -> *mut Engine;
#[no_mangle] pub extern "C" fn engine_alloc(len: usize) -> *mut u8;            // scratch for plan JSON, freed by apply
#[no_mangle] pub extern "C" fn engine_apply(e: *mut Engine, ptr: *mut u8, len: usize) -> i32;  // 0 ok, 1 decode error, 2 unknown type
#[no_mangle] pub extern "C" fn engine_knob(e: *mut Engine, node: u32, index: u32, value: f64);
//  … engine_att, engine_ratio (i32), engine_mute (u32 clock node, u32 on), engine_listen (i32 node, i32 port; −1 = off)
#[no_mangle] pub extern "C" fn engine_process(e: *mut Engine) -> *const f32;   // 256 floats: L block then R block
#[no_mangle] pub extern "C" fn engine_readouts(e: *mut Engine) -> *const f32;
#[no_mangle] pub extern "C" fn engine_readouts_len(e: *mut Engine) -> u32;
#[no_mangle] pub extern "C" fn engine_take_dice(e: *mut Engine) -> i32;        // node or −1
```
```ts
export interface WasmEngine {
  apply(plan: Plan): 0 | 1 | 2;
  knob(node: number, index: number, value: number): void; att(node: number, input: number, value: number): void;
  ratio(node: number, input: number, value: number): void; mute(clockNode: number, on: boolean): void;
  listen(target: { node: number; port: number } | null): void;
  process(): { l: Float32Array; r: Float32Array };   // views into WASM memory, valid until the next call
  readouts(): Float32Array; takeDice(): number | null;
}
export function loadEngine(module: WebAssembly.Module, sampleRate: number, seed: number): WasmEngine;   // synchronous instantiate
export function renderDoc(doc: Doc, specs: Specs, seconds: number, sampleRate?: number): { l: Float32Array; r: Float32Array };  // render.ts, Node
```
- [ ] **Step 1: Failing tests** (Node, loading `engine/pkg/sreda_engine.wasm` built by `pnpm wasm`): a doc with OSC →
  OUT renders a 110 Hz saw; a knob message changes the pitch; `apply` of truncated JSON returns 1 and of an unknown
  type 2, and the previous plan keeps sounding (Review Focus 4); `takeDice` reports a STAGES DICE rise.
- [ ] **Step 2:** → FAIL. **Step 3:** Implement. **Step 4:** `pnpm check` → PASS. **Step 5:** Commit `feat: WASM engine boundary`.

### Task 16: Generators, factory patches, end-to-end renders

**Files:** `packages/core/src/{generators.ts,factory.ts}`, tests `generators.test.ts`, `factory.test.ts`,
`packages/core/src/specs.test.ts`, `engine/tests/realtime.rs`, `scripts/render.ts`.

**Interfaces:**
```ts
export const SCALES: number[][];   // CHR MAJ MIN DOR PHR PMIN PMAJ WHL
export function euclid(n: number, k: number, rot: number): boolean[];
export function genNotes(algo: '303' | 'MOTIF' | 'WALK' | 'TURING' | 'ARP' | 'PHRASE' | 'PEDAL', n: number, mask: number[], root: number, rng: () => number): number[];
export function diceStages(doc: Doc, specs: Specs, id: string, rng: () => number): Doc;
export function diceRhythm(doc: Doc, specs: Specs, id: string, rng: () => number): Doc;
export interface FactoryEntry { kind: 'project' | 'group'; path: string; build(specs: Specs): Doc }   // 'FACTORY/acid'
export const FACTORY: readonly FactoryEntry[];
```
Port the prototype's generators, `SEEDS` (pulse, drone, self-clocked, polymeter, acid, ratchet) and `FACTORY_GROUPS`
(303 voice, complex vco, bleep-bloop, vca-lpg) with `buildWith`; frames are `route` and packed innermost first.

- [ ] **Step 1: Failing tests:**
  - `euclid(16,5,0)` = `x...x..x..x..x..`; every algorithm gives 16 notes in 0…24 in the scale; `diceRhythm` ties
    always follow a note;
  - specs: every spec's `layoutPanel(spec).fits`; port and param ids unique;
  - factory: every entry validates unchanged, has no overlapping modules and no frame covering an outside module;
    every project rendered through the WASM engine for 3 s has RMS > 0.01 and peak ≤ 1; Polymeter's VOICE A / VOICE B
    clocks tick ÷3 and ×2 of POLY (readout trigger counts); ACID's RHYTHM fires 7 GATE rises per pattern pass;
  - Rust `realtime.rs`: a plan with every module type runs a minute of audio in under 0.3 of real time natively;
    `alloc.rs` (Task 9) extended to that plan stays at zero allocations; every module gives identical output per
    block and per sample.
- [ ] **Step 2:** → FAIL. **Step 3:** Implement. **Step 4:** `pnpm check` → PASS; `pnpm render acid 8` writes
  `acid.wav` (8 s, 48 kHz stereo) — listen to it.
- [ ] **Step 5:** Commit `feat: generators, factory patches, end-to-end renders`.
