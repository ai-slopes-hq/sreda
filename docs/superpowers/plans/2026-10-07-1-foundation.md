# SREDA 2 · Plan 1 — Foundation: document, engine, 24 modules

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Everything below the UI: the patch document and its edits, frames, undo, compile, the audio engine and
all 24 first-build modules, plus factory patches — tested in Node and audible through a WAV render script.

**Architecture:** pnpm monorepo. `core` owns the immutable document, edits, frame geometry, undo and
`compile` (document → plan). `protocol` owns the UI ↔ engine messages and the readout buffer layout. `engine` owns
`EngineCore` (host-independent, runs the plan per 128-sample block) and the DSP contract. `modules/<type>/` holds
each module's `spec.ts` (core only) and `dsp.ts` (engine). No browser code in this plan.

**Tech Stack:** TypeScript ~6.0.3, pnpm@12.8.1, Node ≥ 22, Vitest ^5.0.3, ESLint ^10.11.0 + typescript-eslint
^8.71.0, Prettier ^3.9.9 (same tooling as `../sreda`).

**Spec:** `docs/superpowers/specs/2026-10-07-canvas-ux-design.md` (revision 10, approved). The prototype
`docs/prototype/Main.dc.html` holds plain-JS versions of the frame geometry, generators and factory patches; port
them, do not re-derive them. Its `Sim` is not a DSP reference.

**This plan is 1 of 3.** Plan 2 — the app and canvas (worklet host, store, autosave, modules and cables on screen,
patching gestures, picker for modules, readouts). Plan 3 — frames UI, WIRE FIX / STACK / MUTE, the sidebar and
WIRES, the library folder and pickers for groups and projects, e2e. Both are written after this one lands.

## Global Constraints

- Package boundaries `core ← protocol ← engine`, `core ← ui`, enforced by ESLint; `modules/*/spec.ts`,
  `modules/specs.ts`, `modules/generators.ts`, `modules/factory.ts` import core only; `modules/*/dsp.ts`,
  `modules/dsps.ts` import core and engine only.
- Audio thread rules (`CLAUDE.md`): nothing in `process()` or below allocates, locks, awaits, does I/O or logs;
  numeric class fields get numeric initialisers; no closures, spread, `for…of` over Maps or array literals in
  `process()`; compute both arms before selecting a double.
- Sample rate in tests 48 000; `BLOCK = 128`.
- Port roles: `audio` nominal ±1; `mod` ±1 or 0…1 per output; `pitch` octaves (+1.0 = one octave up); `trigger`
  fires on a rising edge above 0.5, re-arms below 0.25; trigger outputs are 0/1, triggers 1 ms (48 samples), gates
  as long as they last.
- Stacking: audio / mod / pitch inputs sum their cables; trigger inputs merge (each cable edge-detected on its own).
- Attenuverter (−1…+1) on mod and pitch inputs and every knob mod jack, applied after the sum; default 1, mod-jack
  default = the param's `modDepth` (0.25 for frequency-type knobs). Audio inputs have none.
- Ratio on every trigger input, signed integer: −16…−2 = ÷N, 1 = unity, 2…8 = ×N, applied after the merge. ÷N passes
  the 1st of every N; ×N adds N−1 evenly spaced events over the interval between the last two incoming events
  (nothing extra until two have arrived).
- Knob modulation: ±1 at attenuverter 1 sweeps the whole knob range in knob space (taper included). Knob changes
  glide 10 ms in knob space.
- Master: 5 Hz DC blocker, soft limiter (identity to |x| 0.9, `sign·(0.9 + 0.1·tanh((|x|−0.9)/0.1))` above),
  nothing non-finite reaches the output; the listen path goes through it too. Several OUT modules sum before it.
- Removed modules and re-routed inputs fade over 10 ms; a frame mute ramps over 50 ms; factory projects fade in
  over 200 ms.
- Sizes HP = 48 px, U = 112 px. Module sizes (HP × U): OSC 5×1, COMPLEX 6×1, NOISE 3×1, UNCERTAINTY 4×1, SLOPE 5×1,
  LPG 4×1, FILTER 4×1, FOLD 4×1, STAGES 10×3, RHYTHM 10×2, CHANCE 3×1, SHIFT 3×1, COMPARE 3×1, FOLLOW 6×1,
  SWITCH 4×2, SPREAD 4×2, S&H 2×1, QUANT 3×1, MIX 4×2, ATT 6×2, A×B+C 5×2, DELAY 5×1, SCOPE 6×2, OUT 3×1.
- Panel grammar (spec §2): header 24 px; lanes 28 px (1U = 3, 2U = 7, 3U = 11); IN column 1 HP | control area
  N − 2 HP | OUT column 1 HP; one jack per lane in spec order; control area = display (whole lanes) → knob rows
  (2 lanes each) → mode strip (bottom lane; options from the left, actions from the right; 1 HP per button, 2 HP for
  a `▾` list with words). Displays: STAGES 8 lanes, RHYTHM 4, SCOPE 4.
- Frame geometry: header 28 px, padding 16 px, WIRE FIX channel 32 px, frame minimum 352 × 96, grid 16 px.
- UI text and names are English; modules of the same type are numbered in names (`SLOPE 1`, `SLOPE 2`).

## Review Focus

1. A runaway feedback patch — DELAY out → its own in at feedback 0.95, through FILTER at res 1 — must stay finite and
   within ±1 at the device (test in Task 8).
2. A broken or future document — unknown module type, cable to a missing port or module, `parent` naming a missing
   frame, `version: 2` — must be rejected by `validateDoc` (returns null), never half-loaded (test in Task 2).
