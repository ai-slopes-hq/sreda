# SREDA 2 · Plan 1 — Sound first: the audio path, then a playable canvas with OSC → OUT

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An Electron app that makes sound as early as possible — a test tone through the whole Rust → WASM →
AudioWorklet path after Task 2 — and ends with a canvas where OSC and OUT are patched, played and edited by hand,
on the engine every later module plugs into.

**Architecture:** pnpm workspace (`packages/core`, `protocol`, `ui`, `app`) plus a Cargo crate `engine/`. Each
module's spec lives next to its DSP in Rust and is exported to `packages/core/src/generated/specs.json`. TypeScript
compiles the document into a plan (JSON); the WASM engine (raw C-ABI exports, no wasm-bindgen: the worklet has no
TextDecoder) plays it inside an AudioWorklet; readouts come back through a SharedArrayBuffer. The canvas draws every
module with one panel-layout function, so a new module needs only its Rust file to appear in the app.

**Tech Stack:** TypeScript ~6.0.3, pnpm@12.8.1, Node ≥ 22, Vitest ^5.0.3, ESLint ^10.11.0 + typescript-eslint
^8.71.0, Prettier ^3.9.9, tsx; Electron, electron-vite, SolidJS + vite-plugin-solid, Playwright (`_electron`),
`@solidjs/testing-library` + happy-dom — latest stable at scaffold time, pinned exactly in `package.json`; Rust
stable with the `wasm32-unknown-unknown` target, `serde` + `serde_json` (plan decoding and spec export only, never
inside `process`).

**Spec:** `docs/superpowers/specs/2026-10-07-canvas-ux-design.md` (revision 14). The prototype
`docs/prototype/Main.dc.html` holds plain-JS versions of the panel layout (`lay`, `jackStyle`, `cellVals`,
`modVals`), the option glyphs (`glyph`), knob arcs (`arc`, `ang`), cable curves (`bez`), the picker ranking and the
module specs (`SPECS`, `SIZES`): port them, do not re-derive them. Its `Sim` is not a DSP reference.

**Plans.** This is Plan 1 — stages A (sound) and B (a playable canvas). **Plan 2** adds the other 22 modules one
task at a time, each ending with "open the app and listen", in this order: SCOPE; LPG, SLOPE, NOISE (→ *Pulse*);
FILTER, MIX; RHYTHM, STAGES, QUANT with the generators and DICE (→ *Acid*); FOLD, COMPLEX, DELAY (→ *Drone*);
UNCERTAINTY, S&H, CHANCE, SHIFT, COMPARE, FOLLOW, SWITCH, SPREAD, ATT, A×B+C. **Plan 3** — frames (G, FIX / STACK,
own clock, MUTE), the sidebar and WIRES, the library folder, the group / project pickers, the factory patches, the
remaining gestures (magnets, replace, insert, wire hover, cable focus, ⌘D, R), the real-time benchmark. Each is
written when the previous one lands.

## Global Constraints

- Package boundaries: `core ← protocol`, `core ← ui`, `protocol ← ui`, `ui ← app`; ESLint enforces them. Rust never
  depends on TS; TS reads Rust only through `specs.json` and the WASM exports. The UI never touches engine internals.
- Audio thread: nothing inside `Engine::process` or a `Dsp::process` allocates, locks, logs or panics on valid input;
  buffers are allocated on construction or in `apply`. Enforced by `engine/tests/alloc.rs` (a counting global
  allocator). The worklet's `process` allocates nothing either (no closures, no array literals, no spread).
- Sample rate: the device's (the `AudioContext` default); every DSP works at any rate (tests use 48 000 and 44 100);
  `BLOCK = 128`.
- Roles: `audio` nominal ±1; `mod` ±1 or 0…1 per output; `pitch` octaves (+1.0 = one octave up); `trigger` fires on
  a rising edge above 0.5, re-arms below 0.25; trigger outputs 0/1, triggers 1 ms, gates as long as they last.
- Stacking: audio / mod / pitch inputs sum their cables; trigger inputs merge (each source edge-detected on its own).
- Attenuverter (−1…+1) on mod and pitch inputs and every knob mod jack, after the sum; default 1, mod-jack default =
  the param's `modDepth` (0.25 for frequency-type knobs). Audio inputs have none.
- Ratio on every trigger input, signed integer: −16…−2 = ÷N, 1 = unity, 2…8 = ×N, after the merge. ÷N passes the
  1st of every N; ×N adds N−1 evenly spaced events over the last incoming interval (nothing extra until two events).
- Knob modulation: ±1 at attenuverter 1 sweeps the whole knob range in knob space (taper included); knob changes
  glide 10 ms in knob space.
- Sound: f32 buffers, f64 state; polyBLEP on OSC SAW / SQR; a 1e-20 offset in filter and feedback state.
- Master: 5 Hz DC blocker, soft limiter (identity to |x| 0.9, `sign·(0.9 + 0.1·tanh((|x|−0.9)/0.1))` above), nothing
  non-finite reaches the output; the listen path goes through it too; several OUT modules sum before it.