3. Audio-rate signals in trigger inputs — a 2 kHz square into a ×8 ratio input and into RHYTHM's CLK — must not grow
   the pending-event queue without bound or produce NaN (test in Task 7).
4. Deleting a frame whose CLK out feeds modules outside it must remove those cables and leave a valid, compilable
   document (tests in Task 4 and Task 6).
5. Overlapping frames of equal area must never produce a parent cycle (test in Task 4).

---

## File structure

```
package.json · pnpm-workspace.yaml · tsconfig.base.json · eslint.config.js · .prettierrc.json · .gitignore · vitest.config.ts
packages/core/src/
  spec.ts        ModuleSpec, Port, Param (knob | option | action, hidden), Normal; toKnob / fromKnob; HP, U
  panel.ts       layoutPanel: the panel grammar as positions (used by the conformance test now, the UI in plan 2)
  doc.ts         Doc, ModuleDoc, Cable, Frame types; emptyDoc; validateDoc
  rng.ts         mulberry32
  ops.ts         module / cable / value edits, randomize, replace, insert into cable, duplicate
  frames.ts      parents, descendants, createFrame, removeFrame, deleteObjects, layoutRows, stackFrame,
                 landingFrame, extractGroup, mergeInto, chainOf
  names.ts       nameOf (numbered), portLabel
  history.ts     History (gesture merging)
  plan.ts        Plan, PlanNode, Binding, ReadoutLayout types
  compile.ts     compile(doc, specs, seq) → Plan
  index.ts
packages/protocol/src/  messages.ts (ToEngine, FromEngine) · readouts.ts (offsets, header) · index.ts
packages/engine/src/
  dsp.ts         BLOCK, DspContext, DspIO, DspModule, DspFactory
  inputs.ts      EdgeDetector, TriggerInput (merge, ratio, 1 ms re-emit), sumInto
  master.ts      Master
  clock.ts       FrameClock (the hidden node a frame compiles to)
  engine.ts      EngineCore
  testing.ts     render(), offline helpers
  index.ts
modules/
  <type>/spec.ts · <type>/dsp.ts · <type>/<type>.test.ts       (24 types)
  specs.ts (SPECS) · dsps.ts (DSPS) · generators.ts · factory.ts
  conformance.test.ts · factory.test.ts · gc.test.ts
scripts/render.ts   pnpm render <factory name> [seconds] → <name>.wav
```

Module type ids (folder names): `osc complex noise uncertainty slope lpg filter fold stages rhythm chance shift
compare follow switch spread sah quant mix att abc delay scope out`.

---

### Task 1: Monorepo scaffold

**Files:** Create `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `eslint.config.js`,
`.prettierrc.json`, `.gitignore`, `vitest.config.ts`, `packages/{core,protocol,engine}/{package.json,tsconfig.json,src/index.ts}`,
`modules/{package.json,tsconfig.json}`, `packages/core/src/smoke.test.ts`; modify `CLAUDE.md`.

**Interfaces:**
- Produces: workspace packages `@sreda/core`, `@sreda/protocol`, `@sreda/engine`, `@sreda/modules` (each
  `exports: { ".": "./src/index.ts" }`; modules also `"./specs"`, `"./dsps"`, `"./generators"`, `"./factory"`);
  root scripts `test`, `typecheck`, `lint`, `check` (= typecheck && lint && test), `format`, `render`
  (`tsx scripts/render.ts`).

- [ ] **Step 1:** Mirror `../sreda`'s tooling: root `package.json` scripts and devDependencies (add `tsx`),
  `tsconfig.base.json` flags, Prettier config, `.gitignore`. `pnpm-workspace.yaml`: `packages/*`, `modules`.
  `vitest.config.ts` includes `packages/*/src/**/*.test.ts` and `modules/**/*.test.ts`, environment node.
- [ ] **Step 2:** `eslint.config.js` with `../sreda`'s `forbid(...)` helper and the boundaries in Global Constraints.
- [ ] **Step 3:** `smoke.test.ts`: `expect(1 + 1).toBe(2)`. Run `pnpm install && pnpm check` → typecheck, lint and
  1 test pass.
- [ ] **Step 4:** In `CLAUDE.md` replace the "no code yet" lines with: `pnpm check` (typecheck + lint + unit tests) ·
  `pnpm test -- <path>` (one file) · `pnpm render <name>` (factory patch → WAV); add one line: the prototype in
  `docs/prototype/` is the reference for geometry, generators and factory content.
- [ ] **Step 5:** Commit `chore: scaffold monorepo`.

### Task 2: Specs, knob mapping, document shape

**Files:** Create `packages/core/src/{spec.ts,doc.ts,rng.ts,panel.ts}`; tests `spec.test.ts`, `doc.test.ts`, `panel.test.ts`.

**Interfaces:**
```ts
// spec.ts
export const HP = 48, U = 112;
export type Role = 'audio' | 'mod' | 'pitch' | 'trigger';
export interface Port { id: string; label: string; role: Role; polarity?: 'bi' | 'uni' }
export interface KnobParam { kind: 'knob'; id: string; label: string; min: number; max: number; def: number;
  taper: 'lin' | 'exp'; step?: number; unit?: 'hz' | 's' | 'note'; randomRange?: [number, number]; modDepth?: number;
  hidden?: boolean }                                   // hidden: lives in a display (STAGES / RHYTHM), no cell, no mod jack
export interface OptionParam { kind: 'option'; id: string; label: string; options: string[]; def: number;
  glyph?: 'wave' | 'scale'; hidden?: boolean }