- Fades: removed nodes and re-routed inputs 10 ms.
- Panel grammar (spec §2): header 32 px, 6 px inset, lanes 32 px (1U = 3, 2U = 7, 3U = 11), 10 px foot → heights
  144 / 272 / 400; HP = 56; IN column 1 HP | control area N − 2 HP | OUT column 1 HP, side columns #171715; one jack
  per lane in spec order; control area = display (whole lanes) → knob rows (2 lanes each) → mode strip (bottom
  lane; options from the left, actions from the right; 1 HP per button, 2 HP for a `▾` list with words); knobs
  56 × 40, jacks 11 px; port labels on the upper line of their lane, ≤ 5 characters; labels 9 px #6f6a5f.
- Quiet panels: knob values show while the module is hovered, selected alone or edited, and always on a modulated
  knob (in the mod colour); input values (att, ratio) only when not default or while hovered / edited.
- Colours: audio #e9e4d8, mod #6cb4ee, pitch #9ad18b, trigger #f5a524; canvas #121210, panel #1b1b18.
- Sizes: OSC 5×1, OUT 3×1. Canvas grid 8 px. Names: English; same-type modules numbered (`OSC 1`, `OSC 2`).

## Review Focus

1. A runaway feedback patch (a module's output into its own input at a gain of 1.9) stays finite and within ±1 at
   the output (test in Task 5).
2. A broken or future document — unknown type, cable to a missing port or module, `version: 2` — is rejected by
   `validateDoc`, never half-loaded; a corrupt autosave is kept under a backup key, the starter patch opens and a
   notice says so (tests in Task 4 and Task 6).
3. An audio-rate signal in a trigger input — a 2 kHz square into a ×8 input for 2 s — keeps the pending queue ≤ 8
   and the output finite (test in Task 5).
4. A plan the engine cannot decode (truncated JSON, unknown module type) is refused with an error code and the
   previous plan keeps playing (test in Task 5).
5. 44.1 kHz instead of 48 kHz keeps tuning right: OSC at 440 Hz has the same period in seconds at both (Task 3), and
   the test tone in Node measures 220 Hz at both (Task 2).

---

## File structure

```
package.json · pnpm-workspace.yaml · tsconfig.base.json · eslint.config.js · .prettierrc.json · .gitignore
vitest.config.ts · playwright.config.ts · rust-toolchain.toml · Cargo.toml (workspace)
packages/core/src/      spec.ts · generated/specs.json · doc.ts · ops.ts · names.ts · history.ts · plan.ts ·
                        compile.ts · panel.ts · index.ts
packages/protocol/src/  engine.ts (loadEngine) · messages.ts · readouts.ts · render.ts (Node)
packages/ui/src/        App.tsx · store.ts · autosave.ts · audio/{host.ts,worklet.ts} · live.ts (rAF readouts) ·
                        canvas/{Canvas.tsx,Panel.tsx,Knob.tsx,Option.tsx,Jack.tsx,Cables.tsx,Picker.tsx,glyphs.ts}
packages/app/           electron.vite.config.ts · src/main/index.ts · src/preload/index.ts · src/renderer/{index.html,main.tsx}
e2e/                    app.spec.ts
engine/                 Cargo.toml (crate sreda-engine: rlib + cdylib; bin export-specs)
  src/                  lib.rs · dsp.rs · master.rs · spec.rs · registry.rs · inputs.rs · plan.rs · engine.rs · wasm.rs
  src/modules/          osc.rs · out.rs          one file per module: spec() + DSP + unit tests
  src/bin/export_specs.rs
  tests/                alloc.rs · specs_json.rs · fixtures/
```

---

## Stage A — sound

### Task 1: Workspace and an empty window

**Files:** root configs above; `rust-toolchain.toml` (`channel = "stable"`, `targets = ["wasm32-unknown-unknown"]`);
`engine/Cargo.toml`, `engine/src/lib.rs`; `packages/{core,protocol,ui}/{package.json,tsconfig.json,src/index.ts}`;
`packages/app/**`; `e2e/app.spec.ts`; modify `CLAUDE.md`.

**Interfaces:**
- Root scripts: `dev` (`pnpm wasm && electron-vite dev -c packages/app/electron.vite.config.ts`), `test` (vitest
  run), `typecheck`, `lint` (eslint + `cargo clippy -- -D warnings`), `test:rust` (`cargo test`), `wasm` (`cargo build
  -p sreda-engine --release --target wasm32-unknown-unknown`, copy to `engine/pkg/sreda_engine.wasm`), `specs`
  (`cargo run -p sreda-engine --bin export-specs > packages/core/src/generated/specs.json`), `build` (electron-vite
  build), `e2e` (`pnpm build && playwright test`), `check` (typecheck && lint && test:rust && wasm && test), `format`.
- Main process: one `BrowserWindow` 1440 × 900, title `SREDA`, background #121210, `contextIsolation: true`,
  `sandbox: true`; every response gets `Cross-Origin-Opener-Policy: same-origin` and
  `Cross-Origin-Embedder-Policy: require-corp` (`session.webRequest.onHeadersReceived`, and the dev server's
  headers), so `crossOriginIsolated` is true.
- Renderer: Solid mounts `App` from `packages/ui`, which for now renders the canvas background only.

- [ ] **Step 1: Failing tests:** `packages/core/src/smoke.test.ts` `expect(1 + 1).toBe(2)`; one `#[test]` in
  `engine/src/lib.rs`; `e2e/app.spec.ts` launches the built app with `_electron.launch`, and expects the window title
  `SREDA` and `await page.evaluate(() => crossOriginIsolated)` to be `true`.
- [ ] **Step 2:** Implement the scaffold. TS tooling mirrors `../sreda` (tsconfig flags, Prettier, ESLint `forbid`
  helper for the boundaries); Cargo release profile `opt-level = 3`, `lto = true`, `panic = "abort"`.
- [ ] **Step 3:** `pnpm check` and `pnpm e2e` → green; `pnpm dev` opens the window.
- [ ] **Step 4:** `CLAUDE.md`: replace the "no code yet" lines with the commands (`pnpm dev`, `pnpm check`, `pnpm
  test -- <path>`, `cargo test -p sreda-engine <name>`, `pnpm specs` after changing a module spec, `pnpm e2e`);
  rewrite the audio-thread section for Rust (no allocation / locks / logging / panics in `process`, checked by
  `engine/tests/alloc.rs`) and keep its V8 rules for the worklet glue; update the package boundaries; point to
  `docs/prototype/`.
- [ ] **Step 5:** Commit `chore: scaffold workspace, Rust engine crate and Electron app`.

### Task 2: The audio path — a test tone through WASM and the AudioWorklet

**Files:** `engine/src/{dsp.rs,master.rs,engine.rs,wasm.rs}`, `engine/tests/alloc.rs`;
`packages/protocol/src/{engine.ts,messages.ts}` + `engine.test.ts`; `packages/ui/src/audio/{host.ts,worklet.ts}`; `App.tsx`.

**Interfaces:**
```rust
// dsp.rs
pub const BLOCK: usize = 128;
// master.rs
pub struct Master { … }
impl Master { pub fn new(sample_rate: f64) -> Self; pub fn fade_in(&mut self, ms: f64);
  pub fn process(&mut self, l: &mut [f32; BLOCK], r: &mut [f32; BLOCK]) }      // DC blocker → limiter → NaN guard
// engine.rs — the tone is temporary: Task 5 replaces it with plan playback
pub struct Engine { … }
impl Engine { pub fn new(sample_rate: f64, seed: u32) -> Self; pub fn set_tone(&mut self, hz: f64);   // 0 = off
  pub fn process(&mut self) -> (&[f32; BLOCK], &[f32; BLOCK]) }               // sine at 0.2, through Master
// wasm.rs (#[cfg(target_arch = "wasm32")]), raw C ABI; the engine is a Box behind a pointer
#[no_mangle] pub extern "C" fn engine_new(sample_rate: f64, seed: u32) -> *mut Engine;
#[no_mangle] pub extern "C" fn engine_set_tone(e: *mut Engine, hz: f64);
#[no_mangle] pub extern "C" fn engine_process(e: *mut Engine) -> *const f32;   // 256 floats: L block then R block
```
```ts
// protocol/engine.ts — synchronous instantiate (works in Node and in the worklet)
export interface WasmEngine { setTone(hz: number): void; process(): { l: Float32Array; r: Float32Array } }  // views valid until the next call
export function loadEngine(module: WebAssembly.Module, sampleRate: number, seed: number): WasmEngine;
// protocol/messages.ts — for now only the tone; Task 5 replaces it with the real message set
export type ToEngine = { t: 'tone'; hz: number };
// ui/audio/host.ts
export class AudioHost { static start(): Promise<AudioHost>;   // AudioContext (default rate, latencyHint 'interactive'),
                                                                // fetch + compile the .wasm, addModule(worklet), node → destination
  readonly sampleRate: number; post(msg: ToEngine): void }
```
The worklet (`registerProcessor('sreda', …)`) receives the compiled `WebAssembly.Module` in `processorOptions`,
calls `loadEngine`, and in `process` copies the engine's L / R into `outputs[0]`; messages arrive on `port`. Vite
loads it with `?worker&url` and the `.wasm` with `?url`.

- [ ] **Step 1: Failing tests:**
  - Rust `master.rs`: DC 0.5 decays below 0.01 within 0.5 s; an input of 10 stays ≤ 1; NaN in → finite out;
    `fade_in(200)` ramps from 0 to full over 200 ms ± 1 block.
  - Rust `engine.rs`: `set_tone(220.0)` at 48 000 and at 44 100 — the zero-crossing period is 1/220 s ± 1 sample
    (Review Focus 5); `set_tone(0.0)` gives silence.
  - `tests/alloc.rs`: a counting `#[global_allocator]`; 10 000 `process` calls after `new` and `set_tone` allocate 0.
  - `protocol/engine.test.ts` (Node, `engine/pkg/sreda_engine.wasm` built by `pnpm wasm`): `loadEngine(…, 48000, 1)`,
    `setTone(220)`, 100 blocks → the same period as the Rust test; the peak ≈ 0.2.
- [ ] **Step 2:** → FAIL. **Step 3:** Implement the Rust side, `loadEngine`, `AudioHost` and the worklet. The app
  shows one centred line `CLICK TO START AUDIO` (spec §6); the first click anywhere starts `AudioHost` and sends
  `{ t: 'tone', hz: 220 }`; the line then reads `TEST TONE 220 HZ · CLICK TO STOP`. (The tone message and this
  line go away in Task 6.)
- [ ] **Step 4:** `pnpm check` → PASS. **Checkpoint for the user:** `pnpm dev`, click, hear 220 Hz.
- [ ] **Step 5:** Commit `feat: audio path — Rust engine in WASM in an AudioWorklet, test tone`.

---

## Stage B — a playable canvas

### Task 3: Module specs in Rust, OSC and OUT

**Files:** `engine/src/{spec.rs,registry.rs}`, `engine/src/modules/{mod.rs,osc.rs,out.rs}`,
`engine/src/bin/export_specs.rs`, `engine/tests/specs_json.rs`, `dsp.rs` (add the contract);
`packages/core/src/{spec.ts,generated/specs.json}` + `spec.test.ts`.

**Interfaces:**
```rust
// spec.rs — serde Serialize, camelCase; the JSON is the TS ModuleSpec
pub enum Role { Audio, Mod, Pitch, Trigger }
pub struct Port { pub id: &'static str, pub label: &'static str, pub role: Role }
pub enum Param {                                    // tagged by "kind": "knob" | "option" | "action"
  Knob { id, label, min: f64, max: f64, def: f64, taper: Taper /* lin | exp */, step: Option<f64>, unit: Option<Unit>,
         random_range: Option<(f64, f64)>, mod_depth: Option<f64>, hidden: bool, glyph: Option<&'static str> },
  Option { id, label, options: &'static [&'static str], def: u32, glyph: Option<&'static str>, hidden: bool },
  Action { id, label } }
pub enum Normal { Own { input, own, when: Option<(&'static str, u32)> }, Internal { input, internal }, Value { input, value: f64 } }
pub struct ModuleSpec { pub type_: &'static str /* "type" */, pub label, pub desc, pub size: (u8, u8),
  pub inputs: Vec<Port>, pub outputs: Vec<Port>, pub params: Vec<Param>, pub normals: Vec<Normal>,
  pub display: Option<Display /* { lanes, kind } */> }
pub fn from_knob(p: &Param, k: f64) -> f64;  pub fn to_knob(p: &Param, v: f64) -> f64;
// dsp.rs — the module contract
pub struct Ctx { pub sample_rate: f64, pub rng: Rng /* mulberry32-compatible */, pub master: [[f32; BLOCK]; 2] }
pub struct Io<'a> { pub inp: &'a [&'a [f32; BLOCK]], pub par: &'a [&'a [f32; BLOCK]],  // par: knob values in real units
  pub fixed: &'a [f64], pub out: &'a mut [[f32; BLOCK]], pub connected_in: &'a [bool], pub connected_out: &'a [bool] }
pub trait Dsp { fn process(&mut self, io: &mut Io, ctx: &mut Ctx, from: usize, to: usize); fn reset(&mut self) }
// registry.rs
pub fn specs() -> Vec<ModuleSpec>;  pub fn create(type_: &str, sample_rate: f64) -> Option<Box<dyn Dsp>>;
```
```ts
// spec.ts — the same shapes as TS types (Role, Port, KnobParam, OptionParam, ActionParam, Param, Normal, ModuleSpec, Specs)
export const SPECS: Specs;                                    // from generated/specs.json, keyed by type
export function toKnob(p: KnobParam, value: number): number;  // exp taper: log space
export function fromKnob(p: KnobParam, knob: number): number; // clamped, snapped to step
export function inputPorts(spec: ModuleSpec): Port[];         // inputs + a role-'mod' '@<param>' port per visible knob
```
OSC and OUT take their ports, params, ranges, `randomRange`, `modDepth` and sizes from the prototype's `SPECS.osc`
/ `SPECS.out` (OSC: PTCH pitch, FM audio, SYNC trigger → OUT audio; FREQ 0.1…20 000 Hz exp, default 110, random
40…880, modDepth 0.25; WAVE SIN / TRI / SAW / SQR with glyph `wave`; PW 0.05…0.95; FM 0…1. OUT: L, R audio; LVL
0…1, default 0.7; normal `r ← L` declared `Internal`). DSP: OSC phase accumulator (f64), `f = freq·2^pitch·(1 +
4·fmi·fm)` (linear, through-zero), polyBLEP on SAW and SQR, SYNC rise resets phase; OUT adds `l·level`, `r·level`
into `ctx.master`, R unpatched → R = L.

- [ ] **Step 1: Failing tests:** exp taper 20…20 000 maps 0.5 to √(20·20 000) ± 1e-6 (Rust and TS); step 1 over
  1…16 maps 0.52 to 9; `inputPorts` skips hidden knobs; `tests/specs_json.rs`: the export equals the checked-in
  `specs.json` byte for byte; OSC SAW 440 Hz zero-crossing period 1/440 s ± 1 sample at 48 000 and 44 100 (Review
  Focus 5); pitch +1 halves the period; SQR at pw 0.5 is ≥ 0 for half its period; SYNC restarts the phase; OUT with
  only L patched writes the same into both master channels at LVL.
- [ ] **Step 2:** → FAIL. **Step 3:** Implement; `pnpm specs`. **Step 4:** `pnpm check` → PASS.
- [ ] **Step 5:** Commit `feat: module specs in Rust exported to TS; OSC and OUT`.

### Task 4: Document, edits, undo, compile (TS)

**Files:** `packages/core/src/{doc.ts,ops.ts,names.ts,history.ts,plan.ts,compile.ts}`,
`packages/protocol/src/readouts.ts`; tests `doc.test.ts`, `ops.test.ts`, `history.test.ts`, `compile.test.ts`.

**Interfaces:**
```ts
export interface ModuleDoc { id: string; type: string; x: number; y: number; parent: string | null;
  params: Record<string, number>; atts: Record<string, number>; ratios: Record<string, number> }  // knob 0…1 | option index
export interface Cable { from: [string, string]; to: [string, string] }
export interface Doc { version: 1; modules: ModuleDoc[]; cables: Cable[]; groups: []; nextId: number }  // groups: Plan 3
export const emptyDoc: Doc;
export function starterDoc(specs: Specs): Doc;   // OSC (SAW, 110 Hz) → OUT L; first launch until Plan 3 brings Pulse
export function validateDoc(json: unknown, specs: Specs): Doc | null;
// ops.ts — pure, return a new Doc; RuleError for structural errors only; positions snap to 8
export class RuleError extends Error {}
export function addModule(doc: Doc, specs: Specs, type: string, x: number, y: number): { doc: Doc; id: string };
export function moveObjects(doc: Doc, ids: readonly string[], dx: number, dy: number): Doc;
export function connect(doc: Doc, specs: Specs, from: [string, string], to: [string, string]): Doc;  // either order; stacking; identical cable ignored
export function removeCable(doc: Doc, cable: Cable): Doc;
export function deleteObjects(doc: Doc, ids: readonly string[]): Doc;     // modules and their cables
export function setParam(doc: Doc, specs: Specs, id: string, param: string, value: number): Doc;
export function setAtt(doc: Doc, id: string, port: string, v: number | null): Doc;   // null = default
export function setRatio(doc: Doc, id: string, port: string, r: number): Doc;
export function nameOf(doc: Doc, specs: Specs, id: string): string;       // 'OSC 2' when several
// history.ts
export type Merge = { key: string; stroke?: boolean } | undefined;
export class History { constructor(initial: Doc, now?: () => number); readonly current: Doc;
  commit(doc: Doc, merge?: Merge): void; replace(doc: Doc): void; undo(): Doc | null; redo(): Doc | null }
// plan.ts — the JSON the Rust engine decodes in Task 5; field names exactly as here
export interface Source { node: number; port: number; late: boolean }
export interface InputPlan { sources: Source[]; normal: { node: number; port: number } | { value: number } | 'internal' | null;
  kind: 'sum' | 'cv' | 'trigger'; att: number; ratio: number }
export interface PlanNode { id: string; type: string; knobs: number[];      // visible knobs, positions 0…1, spec order
  fixed: number[];                                                          // options (index) and hidden knobs (real units)
  inputs: InputPlan[];                                                      // inputPorts(spec) order
  connectedOut: boolean[] }
export type Step = { node: number } | { loop: number[] };
export interface ReadoutLayout { size: number; nodes: { knobs: number; trigs: number; outs: number }[] }
export interface Plan { seq: number; nodes: PlanNode[]; steps: Step[]; layout: ReadoutLayout }
export function compile(doc: Doc, specs: Specs, seq: number): Plan;
export const READOUT_CAPACITY = 262_144;        // floats in the SharedArrayBuffer; compile throws above it
```
Compile rules: one node per module in document order; normals only while the input has no cables (`own` → a late
self `normal`, with `when` evaluated now; `internal` → `'internal'`; `value` → `{ value }`); `kind` trigger / cv
(mod, pitch, mod jacks) / sum (audio); Tarjan SCCs in topological order, a single node without a self-edge is
`{ node }`, the rest `{ loop }` in document order with back edges `late`; readout offsets disjoint, index 0 = seq,
per node: knob positions after modulation, trigger-input counts, output peaks. Write
`engine/tests/fixtures/plan-*.json` from these tests when `UPDATE_FIXTURES=1`.

- [ ] **Step 1: Failing tests:**
  - `validateDoc` → null for `version: 2`, an unknown type, a cable to a missing port, a cable to a missing module
    (Review Focus 2); fills missing params with defaults; keeps atts and ratios.
  - ops: ids never reused; positions snap to 8; two cables into one input both kept, an identical third ignored;
    output → output throws `RuleError`; a self-patch is allowed; `deleteObjects` removes touching cables; `nameOf`
    numbers two OSCs.
  - history (injected clock): the same key 300 ms apart merges, 800 ms apart does not; `stroke` merges until another
    key; commit after undo clears redo; `replace` adds no step.
  - compile (inline specs): chain order; A→B→A is one loop with one late edge; a self-patch is a loop with a late
    source; two cables → two sources; an own normal only with its option on and the input free; disjoint layout.
- [ ] **Step 2:** → FAIL. **Step 3:** Implement; `UPDATE_FIXTURES=1 pnpm test -- compile`. **Step 4:** → PASS.
- [ ] **Step 5:** Commit `feat(core): document, edits, undo and compile`.

### Task 5: The engine plays plans

**Files:** `engine/src/{inputs.rs,plan.rs,engine.rs,wasm.rs}`, `engine/tests/alloc.rs`;
`packages/protocol/src/{engine.ts,messages.ts,render.ts}` + `engine.test.ts`.

**Interfaces:**
```rust
// inputs.rs
pub struct EdgeDetector { … }  impl EdgeDetector { pub fn rise(&mut self, x: f32) -> bool }   // > 0.5 once, re-arm < 0.25
pub struct TriggerInput { … }  // merge + ratio + 1 ms re-emit; pending ×N events capped at 8
impl TriggerInput { pub fn new(sample_rate: f64, max_sources: usize) -> Self; pub fn set_ratio(&mut self, r: i32);
  pub fn sample(&mut self, values: &[f32]) -> f32; pub fn count(&self) -> u32 }
// plan.rs
pub fn decode(json: &[u8]) -> Result<Plan, PlanError>;          // serde of Task 4's JSON
// engine.rs — the tone is gone
impl Engine {
  pub fn new(sample_rate: f64, seed: u32) -> Self;
  pub fn apply(&mut self, plan: Plan) -> Result<(), PlanError>;   // unknown type → Err, previous plan kept
  pub fn knob(&mut self, node: usize, index: usize, value: f64);  pub fn att(&mut self, node: usize, input: usize, value: f64);
  pub fn ratio(&mut self, node: usize, input: usize, value: i32); pub fn listen(&mut self, target: Option<(usize, usize)>);
  pub fn process(&mut self) -> (&[f32; BLOCK], &[f32; BLOCK]);    pub fn readouts(&self) -> &[f32];
}
// wasm.rs: engine_new, engine_alloc(len) -> *mut u8 (scratch for the plan JSON, freed by apply),
// engine_apply(e, ptr, len) -> i32 (0 ok, 1 decode error, 2 unknown type), engine_knob, engine_att, engine_ratio (i32),
// engine_listen(e, node: i32, port: i32; −1 = off), engine_process, engine_readouts, engine_readouts_len
```
```ts
// messages.ts
export type ToEngine = { t: 'plan'; plan: Plan } | { t: 'knob'; node: number; index: number; value: number }
  | { t: 'att'; node: number; input: number; value: number } | { t: 'ratio'; node: number; input: number; value: number }
  | { t: 'listen'; target: { node: number; port: number } | null };
export type FromEngine = { t: 'applied'; seq: number; code: 0 | 1 | 2 };
// engine.ts — WasmEngine grows: apply(plan): 0 | 1 | 2; knob; att; ratio; listen; process; readouts(): Float32Array
export function renderDoc(doc: Doc, specs: Specs, seconds: number, sampleRate?: number): { l: Float32Array; r: Float32Array };  // render.ts, Node
```
Engine rules (spec §8): instances keyed by node id survive plan swaps; knobs glide 10 ms in knob space, then `knob
+ att·modSum`, clamped, mapped by `from_knob` into `par`; `{ node }` steps run the block, `{ loop }` steps run per
sample with late sources read one sample late; a non-finite output zeroes that node's outputs and calls `reset()`;
OUT adds into `ctx.master`; listen replaces master L / R with the target (mono to both) before `Master`; a changed
input crossfades 10 ms; a removed node runs 10 ms ramping out (re-adding the id keeps the instance); readouts are
written once per block. All buffers, queues and instance storage are sized in `apply`.

- [ ] **Step 1: Failing tests:**
  - `inputs.rs`: 0 → 0.6 → 0.4 → 0.6 fires once; two sources on different samples fire twice, together once; ÷3
    passes 1, 4, 7; ×4 after two events 1000 samples apart adds 3 at 250-sample spacing; pulses last 1 ms at 48 k
    and 44.1 k; a 2 kHz square into ×8 for 2 s keeps the queue ≤ 8 and the output finite (Review Focus 3).
  - `engine.rs` with test-only DSPs (`dc`, `gain`, `boom` writing NaN) registered under `#[cfg(test)]`: a cable
    carries samples; two cables into an audio input sum; a mod jack at att 1 sweeps the knob range, att −1 inverts;
    a knob change glides ~10 ms; NaN → 0 and reset; listen replaces the output; a per-sample loop matches a hand
    computation; removal ramps over 10 ms ± 1 block; `gain` 1.9 into itself stays finite and ≤ 1 (Review Focus 1);
    readouts hold seq, knob position and held output peaks; every `tests/fixtures/plan-*.json` decodes.
  - `tests/alloc.rs`: zero allocations across 10 000 `process` calls after `apply` of an OSC → OUT plan.
  - `protocol/engine.test.ts` (Node, WASM): `renderDoc(starterDoc)` is a 110 Hz saw; a knob message changes the
    pitch; `apply` of truncated JSON returns 1 and of an unknown type 2, and the previous plan keeps sounding
    (Review Focus 4).
- [ ] **Step 2:** → FAIL. **Step 3:** Implement; remove the tone (`set_tone`, `engine_set_tone`, the `tone`
  message). **Step 4:** `pnpm check` → PASS.
- [ ] **Step 5:** Commit `feat: the engine plays plans — inputs, cycles, glides, listen, readouts`.

### Task 6: The canvas shows and plays the patch

**Files:** `packages/core/src/panel.ts` + `panel.test.ts`; `packages/ui/src/{App.tsx,store.ts,autosave.ts,live.ts}`,
`audio/{host.ts,worklet.ts}`, `canvas/{Canvas.tsx,Panel.tsx,Knob.tsx,Option.tsx,Jack.tsx,Cables.tsx,glyphs.ts}`;
`packages/ui/src/canvas/Panel.test.tsx`; `e2e/app.spec.ts`.

**Interfaces:**
```ts
// core/panel.ts — port the prototype's lay(); positions relative to the module's top-left
export const HEAD = 32, INSET = 6, TOP = 38, LANE = 32, FOOT = 10, LANES = { 1: 3, 2: 7, 3: 11 } as const, HP = 56;
export interface PanelLayout { w: number; h: number; lanes: number;
  jacks: Record<string, { x: number; y: number }>;   // ins x 13, outs x w − 13, y 54 + 32·i; mod jacks at a knob cell + (7, 7)
  cells: Record<string, { x: number; y: number; w: number; mode: boolean }>;
  display: { x: number; y: number; w: number; h: number } | null;   // x 60, y 40, w (N−2)·56 − 8, h lanes·32 − 6
  fits: boolean }
export function layoutPanel(spec: ModuleSpec): PanelLayout;
// ui/store.ts
export interface Session { doc: Doc; view: { x: number; y: number; z: number }; sel: string[]; hover: string | null;
  listen: { id: string; port: string } | null; notice: string | null }
export function createSession(specs: Specs, host: AudioHost | null): {
  state: Session;                                     // a Solid store; every new doc applied with reconcile
  attach(host: AudioHost): void;                      // after the first click: posts the current plan
  commit(doc: Doc, merge?: Merge): void; undo(): void; redo(): void;   // compile + post a plan on structure changes
  knob(id: string, param: string, knob: number, merge: Merge): void;  // doc + a knob message, no recompile
  nodeOf(id: string): number | null }                 // module id → plan node index
// ui/autosave.ts — IndexedDB 'sreda' / store 'session' / key 'current'; corrupt → copied to 'backup-<ISO time>'
export function loadSaved(specs: Specs): Promise<{ doc: Doc; notice: string | null }>;
export function scheduleSave(doc: Doc): void;        // 500 ms after the last call
// ui/live.ts — one requestAnimationFrame loop over the readout SharedArrayBuffer; writes styles directly
export function register(el: HTMLElement, kind: 'level' | 'modDot' | 'flash', offset: number): () => void;  // flash: a trigger input's count changed
```
The worklet gets the readout `SharedArrayBuffer` (`READOUT_CAPACITY` floats) in `processorOptions` and copies
`engine.readouts()` into it after every block. The canvas: modules are DOM panels drawn from `layoutPanel` on a
layer panned (wheel, Space-drag) and zoomed (⌘-wheel / pinch, 0.25…2) by one CSS transform; cables are one SVG layer
with the prototype's `bez` curve, gradient-stroked between role colours when the ends differ. Panels follow the
grammar and quiet rules in Global Constraints; options show text, `▾` lists open the anchored list (spec §4), and
`glyph: 'wave'` draws the prototype's wave glyphs; an open list closes when the canvas pans or zooms. Knobs: vertical drag 200 px = full range (Shift ×0.1), wheel 1 %
per notch (one step for stepped knobs, a 0.7 s pause ends the merge), double-click resets. Audio: the `CLICK TO
START AUDIO` line stays until the first click; the tone is gone. Start-up: `loadSaved` → resumes the canvas, or
`starterDoc` on first launch; a corrupt save shows the notice `AUTOSAVE WAS UNREADABLE — KEPT AS BACKUP, OPENED A
NEW PATCH` on one line until the next click. `window.__sreda = { doc(), readout(offset) }` for e2e.

- [ ] **Step 1: Failing tests:**
  - `panel.test.ts`: on an inline 5×1 spec with 3 knobs and one 3-value option: w 280, h 144; knob cells at x 56 /
    112 / 168, y 38; the option at the bottom lane (y 102), 2 HP; display null; `fits`. Every spec in `SPECS` fits.
  - `Panel.test.tsx` (happy-dom): OSC renders 3 input jacks, 1 output jack, 3 knobs and a WAVE option showing the SAW
    glyph; FREQ's value text is hidden until the module is hovered; a ×2 ratio shows while a default ratio does not.
  - `e2e/app.spec.ts`: first launch shows OSC and OUT joined by a cable; after a click the OUT level readout is > 0
    within 1 s; dragging FREQ up 100 px raises `doc().modules[0].params.freq` by 0.5 ± 0.01; ⌘Z restores it; a
    relaunch resumes the edited patch; writing garbage to the IndexedDB key and relaunching shows the notice, opens
    the starter patch and leaves a `backup-…` key (Review Focus 2).
- [ ] **Step 2:** → FAIL. **Step 3:** Implement. **Step 4:** `pnpm check && pnpm e2e` → PASS.
- [ ] **Checkpoint for the user:** `pnpm dev` — OSC → OUT plays; turn FREQ, PW, change WAVE, hear it.
- [ ] **Step 5:** Commit `feat(ui): the canvas shows and plays the patch`.

### Task 7: Patching

**Files:** `packages/ui/src/canvas/{Canvas.tsx,Jack.tsx,Cables.tsx,Picker.tsx}`, `store.ts`; `e2e/app.spec.ts`.

Gestures (spec §4), ported from the prototype's handlers:
- **Wire:** drag from jack to jack, either direction; dropping on an occupied input stacks. While dragging, a
  dashed cable follows the pointer; compatible jacks keep full strength, the rest dim.
- **Unwire / re-route:** drag from an input with cables picks up its most recent cable; drop on another input to
  move it, in empty space to remove it.
- **Add:** `/` or a double-click on empty canvas opens the module picker at the pointer; a drag from a jack into
  empty space opens it there, listing modules with a port of the opposite direction (same role first), and Enter
  places the module so the chosen port sits at the drop point and wires it. Type-ahead, ↑ / ↓, Enter, Esc; the list
  scrolls; it closes when the canvas pans or zooms. (Tabs for groups and projects come in Plan 3.)
- **Select / move / delete:** click selects, Shift adds; drag on empty canvas draws a selection box; drag a module by
  its face moves the selection (one undo step); Backspace deletes the selection with its cables.
- **Listen:** click an output jack → the bar `LISTENING · <module> › <port>` at the top; clicking the bar, Esc or the
  same jack again ends it; deleting the module ends it.
- **Values on inputs:** drag the att / ratio value under a jack's label (vertical; att −1…+1 in 0.01, ratio over
  −16…−2, 1, 2…8), double-click resets; knob mod jacks: Alt-drag their knob sets the depth.
- **F** fits the patch in view, ⇧F the selection; **⌘Z / ⇧⌘Z** undo / redo everything above.

- [ ] **Step 1: Failing tests** (`e2e/app.spec.ts`): drag from OSC OUT into empty space → picker → type `out`,
  Enter → a second OUT placed with its L at the drop point and wired; drag from OSC OUT onto that OUT's R stacks a
  cable; drag from that R into empty space removes the cable; box-select both OUTs, Backspace → gone, ⌘Z → back;
  click OSC OUT → the bar reads `LISTENING · OSC › OUT`, Esc → gone; drag OSC's PTCH att value down 50 px → the doc's
  `atts.pitch` ≈ 0.5; `/` opens the picker, Esc closes it.
- [ ] **Step 2:** → FAIL. **Step 3:** Implement. **Step 4:** `pnpm check && pnpm e2e` → PASS.
- [ ] **Checkpoint for the user:** `pnpm dev` — add a second OSC, patch it into the first one's FM and PTCH, set the
  attenuverters, listen to each output.
- [ ] **Step 5:** Commit `feat(ui): patching — wire, unwire, picker, select, delete, listen, input values`.