export interface ActionParam { kind: 'action'; id: string; label: string }   // a button (DICE); holds no value
export type Param = KnobParam | OptionParam | ActionParam;
export type Normal =
  | { input: string; own: string; when?: { param: string; value: number } }  // from one of the module's outputs
  | { input: string; internal: string }                                        // DSP-provided source, named for display
  | { input: string; value: number };                                          // constant
export interface ModuleSpec { type: string; label: string; desc: string; size: [number, number];
  inputs: Port[]; outputs: Port[]; params: Param[]; normals?: Normal[]; display?: { lanes: number; kind: 'scope' | 'contour' | 'pads' } }
export type Specs = Readonly<Record<string, ModuleSpec>>;
export function toKnob(p: KnobParam, value: number): number;   // value → 0…1 (exp: log space)
export function fromKnob(p: KnobParam, knob: number): number;  // 0…1 → value, clamped, snapped to step
export function modJack(paramId: string): string;              // '@' + id
export function inputPorts(spec: ModuleSpec): Port[];          // inputs + one role-'mod' port per visible knob ('@id')
// doc.ts
export interface ModuleDoc { id: string; type: string; x: number; y: number; parent: string | null;
  params: Record<string, number>;      // knob → knob position 0…1; option → index
  atts: Record<string, number>; ratios: Record<string, number> }   // keyed by input port id ('@param' for mod jacks)
export interface Cable { from: [string, string]; to: [string, string] }
export interface Frame { id: string; name: string; x: number; y: number; w: number; h: number; parent: string | null;
  ratio: number; tint: number; layout: 'free' | 'route'; muted: boolean; clock: { on: boolean; bpm: number } }
export interface Doc { version: 1; modules: ModuleDoc[]; cables: Cable[]; groups: Frame[]; nextId: number }  // field names as in the spec and the files
export const emptyDoc: Doc;
export function validateDoc(json: unknown, specs: Specs): Doc | null;
// rng.ts
export function mulberry32(seed: number): () => number;
// panel.ts — port the prototype's lay(): positions relative to the module's top-left
export const HEAD = 24, LANE = 28, LANES = { 1: 3, 2: 7, 3: 11 } as const;
export interface PanelLayout { w: number; h: number; lanes: number;
  jacks: Record<string, { x: number; y: number }>;            // ins at x 10, outs at x w − 10, y = 26 + 28·i + 14; mod jacks at a knob cell + (5, 5)
  cells: Record<string, { x: number; y: number; w: number; mode: boolean }>;  // knob cells 48 × 56; mode-strip buttons 1 or 2 HP × 28
  display: { x: number; y: number; w: number; h: number } | null;              // x 50, y 28, w (N−2)·48 − 4, h lanes·28 − 4
  fits: boolean }   // jacks ≤ lanes, display + 2·knob rows + (mode strip ? 1 : 0) ≤ lanes, mode-strip HP ≤ N − 2
export function layoutPanel(spec: ModuleSpec): PanelLayout;
```
Module ids are `m<n>`, frame ids `g<n>`; a frame's jacks are `[frameId, 'clkIn']` and `[frameId, 'clkOut']`.

- [ ] **Step 1: Failing tests**
```ts
const cut: KnobParam = { kind: 'knob', id: 'cutoff', label: 'CUT', min: 20, max: 20000, def: 1000, taper: 'exp' };
test('exp taper', () => { expect(toKnob(cut, 20)).toBe(0); expect(fromKnob(cut, 0.5)).toBeCloseTo(Math.sqrt(20 * 20000), 3); });
test('step snapping', () => { const n = { ...cut, min: 1, max: 16, def: 2, taper: 'lin' as const, step: 1 }; expect(fromKnob(n, 0.52)).toBe(9); });
test('inputPorts adds a mod jack per visible knob only', ...);   // a spec with one hidden knob: no '@hidden'
test('validateDoc rejects', ...);   // each → null: version 2 · unknown type · cable to a missing port · cable to a
                                    // missing module · parent naming a missing frame · cable to [frame, 'nope']
test('validateDoc fills missing params with defaults and keeps atts / ratios', ...);
test('mulberry32 repeats', () => { expect(mulberry32(7)()).toBe(mulberry32(7)()); });
test('layoutPanel follows the grammar', ...);   // a 5×1 spec with 3 knobs + one 3-value option: knobs at x 48, 96, 144,
                                                 // y 26; option button at the bottom lane (y 82), 2 HP; display null; fits
```
- [ ] **Step 2:** `pnpm test -- packages/core` → FAIL. **Step 3:** Implement. **Step 4:** → PASS.
- [ ] **Step 5:** Commit `feat(core): specs, knob mapping, document`.

### Task 3: Edits

**Files:** Create `packages/core/src/{ops.ts,names.ts}`; test `ops.test.ts`, `names.test.ts`.

**Interfaces** (pure; return a new `Doc`; `RuleError` only for structural errors — wrong direction, unknown port):
```ts
export class RuleError extends Error {}
export function addModule(doc: Doc, specs: Specs, type: string, x: number, y: number): { doc: Doc; id: string };
export function moveObjects(doc: Doc, ids: readonly string[], dx: number, dy: number): Doc;  // modules and frames
export function connect(doc: Doc, specs: Specs, from: [string, string], to: [string, string]): Doc; // adds (stacking); an identical cable is not duplicated
export function removeCable(doc: Doc, cable: Cable): Doc;      // removes one matching cable
export function setParam(doc: Doc, specs: Specs, id: string, param: string, value: number): Doc;  // value: knob 0…1 or option index
export function setAtt(doc: Doc, id: string, port: string, v: number | null): Doc;   // null = back to default
export function setRatio(doc: Doc, id: string, port: string, r: number): Doc;        // module input or frame 'clkIn'
export function randomize(doc: Doc, specs: Specs, id: string, rng: () => number): Doc;  // visible knobs only
export function duplicate(doc: Doc, ids: readonly string[], dx: number, dy: number): { doc: Doc; ids: string[] };
export function replaceModule(doc: Doc, specs: Specs, id: string, type: string): { doc: Doc; id: string };
export function insertIntoCable(doc: Doc, specs: Specs, id: string, cable: Cable): Doc;
// names.ts
export function nameOf(doc: Doc, specs: Specs, id: string): string;   // 'SLOPE 2' when there are several; frame name
export function portLabel(doc: Doc, specs: Specs, id: string, port: string): string;  // 'SLOPE 2 › EOC'
```
Rules: positions snap to 16 px; `replaceModule` keeps x, y, parent; cables follow the same port id, else the next
unused port of the same role; unmatched cables go; knobs with the same id keep their *value* (via fromKnob/toKnob);
atts/ratios follow a port only when the id is the same. `insertIntoCable`: source → the module's first input of the
source's role (else first input); the module's first output of the target's role (else first output) → old target.
Port the prototype's `replaceModule`, `insertIntoCable`, `randomize`.

- [ ] **Step 1: Failing tests:** ids `m<nextId>` never reused; snap 21,40 → 16,48; two connects to one input keep
  both cables, an identical third is ignored; output→output throws `RuleError`; a module may patch into itself;
  `duplicate` copies only cables inside the selection; `randomize` stays in `randomRange` and skips options and
  hidden knobs; `replaceModule` OSC→COMPLEX keeps `freq`'s Hz value and moves `out` cables, drops cables with no
  match; `insertIntoCable` OSC.out→FILTER.in with a free FOLD gives OSC→FOLD.in, FOLD.out→FILTER.in;
  `nameOf` → `SLOPE 1`, `SLOPE 2` with two, `SLOPE` with one.
- [ ] **Step 2:** → FAIL. **Step 3:** Implement. **Step 4:** → PASS.
- [ ] **Step 5:** Commit `feat(core): document edits`.

### Task 4: Frames

**Files:** Create `packages/core/src/frames.ts`; test `frames.test.ts`.

**Interfaces** (port from the prototype: `recomputeParents`, `descendants`, `withDescendants`, `depthOf`,
`fitFrame`, `readingOrder`, `layoutRows`, `stackFrame`, `landingFrame`, `extractGroup`, `mergeInto`, `chainOf`):
```ts
export const GHEAD = 28, GPAD = 16, RGAP = 32, FRAME_MIN = { w: 352, h: 96 };
export function recomputeParents(doc: Doc, specs: Specs, only?: readonly string[]): Doc;
export function descendants(doc: Doc, frameId: string): string[];
export function createFrame(doc: Doc, specs: Specs, ids: readonly string[]): { doc: Doc; id: string };  // ⌘G: fitted, layout 'route' then layoutRows
export function removeFrame(doc: Doc, specs: Specs, frameId: string): Doc;   // ⇧⌘G: children go to its parent; its jacks' cables go
export function deleteObjects(doc: Doc, ids: readonly string[]): Doc;        // frames take their descendants and every cable touching any of them
export function moveDropped(doc: Doc, specs: Specs, roots: readonly string[]): Doc;   // after a move: re-parent the roots, re-pack any WIRE FIX frame they left or entered
export function resizeFrame(doc: Doc, specs: Specs, frameId: string, r: { x: number; y: number; w: number; h: number }): Doc;  // clamps to FRAME_MIN, re-parents everything
export function layoutRows(doc: Doc, specs: Specs, frameId: string): Doc;    // WIRE FIX rows
export function stackFrame(doc: Doc, specs: Specs, frameId: string): Doc;    // STACK skyline, gap 0
export function landingFrame(doc: Doc, specs: Specs, roots: readonly string[], dx: number, dy: number): string | null;
export function extractGroup(doc: Doc, frameId: string): Doc;                // the frame, its contents, cables between them
export function mergeInto(doc: Doc, src: Doc, dx: number, dy: number): { doc: Doc; map: Record<string, string> };  // fresh ids
export function chainOf(doc: Doc, id: string): string[];                     // frames holding id, innermost first (a frame holds itself)
```
Membership: innermost frame containing the object's centre; a frame's parent must have a strictly larger area (so
no cycles; equal areas never nest).

- [ ] **Step 1: Failing tests:** a module dropped into a frame gets it as parent, dragged out gets null;
  `moveDropped` of a frame over loose modules does not capture them, `resizeFrame` over them does; two
  overlapping frames of equal area are not each other's parent (Review Focus 5); `createFrame` of two modules gives
  a `route` frame whose children sit in one row with 32 px gaps, header 28 + gap 32 above the row; `layoutRows`
  wraps at the frame's inner width; `stackFrame` leaves no gap between neighbours; `removeFrame` re-parents
  children to the grandparent; `deleteObjects([frame])` removes its contents and a cable from its `clkOut` to a
  module outside it, and `validateDoc` accepts the result (Review Focus 4); `extractGroup` + `mergeInto` twice gives
  unique ids and 2× the cables; `landingFrame` names the innermost frame under the moved centre.
- [ ] **Step 2:** → FAIL. **Step 3:** Implement. **Step 4:** → PASS.
- [ ] **Step 5:** Commit `feat(core): frames and membership`.

### Task 5: Undo history

**Files:** Create `packages/core/src/history.ts`; test `history.test.ts`.

```ts
export type Merge = { key: string; stroke?: boolean } | undefined;
export class History {
  constructor(initial: Doc, now?: () => number);
  readonly current: Doc;
  commit(doc: Doc, merge?: Merge): void;  // same key as the top step and (stroke, or < 700 ms since it) → replaces top
  replace(doc: Doc): void;                // changes the current doc without a step (DICE from an input)
  undo(): Doc | null; redo(): Doc | null;
}
```
- [ ] **Steps 1–5:** tests with an injected clock — key `k` 300 ms apart merges, 800 ms apart does not; `stroke`
  merges at any gap until another key; a commit after undo clears redo; `replace` adds no step. FAIL → implement →
  PASS → commit `feat(core): undo history`.

### Task 6: Compile

**Files:** Create `packages/core/src/{plan.ts,compile.ts}`, `packages/protocol/src/{readouts.ts,messages.ts}`;
test `compile.test.ts`.

**Interfaces:**
```ts
// plan.ts
export interface Source { node: number; port: number; late: boolean }          // node index into Plan.nodes
export interface InputPlan { sources: Source[]; normal: Source | number | 'internal' | null;  // number = constant
  kind: 'sum' | 'cv' | 'trigger'; att: number; ratio: number; muted: boolean[] }  // muted[i]: source i leaves a muted frame
export interface PlanNode { id: string; type: string;   // a frame compiles to type '__clock'
  knobs: number[]; fixed: number[];                     // knobs: visible knob positions; fixed: options + hidden knob values (real units)
  inputs: InputPlan[];                                  // one per inputPorts(spec), mod jacks included, in that order
  connectedOut: boolean[]; outMuted: boolean }          // OUT inside a muted frame
export type Step = { node: number } | { loop: number[] };
export interface Plan { seq: number; nodes: PlanNode[]; steps: Step[]; layout: ReadoutLayout; fadeInMs?: number }
// protocol/readouts.ts — one Float32Array over a SharedArrayBuffer; [0] = seq of the plan being written
export interface ReadoutLayout { seq: number; size: number; nodes: Record<string, { knobs: number; trigs: number;
  outs: number; state: number; trace?: number }> }   // start offsets; trace: SCOPE, 4 × 256 floats (min/max of A and B per column)
export const TRACE_COLS = 256;
// protocol/messages.ts
export type ToEngine =
  | { t: 'plan'; plan: Plan } | { t: 'knob'; id: string; index: number; value: number }
  | { t: 'att'; id: string; input: number; value: number } | { t: 'ratio'; id: string; input: number; value: number }
  | { t: 'mute'; frameId: string; muted: boolean } | { t: 'listen'; target: { id: string; port: number } | null }
  | { t: 'readouts'; sab: SharedArrayBuffer };
export type FromEngine = { t: 'dice'; id: string };      // a rise on a DICE input
export function compile(doc: Doc, specs: Specs, seq: number): Plan;
```
Rules:
- One node per module; one `__clock` node per frame: input 0 = CLK in (trigger, the frame's ratio), knobs none,
  fixed `[clock.on ? 1 : 0, clock.bpm]`, output 0 = CLK out. A nested frame's CLK in with no cables is normalled to
  its parent's `__clock` output (`normal: Source`).
- Normals: `own` → a late `Source` from the node itself (conditional `when` evaluated at compile; a plan is
  re-sent when that option changes); `internal` → `'internal'` (the DSP supplies it); `value` → the number. A
  normal applies only while the input has no cables.
- `kind`: `trigger` for trigger role; `cv` for mod / pitch roles and mod jacks (att applies); `sum` for audio.
- Order: Tarjan SCCs in topological order of the condensation; a single node without a self-edge is
  `{ node }`; an SCC of 2+ nodes or with a self-edge is `{ loop }` in document order; inside a loop an edge whose
  source comes at or after its listener is `late`.
- `muted[i]` is true when source i is inside a muted frame and the listener is not inside that frame;
  `outMuted` when an OUT sits inside a muted frame.
- Layout: disjoint offsets, index 0 reserved; `state` is 1 float (STAGES / RHYTHM / SWITCH / SPREAD current index).

- [ ] **Step 1: Failing tests** with small inline specs: a chain orders source first; A→B→A gives one loop with
  exactly one late edge; a self-patched node is a loop with a late source; two cables into one input give two
  sources; a SLOPE-like spec with `trig ← eoc when cycle=1` gets a late own normal only when the option is 1 and
  only while trig is unpatched; a nested frame's `__clock` input 0 normal points at its parent's `__clock`; a
  cable from a muted frame's module to a module outside has `muted[i] = true`, one inside does not; layout offsets
  are disjoint and `size` covers them; a document where a deleted frame's CLK out fed an outside module
  (`deleteObjects` from Task 4) compiles (Review Focus 4).
- [ ] **Step 2:** → FAIL. **Step 3:** Implement. **Step 4:** → PASS.
- [ ] **Step 5:** Commit `feat(core): compile documents into plans`.

### Task 7: Engine inputs, master, DSP contract

**Files:** Create `packages/engine/src/{dsp.ts,inputs.ts,master.ts}`; tests `inputs.test.ts`, `master.test.ts`.

**Interfaces:**
```ts
// dsp.ts
export const BLOCK = 128;
export interface DspContext { sampleRate: number; random: () => number; master: readonly [Float32Array, Float32Array];
  dice(): void }                                   // report a DICE rise to the UI
export interface DspIO { inp: Float32Array[]; par: Float32Array[]; fixed: Float64Array; out: Float32Array[];
  connectedIn: boolean[]; connectedOut: boolean[] }   // inp in inputPorts order (mod jacks excluded: they feed par)
export interface DspModule {
  process(io: DspIO, from: number, to: number): void;
  reset(): void;
  readonly state?: Float32Array;                   // [0] = current index, read into the readouts
  readonly trace?: Float32Array;                   // SCOPE only: 4 × TRACE_COLS
}
export type DspFactory = (ctx: DspContext, spec: ModuleSpec) => DspModule;
// inputs.ts
export class EdgeDetector { rise(x: number): boolean }                     // > 0.5 fires once, re-arms < 0.25
export class TriggerInput {                                                // merge + ratio + 1 ms re-emit
  constructor(sampleRate: number, maxSources: number);
  ratio: number;
  processSample(values: Float32Array, n: number): number;  // values[0..n): this sample of each source; returns 0/1
  readonly count: number;                                    // events emitted, for the readouts
}
export class Master { constructor(sampleRate: number); fadeIn(ms: number): void;
  process(l: Float32Array, r: Float32Array, n: number): void }
```
×N keeps at most 8 pending events (a new incoming event replaces the queue), so audio-rate input cannot grow it.

- [ ] **Step 1: Failing tests:** 0→0.6→0.4→0.6 fires once; two sources rising on different samples fire twice,
  together once; ÷3 passes events 1, 4, 7; ×4 after two events 1000 samples apart emits 3 more at 250-sample spacing;
  output pulses are 48 samples at 48 kHz; a 2 kHz square into ×8 for 2 s keeps output finite and the queue ≤ 8
  (Review Focus 3); Master: DC 0.5 decays below 0.01 within 0.5 s, input 10 stays ≤ 1, NaN → finite, fadeIn(200)
  ramps.
- [ ] **Step 2:** → FAIL. **Step 3:** Implement. **Step 4:** → PASS.
- [ ] **Step 5:** Commit `feat(engine): inputs, master, DSP contract`.

### Task 8: EngineCore

**Files:** Create `packages/engine/src/{engine.ts,clock.ts,testing.ts}`; test `engine.test.ts`.

**Interfaces:**
```ts
export class EngineCore {
  constructor(sampleRate: number, specs: Specs, dsps: Readonly<Record<string, DspFactory>>, seed: number);
  apply(plan: Plan): void;
  message(m: ToEngine): void;                 // knob / att / ratio / mute / listen / readouts
  process(l: Float32Array, r: Float32Array): void;   // one BLOCK
  takeEvents(): FromEngine[];                 // dice reports since the last call (the worklet posts them)
}
// testing.ts
export function render(core: EngineCore, seconds: number): { l: Float32Array; r: Float32Array };
export function toWav(l: Float32Array, r: Float32Array, sampleRate: number): Uint8Array;  // 16-bit PCM
```
Rules: instances and output buffers are keyed by node id and survive plan swaps; knobs glide 10 ms in knob space,
then `knob + att·modSum` clamped to 0…1 and mapped by `fromKnob` into `par`; `{ node }` steps run the whole block,
`{ loop }` steps run per sample with late sources read from a one-sample delay; after each `process` a non-finite
output zeroes that node's outputs and calls `reset()`; OUT adds into `ctx.master`; listen replaces master L and R
with the target output (mono to both) before `Master.process`; inputs whose source changed between plans crossfade
over 10 ms, removed nodes keep running 10 ms with outputs ramping to 0 (undo within the fade keeps the instance);
a muted source / OUT ramps over 50 ms; `FrameClock`: CLK in rises (after its ratio) pass straight through, else the
own clock emits a 1 ms trigger every 60/bpm s while `on`, else nothing; readouts are written once per block.
`takeEvents` is allocation-free in `process` (events go into a preallocated ring; `takeEvents` runs off the audio
path).

- [ ] **Step 1: Failing tests** with test DSPs in the file (`dc`, `gain`, `boom` writing NaN, `out`, `counter`):
  a cable carries samples; two cables into an audio input sum; a mod jack at att 1 sweeps the knob range; att −1
  inverts; knob change glides ~10 ms; a NaN module outputs 0 and is reset; listen replaces the main output; a
  per-sample loop equals the same chain computed by hand; removing a node ramps to 0 over 10 ms ± 1 block; a muted
  source ramps out over 50 ms; a frame clock at 120 BPM rises every 24 000 samples; a nested frame at ratio −2
  rises every 48 000; runaway feedback (`gain` > 1 into itself) stays finite and ≤ 1 at the output (Review Focus 1);
  readouts carry seq, knob position, trigger counts and held peaks.
- [ ] **Step 2:** → FAIL. **Step 3:** Implement. **Step 4:** → PASS.
- [ ] **Step 5:** Commit `feat(engine): EngineCore`.

### Tasks 9–13: The 24 modules

Each module: `modules/<type>/spec.ts` (exports `spec: ModuleSpec`, values from the spec's §7 table and the
prototype's `SPECS`: labels, ranges, defaults, `randomRange`, `modDepth`, normals, sizes), `modules/<type>/dsp.ts`
(exports `dsp: DspFactory`, one class), `modules/<type>/<type>.test.ts` driving the class through `process` with
hand-built buffers; registered in `modules/specs.ts` and `modules/dsps.ts`. Trigger outputs are 1 ms. Normals the
`Normal` type cannot express — A×B+C's `c2 ← out1 while out1 is unpatched`, ATT's output cascade, OUT's `r ← l` — are
done inside the DSP (from `connectedIn` / `connectedOut`) and declared as `internal` normals so the UI can show them.
Behaviour:

| Type | DSP |
|---|---|
| osc | phase accumulator; `f = freq·2^pitch·(1 + 4·fmi·fm)` (linear, through-zero allowed); SIN / TRI / SAW / SQR (pw), polyBLEP on SAW and SQR; a SYNC rise resets phase |
| complex | modulator at `freq·ratio` (SIN / TRI / SAW); carrier sine at `freq·2^pitch·(1 + 4·index·m)`, `m` = FM input, else the modulator (internal normal); OUT = carrier folded by FOLD's law with `fold = timbre`; MOD = modulator |
| noise | WHITE uniform ±1·level; PINK Paul Kellet filter ·level |
| uncertainty | on a TRIG rise (else every 1/rate s): STEPPED = new uniform ±1, QUANT = STEPPED snapped to `levels` evenly spaced values in ±1; SMOOTH glides to a new random target every 1/rate s (one-pole, τ = 1/(2·rate)) |
| slope | TRIG rise → rise from the current value over RISE, EOR at the top, fall over FALL, EOC at 0; shape s: `s>0: x^(1+2s)`, `s<0: 1−(1−x)^(1−2s)`; CYCLE ON and idle with TRIG unpatched → starts by itself (the own normal keeps it cycling); IN patched and idle → OUT slews toward IN with RISE / FALL as rates |
| lpg | PING rise → vactrol env to 1 (2 ms), then `×0.001^(1/(decay·sr))` per sample; control `c` = CV (clamped 0…1) if patched, else the env if PING is patched, else 1 — so with nothing patched it is a VCA on LEVEL; `g = level·c`; VCA: `in·g`; LP: one-pole LP at `20·1000^g` Hz; BOTH: LP then `·g` |
| filter | TPT state-variable, `k = 2 − 1.96·res`; outputs LP, BP, HP |
| fold | `y = sin(π/2·(g·x + sym))`, `g = 1 + 8·fold`, first-order ADAA |
| stages | 16 stages (hidden params v1–16 volts, t1–16 s, p1–16 pulse, g1–16 slide); ADV rise (or, unpatched, the stage time elapsing) → next stage within LEN, PULSE if on, EOC on wrap; RESET → next ADV plays stage 1; ADDR patched → stage `⌊clamp(addr,0,0.999)·LEN⌋`, a change counts as an advance; a slide stage glides 80 ms from the previous output; DICE rise → `ctx.dice()`; `state[0]` = current stage |
| rhythm | 16 steps (hidden g1–16: 0 off / 1 on / 2 tie; a1–16 accent); each CLK rise advances within LEN; EUCLID: hit = `((i − rot) mod n · k) mod n < k`; GRID: g; ON (or TIE after a rest) raises GATE until `now + interval/2` (`·1.05` if the next step is a TIE), fires ACC if accented; TIE after a sounding step only extends GATE; EOC on wrap; DICE rise → `ctx.dice()`; `state[0]` = step |
| chance | TRIG rise → A with probability P (ctx.random), else B |
| shift | measures the input period; ALL delays every event by AMT·period, EVEN every second one; ≤ 16 pending |
| compare | 1 while `in > thr`, 0 below `thr − 0.01` |
| follow | `|in|·gain` → one-pole up with ATK, down with REL → ENV (clamped 0…1); GATE while ENV > THR (hysteresis 0.02) |
| switch / spread | index: ADV rise → next (SEQ) or random (RAND) within LEN; RESET → 0; ADDR patched overrides; 5 ms crossfade on change; SWITCH: OUT = selected IN; SPREAD: selected OUT = IN, others 0; `state[0]` = index |
| sah | TRIG rise → hold IN (IN unpatched → internal white noise) |
| quant | semis = `in·12 − root`, nearest degree of SCALE (ties down), `+ root`, `/12` |
| mix | `a·la + b·lb + c·lc + d·ld` |
| att | `outN = inN·attN + ofsN` (inN unpatched → 1); an unpatched outN adds into out(N+1) (`connectedOut`) |
| abc | `outN = aN·gaN·(bN·gbN) + cN + cN_offset`, bN unpatched → 1; c2 unpatched and out1 unpatched → c2 = out1 |
| delay | 2 s buffer allocated in the constructor, linear interpolation; write `in + wet·fb`; OUT = `in·(1−mix) + wet·mix` |
| scope | THRU A/B = A/B unchanged; trace: min/max of A·ga and B·gb per column over TIME per screen into `trace`; sweep restarts on a TRIG rise, else on A rising through 0, else free-running; MODE XY writes A,B pairs |
| out | adds `l·level` and `r·level` into `ctx.master`; R unpatched → R = L |

### Task 9: Sources — osc, complex, noise, uncertainty
- [ ] Tests: OSC SAW at 440 Hz zero-crossing period 48000/440 ± 1; pitch +1 halves it; SQR at 2 Hz ≥ 0.5 for half
  its period; SYNC restarts phase; COMPLEX with index 0 is a pure sine, MOD at ratio 2 has twice the carrier
  frequency, FM patched replaces the modulator; NOISE repeats with the same seed, mean ≈ 0; UNCERTAINTY quant has at
  most `levels` distinct values, SMOOTH stays within ±1. FAIL → implement → PASS → commit `feat(modules): sources`.

### Task 10: Shaping — slope, lpg, filter, fold
- [ ] Tests: SLOPE rise 0.01 s reaches 1 at sample 480 ± 1 with EOR there; fall 0.1 s ends with EOC at ≈ 4800;
  CYCLE ON runs with nothing patched; a 2 kHz square into TRIG stays finite within 0…1; LPG ping env −60 dB at
  DECAY; LPG with nothing patched and LEVEL 0.5 halves its input (a VCA); FILTER LP at 1 kHz attenuates 10 kHz by ≥ 30 dB and passes 100 Hz within 1 dB, HP the
  reverse, res 1 on noise finite for 2 s; FOLD with fold 0 is ≈ identity for |x| < 0.3. Commit `feat(modules): shaping`.

### Task 11: Sequencing — stages, rhythm, generators
**Files:** also `modules/generators.ts` (core-only): port the prototype's `euclid`, `genNotes`, `diceModule`:
```ts
export function euclid(n: number, k: number, rot: number): boolean[];
export function genNotes(algo: '303' | 'MOTIF' | 'WALK' | 'TURING' | 'ARP' | 'PHRASE' | 'PEDAL', n: number, mask: number[], root: number, rng: () => number): number[];  // semitones 0…24
export function diceStages(doc: Doc, specs: Specs, id: string, rng: () => number): Doc;   // v = (semi − 12)/12, slides for 303 / MOTIF, pulses on
export function diceRhythm(doc: Doc, specs: Specs, id: string, rng: () => number): Doc;   // DENS hits, ties into the rest after a note, accents 30 %, MODE → GRID
export const SCALES: number[][];   // CHR MAJ MIN DOR PHR PMIN PMAJ WHL
```
- [ ] Tests: `euclid(16,5,0)` = `x...x..x..x..x..`; every `genNotes` algorithm returns 16 values in 0…24 in the scale;
  `diceRhythm` ties always follow a note; STAGES advances on ADV, wraps at LEN with EOC, skips PULSE on a rest stage,
  slides over 80 ms, free-runs on its stage times when ADV is unpatched, calls `ctx.dice` on a DICE rise; RHYTHM
  `x.x-..x.x.xx-.x.` gives 7 GATE rises per pattern pass (the two ties do not retrigger) and ACC on accented hits;
  a 2 kHz square into CLK stays finite. Commit `feat(modules): sequencing and generators`.

### Task 12: Logic — chance, shift, compare, follow, switch, spread, sah, quant
- [ ] Tests: CHANCE P=0 → all to B, P=1 → all to A, P=0.5 over 10 000 events within 45–55 %; SHIFT EVEN delays only
  every second event by AMT·period; COMPARE does not chatter on a sine with 0.005 noise at the threshold; FOLLOW
  ENV rises with a burst and falls over REL, GATE above THR; SWITCH SEQ cycles 1→2→3→1 at LEN 3, ADDR overrides;
  SPREAD routes IN to one output at a time; S&H holds between rises and samples noise when IN is unpatched; QUANT
  major root 0 maps 1.08 st → 2 st. Commit `feat(modules): logic`.

### Task 13: Mix, FX, out — mix, att, abc, delay, scope, out
- [ ] Tests: MIX sums with levels; ATT with nothing patched gives the offsets, an unpatched OUT1 adds into OUT2;
  A×B+C ring-modulates two sines (product), B unpatched passes A·gain + C, out1 cascades into c2 while unpatched;
  DELAY 0.1 s echoes an impulse at 4800 ± 1, feedback 0.5 halves the next echo; SCOPE THRU equals the input and the
  trace holds min/max per column; OUT with only L writes L to both master channels. Commit
  `feat(modules): mix, fx, out`.

### Task 14: Factory patches, conformance, GC, render script

**Files:** Create `modules/factory.ts` (core-only), `modules/{conformance,factory,gc}.test.ts`, `scripts/render.ts`.

**Interfaces:**
```ts
export interface FactoryEntry { kind: 'project' | 'group'; path: string; build(specs: Specs): Doc }  // path 'FACTORY/acid'
export const FACTORY: readonly FactoryEntry[];
```
Port the prototype's `SEEDS` (pulse, drone, self-clocked, polymeter, acid, ratchet) and `FACTORY_GROUPS` (303 voice,
complex vco, bleep-bloop, vca-lpg) with its `buildWith` helper: frames are created `route` and packed innermost
first with `layoutRows`.

- [ ] **Step 1: Failing tests:**
  - conformance, for every type in `SPECS`: a `DSPS` entry exists; port and param ids are unique;
    `layoutPanel(spec).fits` (the panel grammar holds at its size); the same input processed per block and per
    sample gives identical output;
  - performance: the acid project runs a minute of audio in under 0.3 of real time;
  - GC: every factory project runs 60 s with readouts on and no garbage collection after a 1 s warm-up (copy the
    `PerformanceObserver` approach of `../sreda/modules/engine.test.ts`);
  - factory: every entry passes `validateDoc` unchanged and has no overlapping modules and no frame covering a
    module outside it; every project renders 3 s with RMS > 0.01 and peak ≤ 1; Polymeter's VOICE A and VOICE B
    clocks tick at ÷3 and ×2 of POLY; Self-clocked has no OSC driving its clock.
- [ ] **Step 2:** → FAIL. **Step 3:** Implement factory and fix whatever the conformance and GC tests expose.
- [ ] **Step 4:** `pnpm check` → PASS; `pnpm render acid 8` writes `acid.wav` (8 s, 48 kHz stereo) — listen to it.
- [ ] **Step 5:** Commit `feat(modules): factory patches, conformance, render script`.
