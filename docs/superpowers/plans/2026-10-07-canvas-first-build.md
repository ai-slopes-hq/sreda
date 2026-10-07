# SREDA 2 First Build Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A browser canvas of small modules that is always live: patch by dragging from jacks, click any output to
hear it, R to randomise, NEW for a random seed patch, autosaved.

**Architecture:** pnpm monorepo. `core` holds the immutable document, edits, undo, module specs as data, and
`compile` (document → plan), which runs on the UI thread. `engine` runs plans in an AudioWorklet (`EngineCore` is host-independent
and tested in Node). `ui` is Preact + signals: DOM modules on a transformed layer, SVG cables, per-frame readouts
from a SharedArrayBuffer. `modules/` holds each module's `spec.ts` (core only) and `dsp.ts` (engine).

**Tech Stack:** TypeScript ~6.0.3, pnpm@12.8.1, Node ≥22, Vite ^8.3.1, Vitest ^5.0.3, ESLint ^10.11.0 +
typescript-eslint ^8.71.0, Prettier ^3.9.9, Playwright ^1.63.0 (system Chrome), Preact ^11.0.0, @preact/signals
^2.11.3, @preact/preset-vite ^2.10.6, idb-keyval ^6.3.0, happy-dom ^20.14.5, @testing-library/preact ^3.2.4.

**Spec:** `docs/superpowers/specs/2026-10-07-canvas-ux-design.md`

## Global Constraints

- Package boundaries `core ← protocol ← engine`, `core ← ui`, enforced by ESLint; `modules/*/spec.ts` core only,
  `modules/*/dsp.ts` core + engine only.
- Audio thread rules from `CLAUDE.md`: nothing in `process()` or below allocates, locks, awaits, does I/O or logs;
  numeric class fields get numeric initialisers; no closures, spread, `for…of` over Maps or array literals in
  `process()`.
- UI text English. Colours: background `#121210`, panel `#1b1b18`, text `#e9e4d8`, muted `#8f897c`, destructive
  `#e5484d`; roles audio `#e9e4d8`, mod `#6cb4ee`, pitch `#9ad18b`, trigger `#f5a524`.
- Trigger input: fires on a rising edge above 0.5, re-arms below 0.25. Trigger outputs 0/1, 1 ms long.
- Pitch: +1.0 = one octave. Mod: ±1 or 0…1 per output. Audio: nominal ±1.
- Knob modulation: ±1 at full depth sweeps the whole knob range in knob space (taper included); depth −1…+1.
- Grid 16 px; zoom 25–200 %; trigger flash 120 ms; level bar held peak decaying over 300 ms.
- Undo: one step per knob drag; wheel runs on one knob merge until a 0.7 s pause.
- Autosave 500 ms after the last edit to IndexedDB; seeds fade in over 200 ms; removed modules/cables fade 10 ms.
- Master: 5 Hz DC blocker, soft limiter, nothing non-finite reaches the device; the listen path goes through it.
- Served with COOP/COEP; Chromium first; audio starts on the first click (`CLICK TO START AUDIO`).

## Review Focus

1. A runaway feedback patch (DELAY feedback 0.95 into itself through a FILTER at max res) → the output stays finite
   and within ±1 (test in Task 7).
2. An autosave from a broken or future file (unknown module type, cable to a missing port, wrong `version`) → kept
   under the backup key, a seed opens, the notice shows (test in Task 15).
3. Deleting the module being listened to → listening ends and the main output returns (test in Task 19).
4. Audio-rate triggers (a 2 kHz square into ENV and SEQ trigger inputs) → no NaN, output finite, SEQ still advances
   (test in Task 10 and Task 11).
5. A module patched into itself (ENV eoc → own trig; DELAY out → own in) → plays through the one-sample-late back
   edge rather than being refused or going silent (test in Task 6).

---

## File structure

```
package.json · pnpm-workspace.yaml · tsconfig.base.json · eslint.config.js · vitest.config.ts · playwright.config.ts
apps/web/            index.html · vite.config.ts · src/main.tsx · src/worklet.ts
packages/core/src/   spec.ts (ModuleSpec, Port, Param, knob mapping) · doc.ts (Doc types, validateDoc)
                     ops.ts (edits, RuleError) · history.ts · rng.ts · plan.ts (Plan, ReadoutLayout types)
                     compile.ts · index.ts
packages/protocol/src/ messages.ts (ToEngine) · index.ts
packages/engine/src/ dsp.ts (DspModule, DspContext) · trigger.ts (EdgeDetector) · master.ts
                     engine.ts (EngineCore) · testing.ts (render helper) · worklet.ts (processor) · index.ts
packages/ui/src/     theme.css · store.ts (PatchStore) · sync.ts (EngineSync) · host.ts (EngineHost) · persist.ts
                     canvas/state.ts (CanvasState) · canvas/layout.ts · canvas/Canvas.tsx · canvas/ModuleView.tsx
                     canvas/Knob.tsx · canvas/CableLayer.tsx · canvas/search.ts · canvas/Search.tsx
                     canvas/readouts.ts · App.tsx · index.ts
modules/             <type>/spec.ts · <type>/dsp.ts · specs.ts (SPECS) · dsps.ts (DSPS) · seeds.ts · *.test.ts
e2e/                 *.spec.ts
```

Module types (folder = type id): `osc lfo noise const env vca filter seq div compare sah quant mix math delay out`.

---

## Milestone 1 — document and engine (headless, tested in Node)

### Task 1: Monorepo scaffold

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `eslint.config.js`, `.prettierrc.json`,
  `.gitignore`, `vitest.config.ts`, `packages/{core,protocol,engine,ui}/{package.json,tsconfig.json,src/index.ts}`,
  `modules/{package.json,tsconfig.json}`, `packages/core/src/smoke.test.ts`
- Modify: `CLAUDE.md` (Commands section)

**Interfaces:**
- Produces: workspace packages `@sreda/core`, `@sreda/protocol`, `@sreda/engine`, `@sreda/ui`, `@sreda/modules`
  (each `exports: { ".": "./src/index.ts" }`; modules exports `"./specs"`, `"./dsps"`, `"./seeds"`); root scripts
  `dev build test typecheck lint check e2e format`.

- [ ] **Step 1:** Copy the tooling shape of `../sreda` (same root scripts, `tsconfig.base.json` flags, Prettier
  `{ printWidth: 110, singleQuote: true, semi: true, trailingComma: "all" }`, `.gitignore`). `pnpm-workspace.yaml`
  lists `apps/*`, `packages/*`, `modules`. `vitest.config.ts` includes `packages/*/src/**/*.test.{ts,tsx}` and
  `modules/**/*.test.{ts,tsx}`.
- [ ] **Step 2:** `eslint.config.js` with the `forbid(...)` helper from `../sreda/eslint.config.js`: core forbids
  protocol/engine/ui/preact; protocol forbids engine/ui/preact; engine forbids ui/preact; ui forbids engine;
  `modules/*/spec.ts`, `modules/specs.ts`, `modules/seeds.ts` forbid engine/ui/preact; `modules/*/dsp.ts`,
  `modules/dsps.ts` forbid ui/preact.
- [ ] **Step 3:** `smoke.test.ts`: `expect(1 + 1).toBe(2)`. Run `pnpm install && pnpm check` — expected: typecheck,
  lint and 1 test pass.
- [ ] **Step 4:** Replace the CLAUDE.md placeholder line with: `pnpm dev` · `pnpm check` (typecheck + lint + unit
  tests) · `pnpm test -- <file>` (one unit test file) · `pnpm e2e` · `pnpm exec playwright test e2e/<file>` (one e2e
  spec) · `pnpm build`.
- [ ] **Step 5:** Commit `chore: scaffold monorepo`.

### Task 2: Module specs, knob mapping, document shape

**Files:**
- Create: `packages/core/src/spec.ts`, `packages/core/src/doc.ts`, `packages/core/src/rng.ts`
- Test: `packages/core/src/spec.test.ts`, `packages/core/src/doc.test.ts`

**Interfaces:**
- Produces:
```ts
// spec.ts
export type Role = 'audio' | 'mod' | 'pitch' | 'trigger';
export interface Port { id: string; label: string; role: Role; polarity?: 'bi' | 'uni' }
export interface KnobParam { kind: 'knob'; id: string; label: string; min: number; max: number; def: number;
  taper: 'lin' | 'exp'; step?: number; unit?: string; randomRange?: [number, number]; modDepth?: number }
export interface OptionParam { kind: 'option'; id: string; label: string; options: string[]; def: number }
export type Param = KnobParam | OptionParam;
export interface ModuleSpec { type: string; label: string; inputs: Port[]; outputs: Port[]; params: Param[]; cols?: number }
export function toKnob(p: KnobParam, value: number): number;   // value → 0…1 (exp taper: log-space)
export function fromKnob(p: KnobParam, knob: number): number;  // 0…1 → value, clamped, snapped to step
export const modJack = (paramId: string) => `@${paramId}`;     // input port id of a knob's mod jack
// doc.ts
export interface ModuleDoc { id: string; type: string; x: number; y: number;
  params: Record<string, number>; depths: Record<string, number> }
export interface Cable { from: [string, string]; to: [string, string] }
export interface Doc { version: 1; modules: ModuleDoc[]; cables: Cable[]; nextId: number }
export type Specs = Readonly<Record<string, ModuleSpec>>;
export const emptyDoc: Doc;
export function validateDoc(json: unknown, specs: Specs): Doc | null;
// rng.ts
export function mulberry32(seed: number): () => number;
```

- [ ] **Step 1: Write failing tests**
```ts
const cutoff: KnobParam = { kind: 'knob', id: 'cutoff', label: 'CUT', min: 20, max: 20000, def: 1000, taper: 'exp' };
test('exp taper maps through log space', () => {
  expect(toKnob(cutoff, 20)).toBe(0);
  expect(toKnob(cutoff, 20000)).toBe(1);
  expect(fromKnob(cutoff, 0.5)).toBeCloseTo(Math.sqrt(20 * 20000), 3);
});
test('fromKnob clamps and snaps to step', () => {
  const n: KnobParam = { kind: 'knob', id: 'n', label: 'N', min: 1, max: 16, def: 2, taper: 'lin', step: 1 };
  expect(fromKnob(n, 1.5)).toBe(16);
  expect(fromKnob(n, 0.52)).toBe(9);
});
test('validateDoc rejects unknown types, missing ports, wrong version', () => {
  // with a one-module spec table: each of these returns null
  // { ...good, version: 2 } · a module of type 'nope' · a cable to ['m1', 'missing'] · a cable to a missing module
});
test('validateDoc fills missing params with defaults', () => {
  // module with params {} → params equal each spec param's def; depths {} kept
});
test('mulberry32 is deterministic', () => { expect(mulberry32(7)()).toBe(mulberry32(7)()); });
```
- [ ] **Step 2:** Run `pnpm test -- packages/core` — FAIL (modules missing).
- [ ] **Step 3:** Implement. A cable is valid when `from` names an output of an existing module and `to` names an
  input or `modJack(knobParam.id)` of an existing module. No other validation.
- [ ] **Step 4:** Run `pnpm test -- packages/core` — PASS.
- [ ] **Step 5:** Commit `feat(core): module specs, knob mapping, document shape`.

### Task 3: Edits

**Files:**
- Create: `packages/core/src/ops.ts`
- Test: `packages/core/src/ops.test.ts`

**Interfaces:**
- Consumes: Task 2 types.
- Produces (all pure; return a new `Doc`, throw `RuleError` on structural errors):
```ts
export class RuleError extends Error {}
export function addModule(doc: Doc, specs: Specs, type: string, x: number, y: number): { doc: Doc; id: string };
export function removeModules(doc: Doc, ids: readonly string[]): Doc;            // drops their cables
export function moveModules(doc: Doc, ids: readonly string[], dx: number, dy: number): Doc;
export function duplicateModules(doc: Doc, ids: readonly string[], dx: number, dy: number): { doc: Doc; ids: string[] };
export function connect(doc: Doc, specs: Specs, from: [string, string], to: [string, string]): Doc;
export function disconnect(doc: Doc, to: [string, string]): Doc;
export function setParam(doc: Doc, specs: Specs, id: string, param: string, value: number): Doc;
export function setDepth(doc: Doc, id: string, param: string, depth: number): Doc; // clamps −1…1
export function randomize(doc: Doc, specs: Specs, id: string, rng: () => number): Doc;
export function replaceDoc(doc: Doc, next: Doc): Doc; // NEW; keeps nextId monotonic
```

- [ ] **Step 1: Write failing tests**
```ts
test('ids are m<nextId> and never reused', ...);            // add, remove, add → 'm1', 'm2'
test('positions snap to the 16 px grid', ...);              // addModule(…, 21, 40) → x 16, y 48
test('connect replaces the cable on an occupied input', ...);// two connects to ['b','in'] → one cable, the second
test('an output takes any number of cables', ...);
test('connecting to a mod jack sets depth to the param modDepth (default 1)', ...);
test('connect throws RuleError for output→output or unknown ports', ...);
test('a module may be patched into itself', ...);           // connect(['m1','eoc'], ['m1','trig']) succeeds
test('duplicate copies cables inside the selection only', ...);
test('randomize stays inside randomRange and leaves options alone', ...);
test('setParam clamps to the param range', ...);
```
- [ ] **Step 2:** Run `pnpm test -- packages/core/src/ops.test.ts` — FAIL.
- [ ] **Step 3:** Implement. Removing the last cable to a mod jack deletes that param's depth entry.
- [ ] **Step 4:** Run it — PASS.
- [ ] **Step 5:** Commit `feat(core): document edits`.

### Task 4: Undo history

**Files:**
- Create: `packages/core/src/history.ts`
- Test: `packages/core/src/history.test.ts`

**Interfaces:**
- Produces:
```ts
export type Merge = { key: string; stroke?: boolean } | undefined;
export class History {
  constructor(initial: Doc, now?: () => number);
  readonly current: Doc;
  commit(doc: Doc, merge?: Merge): void; // same key as the top step and (stroke, or < 700 ms since it) → replaces top
  undo(): Doc | null;
  redo(): Doc | null;
}
```

- [ ] **Step 1: Write failing tests** with an injected clock: two commits with key `k` 300 ms apart → one undo
  returns the initial doc; 800 ms apart → two steps; `stroke: true` merges at any gap until a different key; a
  commit after undo clears redo.
- [ ] **Step 2:** Run — FAIL. **Step 3:** Implement. **Step 4:** Run — PASS.
- [ ] **Step 5:** Commit `feat(core): undo history with gesture merging`.

### Task 5: Trigger detection and master stage

**Files:**
- Create: `packages/engine/src/trigger.ts`, `packages/engine/src/master.ts`
- Test: `packages/engine/src/trigger.test.ts`, `packages/engine/src/master.test.ts`

**Interfaces:**
- Produces:
```ts
export class EdgeDetector { armed = true; rise(x: number): boolean } // > 0.5 fires once, re-arms < 0.25
export class Master {
  constructor(sampleRate: number);
  fadeIn(ms: number): void;             // gain ramps 0 → 1
  process(l: Float32Array, r: Float32Array, n: number): void; // in place: NaN→0, 5 Hz DC block, soft limit, fade
}
```
Soft limiter per sample: `|x| ≤ 0.9 → x`; above, `sign(x) · (0.9 + 0.1 · tanh((|x| − 0.9) / 0.1))`.

- [ ] **Step 1: Write failing tests:** a 0→0.6→0.4→0.6 sequence fires once (no re-arm above 0.25); 0.6→0.2→0.6
  fires twice; Master: DC input of 0.5 decays below 0.01 within 0.5 s; an input of 10 stays ≤ 1; NaN and Infinity
  become finite; `fadeIn(200)` → first sample ≈ 0, sample at 200 ms ≈ input.
- [ ] **Step 2:** Run — FAIL. **Step 3:** Implement. **Step 4:** Run — PASS.
- [ ] **Step 5:** Commit `feat(engine): edge detector and master stage`.

### Task 6: Compile a document into a plan

**Files:**
- Create: `packages/core/src/plan.ts`, `packages/core/src/compile.ts`
- Test: `packages/core/src/compile.test.ts`

**Interfaces:**
- Consumes: `Doc`, `Specs`, `toKnob`, `modJack`.
- Produces:
```ts
// core/plan.ts — compile lives in core so the UI can compile without importing the engine
// Readouts: a Float32Array over a SharedArrayBuffer; [0] = plan seq of the layout being written
export interface ReadoutLayout { seq: number; size: number;
  modules: Record<string, { knobs: number; triggers: number; outputs: number }> } // start offsets
// knobs: one slot per KnobParam (modulated knob position 0…1); triggers: one per trigger-role input (event count);
// outputs: one per output (held |peak|)
export interface Binding { src: string; port: number; late: boolean }                 // src = module id
export interface ModBinding extends Binding { depth: number }
export interface PlanModule { id: string; type: string;
  knobs: number[];          // per param in spec order: knob position 0…1 for knobs, option index for options
  inputs: (Binding | null)[]; mods: (ModBinding | null)[] }  // mods per param, null for options
export type Step = { module: number } | { loop: number[] };   // indices into modules
export interface Plan { seq: number; modules: PlanModule[]; steps: Step[]; layout: ReadoutLayout; fadeInMs?: number }
export function compile(doc: Doc, specs: Specs, seq: number): Plan;
```
Order: Tarjan SCCs, emitted in topological order of the condensation. A single module with no self-edge is a
`{ module }` step; an SCC of 2+ modules or with a self-edge is a `{ loop }` step listing its modules in document
order; inside a loop, an edge whose source comes at or after its listener in that order is `late: true`.

- [ ] **Step 1: Write failing tests** (with a tiny inline spec table: `src` (1 out), `fx` (1 in, 1 out, 1 knob)) —
  this covers Review Focus 5:
  a chain src→fx→fx2 orders src, fx, fx2 with no loops; fx→fx2→fx gives one `loop` with exactly one late edge;
  `fx.out → fx.in` gives a one-module loop whose binding is late; a mod cable becomes a `ModBinding` carrying the
  depth; layout offsets are disjoint and `size` covers them all (index 0 reserved).
- [ ] **Step 2:** Run — FAIL. **Step 3:** Implement. **Step 4:** Run — PASS.
- [ ] **Step 5:** Commit `feat(core): compile documents into plans`.

### Task 7: EngineCore

**Files:**
- Create: `packages/engine/src/dsp.ts`, `packages/engine/src/engine.ts`, `packages/engine/src/testing.ts`
- Test: `packages/engine/src/engine.test.ts`

**Interfaces:**
- Consumes: `Plan`, `EdgeDetector`, `Master`, `fromKnob`.
- Produces:
```ts
// dsp.ts
export const BLOCK = 128;
export interface DspContext { sampleRate: number; random: () => number; master: readonly [Float32Array, Float32Array] }
export interface DspModule {
  bind?(connected: readonly boolean[]): void;             // per input port, on every plan apply
  process(inp: readonly Float32Array[], par: readonly Float32Array[], out: readonly Float32Array[],
          from: number, to: number): void;                // par = mapped param values per sample
  reset(): void;
}
export type DspFactory = (ctx: DspContext, spec: ModuleSpec) => DspModule;
// engine.ts
export class EngineCore {
  constructor(sampleRate: number, specs: Specs, dsps: Readonly<Record<string, DspFactory>>, seed: number);
  applyPlan(plan: Plan): void;
  setKnob(id: string, index: number, knob: number): void;   // knob 0…1 or option index
  setDepth(id: string, index: number, depth: number): void;
  setListen(target: { id: string; port: number } | null): void;
  attachReadouts(view: Float32Array): void;
  process(l: Float32Array, r: Float32Array): void;           // one BLOCK
}
// testing.ts
export function render(core: EngineCore, seconds: number): { l: Float32Array; r: Float32Array };
```
Rules the implementation must follow:
- Instances and their output buffers are keyed by module id and survive plan swaps while the id stays.
- Unconnected inputs read a shared zero buffer. Knob params are smoothed per sample in knob space with a 10 ms
  one-pole, then `knob + depth · mod` clamped to 0…1 and mapped with `fromKnob`. Options are constant.
- `{ module }` steps call `process(…, 0, BLOCK)`; `{ loop }` steps run per sample, every module in order for
  sample i before i+1. A late binding reads a per-binding buffer holding the source's previous sample (sample −1 =
  last sample of the previous block).
- After each `process` the engine scans the written outputs; on a non-finite value it zeroes them and calls
  `reset()`.
- `ctx.master` is zeroed each block; OUT writes into it. With a listen target set, master L and R are the target
  output instead. Then `Master.process`. A plan with `fadeInMs` calls `Master.fadeIn`.
- Readouts are written once per block: `[0] = plan.seq`; knob slots = modulated knob at the block's last sample;
  trigger slots += rises seen (own `EdgeDetector` per trigger input); output slots =
  `max(blockPeak, held − BLOCK / (0.3 · sampleRate))`.

- [ ] **Step 1: Write failing tests** with test DSPs defined in the test file (`dc` writes its knob value, `gain`
  multiplies input by its knob, `boom` writes NaN on its 3rd block, `out` adds inputs into ctx.master):
```ts
test('a cable carries samples', ...);                       // dc 0.5 → out: |l[0] − 0.5| < 0.01 on the first block
test('mod at full depth sweeps the knob range', ...);       // dc(1) → gain.@k with depth 1, k=0 → gain behaves as k=1
test('knob changes are smoothed over ~10 ms', ...);
test('a NaN-writing module outputs 0 and is reset', ...);   // reset spy called; output finite
test('listen replaces the main output', ...);
test('a block of 128 per-block equals per-sample for a loop', ...); // gain feeding itself late: deterministic sequence
test('readouts: seq, knob position, trigger count, held peak', ...);
test('runaway feedback stays finite and within ±1', ...);   // gain(k=1.9 mapped >1) fed back into itself for 2 s
```
- [ ] **Step 2:** Run `pnpm test -- packages/engine` — FAIL. **Step 3:** Implement. **Step 4:** Run — PASS.
- [ ] **Step 5:** Commit `feat(engine): EngineCore`.

### Task 8: Fades on plan swaps

**Files:**
- Modify: `packages/engine/src/engine.ts`
- Test: `packages/engine/src/fade.test.ts`

**Interfaces:**
- Consumes/extends Task 7; no new exports. `FADE_MS = 10`.

Rules: when an input or mod binding's source changes between plans, that input reads `old·(1−g) + new·g` with g
rising linearly 0→1 over 10 ms. A module missing from the new plan keeps running (first in each block, inputs
unbound) for 10 ms with its outputs scaled by a 1→0 ramp, then is dropped. Re-adding the same id within the fade
(undo) keeps the instance.

- [ ] **Step 1: Write failing tests:** removing a `dc(1)` feeding `out` gives a monotonic ramp to 0 over 10 ms ±1
  block, not a step; re-routing an input from `dc(1)` to `dc(-1)` crosses zero mid-fade; undo within the fade keeps
  the same instance (a counter DSP's count continues).
- [ ] **Step 2:** Run — FAIL. **Step 3:** Implement. **Step 4:** Run — PASS.
- [ ] **Step 5:** Commit `feat(engine): fade removed modules and re-routed cables`.

### Tasks 9–12: The 16 atoms

Each module is `modules/<type>/spec.ts` (exports `spec: ModuleSpec`) + `modules/<type>/dsp.ts` (exports
`dsp: DspFactory`, a class per module) + `modules/<type>/<type>.test.ts`, then registered in `modules/specs.ts`
(`SPECS`) and `modules/dsps.ts` (`DSPS`). Tests drive a DSP directly through `process` with hand-built buffers.
Ports and params are exactly as in this table (`k` = knob `min–max def taper [randomRange] {modDepth}`;
`o` = option list, default first):

| type | inputs (role) | params | outputs (role) |
|---|---|---|---|
| osc | pitch (pitch), fm (audio), sync (trigger) | freq k 0.1–20000 110 exp [40, 880] {0.25}; wave o sine/saw/square; pw k 0.05–0.95 0.5 lin; fmAmt k 0–1 0 lin | out (audio) |
| lfo | reset (trigger) | rate k 0.01–100 1 exp [0.05, 8] {0.25}; wave o sine/tri/saw/square | out (mod bi) |
| noise | — | level k 0–1 1 lin | out (audio) |
| const | — | value k −1–1 0 lin | out (mod bi) |
| env | trig (trigger) | attack k 0.0005–10 0.005 exp [0.001, 0.5]; decay k 0.001–20 0.3 exp [0.02, 2]; loop o off/on | out (mod uni), eor (trigger), eoc (trigger) |
| vca | in (audio) | level k 0–1 1 lin | out (audio) |
| filter | in (audio) | cutoff k 20–20000 1000 exp [100, 8000] {0.25}; res k 0–1 0.2 lin; mode o lp/bp/hp | out (audio) |
| seq | trig (trigger), reset (trigger) | s1…s8 k −1–1 0 lin; g1…g8 o on/off; length k 1–8 8 lin step 1 (`cols: 8`) | value (mod bi), gate (trigger), eoc (trigger) |
| div | trig (trigger), reset (trigger) | n k 1–16 2 lin step 1 | out (trigger) |
| compare | in (audio) | threshold k −1–1 0 lin | out (trigger) |
| sah | in (audio), trig (trigger) | — | out (mod bi) |
| quant | in (pitch) | scale o chromatic/major/minor/dorian/phrygian/penta-minor/penta-major/whole; root k 0–11 0 lin step 1 | out (pitch) |
| mix | a, b, c, d (audio) | la, lb, lc, ld k 0–1 1 lin | out (audio) |
| math | in (audio) | scale k −2–2 1 lin; offset k −1–1 0 lin; invert o off/on | out (audio) |
| delay | in (audio) | time k 0.001–2 0.3 exp [0.05, 1]; feedback k 0–0.95 0.4 lin; mix k 0–1 0.3 lin | out (audio) |
| out | l (audio), r (audio) | level k 0–1 0.7 lin | — |

Note on labels: `label` = upper-case id unless shown otherwise (`fmAmt` → `FM`, `threshold` → `THR`).

### Task 9: Sources — osc, lfo, noise, const

**Files:** `modules/{osc,lfo,noise,const}/{spec.ts,dsp.ts,<type>.test.ts}`, `modules/specs.ts`, `modules/dsps.ts`

**Interfaces:**
- Produces: `SPECS: Specs`, `DSPS: Record<string, DspFactory>` (later tasks add entries).

Behaviour: osc frequency = `freq · 2^(pitch + fm · fmAmt · 4)`; phase-accumulating, saw and square with polyBLEP;
a sync rise resets phase. lfo naive waveforms, reset rise zeroes phase. noise = `(ctx.random() · 2 − 1) · level`.

- [ ] **Step 1: Write failing tests:** osc saw at 440 Hz has a zero-crossing period of 48000/440 ± 1 samples;
  pitch +1 doubles it; a square at 2 Hz is ≥ 0.5 for half its period (works as a clock); sync rise restarts the phase;
  lfo square at 1 Hz alternates ±1 every 0.5 s; noise with the same seed repeats, mean ≈ 0, within ±level; const
  outputs its value.
- [ ] **Step 2:** Run `pnpm test -- modules` — FAIL. **Step 3:** Implement. **Step 4:** Run — PASS.
- [ ] **Step 5:** Commit `feat(modules): osc, lfo, noise, const`.

### Task 10: Shaping — env, vca, filter

**Files:** `modules/{env,vca,filter}/…`, registry files.

Behaviour: env attack linear from the current value to 1 over `attack`, emits `eor`; decay multiplies by
`0.001^(1/(decay·sr))` per sample; below 0.001 the output is 0 and `eoc` fires; with loop on, a cycle end
retriggers. A rise during a cycle restarts the attack from the current value. Trigger outputs are 1 for 1 ms
(48 samples at 48 kHz). vca `out = in · level`. filter: TPT state-variable, `k = 2 − 2·res·0.98`, mode picks LP/BP/HP.

- [ ] **Step 1: Write failing tests:** env attack 0.01 s reaches 1 at sample 480 ± 1 and fires eor there; decay 0.1 s
  reaches 0.001 at ≈ 4800 samples and fires eoc; loop on cycles without input; a 2 kHz square into trig for 1 s
  keeps out finite and within 0…1; vca level 0.5 halves; filter LP at 1 kHz attenuates a 10 kHz sine by ≥ 30 dB and
  passes a 100 Hz sine within 1 dB; HP the reverse; res 1 stays finite on white noise for 2 s.
- [ ] **Step 2:** Run — FAIL. **Step 3:** Implement. **Step 4:** Run — PASS.
- [ ] **Step 5:** Commit `feat(modules): env, vca, filter`.

### Task 11: Logic and time — seq, div, compare, sah, quant

**Files:** `modules/{seq,div,compare,sah,quant}/…`, registry files.

Behaviour: seq advances on each trig rise (first rise plays step 1), wraps at `length` and fires `eoc` on the wrap;
reset rise → next trig plays step 1; `value` holds the current step; `gate` goes high on a step whose g is `on` and
stays high for half of the last trig interval (10 ms before two trigs have been seen). div lets the 1st of every n
rises through as a 1 ms trigger; reset restarts the count. compare outputs 1 while `in > threshold`, 0 below
`threshold − 0.01`. sah holds `in` at each trig rise. quant: semitones = `in · 12 − root`, snapped to the nearest
degree of the scale (ties go down), `+ root`, back to octaves.

- [ ] **Step 1: Write failing tests:** seq with length 3 outputs s1 s2 s3 s1 and fires eoc once per wrap; a g
  `off` step leaves gate low; a 2 kHz square on trig still advances once per period; div n=3 passes rises 1, 4, 7;
  compare hysteresis does not chatter on a sine with 0.005 noise at the threshold; sah holds between rises; quant
  major root 0 maps 0.09 oct (1.08 st, nearest degrees 0 and 2) to 2/12; chromatic maps 0.5/12 (a tie) to 0.
- [ ] **Step 2:** Run — FAIL. **Step 3:** Implement. **Step 4:** Run — PASS.
- [ ] **Step 5:** Commit `feat(modules): seq, div, compare, sah, quant`.

### Task 12: Math, mix, FX, out

**Files:** `modules/{mix,math,delay,out}/…`, registry files.

Behaviour: mix `out = a·la + b·lb + c·lc + d·ld`. math `(in · scale + offset) · (invert ? −1 : 1)`. delay: 2 s ring
buffer allocated in the constructor, linear-interpolated read, `time` already smoothed by the engine;
`out = in·(1−mix) + wet·mix`, feedback writes `in + wet·feedback`. out adds `l·level` and `r·level` into
`ctx.master` in `[from, to)`; when `r` is unconnected (`bind`), r = l.

- [ ] **Step 1: Write failing tests:** mix sums with levels; math invert; delay 0.1 s echoes an impulse at sample
  4800 ± 1 with mix 1, feedback 0.5 gives a second echo at half amplitude; out with only l connected writes l to
  both master channels; out with l and r keeps them separate.
- [ ] **Step 2:** Run — FAIL. **Step 3:** Implement. **Step 4:** Run — PASS.
- [ ] **Step 5:** Commit `feat(modules): mix, math, delay, out`.

### Task 13: Atom conformance and seeds

**Files:**
- Create: `modules/seeds.ts`, `modules/conformance.test.ts`, `modules/seeds.test.ts`

**Interfaces:**
- Consumes: `SPECS`, `DSPS`, `EngineCore`, `compile`, `render`, core ops.
- Produces: `export const SEEDS: readonly { name: string; build: () => Doc }[]` with the five seeds of spec §5
  (`pulse`, `polymeter`, `self-clocked`, `drone`, `ratchet`), built with core ops so ids and grid positions are
  valid; `export function pickSeed(rng: () => number, previous: string | null): { name: string; doc: Doc }` (never
  returns `previous`).

- [ ] **Step 1: Write failing tests:**
  - conformance, for every type in `SPECS`: a `DSPS` entry exists; spec ids are unique; per-block vs per-sample
    processing of 1 s with random knob values and noise inputs gives identical output;
  - GC count: run every seed through `EngineCore` for 60 s of audio while a
    `PerformanceObserver({ entryTypes: ['gc'] })` counts collections; expect 0 minor GCs after the first second (copy the approach of
    `../sreda/modules/engine.test.ts`);
  - each seed validates (`validateDoc` returns it unchanged) and renders 3 s whose RMS is > 0.01 and peak ≤ 1;
  - `pulse` makes ≥ 4 ENV trigger events in 3 s (readouts trigger slot); `self-clocked` contains no osc or lfo;
  - `pickSeed` with `previous = 'pulse'` never returns `pulse` over 100 draws.
- [ ] **Step 2:** Run — FAIL. **Step 3:** Build the seeds and fix any DSP that allocates. **Step 4:** Run — PASS.
- [ ] **Step 5:** Commit `feat(modules): seeds and atom conformance`.

---

## Milestone 2 — the app

### Task 14: Worklet, engine host, protocol

**Files:**
- Create: `packages/protocol/src/messages.ts`, `packages/engine/src/worklet.ts`, `packages/ui/src/host.ts`,
  `apps/web/{index.html,vite.config.ts,package.json,tsconfig.json,src/main.tsx,src/worklet.ts}`,
  `playwright.config.ts`, `e2e/start.spec.ts`

**Interfaces:**
- Produces:
```ts
// protocol/messages.ts
export type ToEngine =
  | { t: 'plan'; plan: Plan }                       // Plan from @sreda/core
  | { t: 'knob'; id: string; index: number; knob: number }
  | { t: 'depth'; id: string; index: number; depth: number }
  | { t: 'listen'; target: { id: string; port: number } | null }
  | { t: 'readouts'; sab: SharedArrayBuffer };
// ui/host.ts
export class EngineHost {
  static start(workletUrl: string): Promise<EngineHost>; // AudioContext + AudioWorkletNode('sreda', 2 ch out)
  send(msg: ToEngine): void;
  readonly readouts: Float32Array;                         // over a 64 KiB SharedArrayBuffer
}
```
`apps/web/src/worklet.ts` registers
`EngineCore` with `SPECS`/`DSPS` as processor `'sreda'`. `vite.config.ts`: COOP/COEP headers, Prefresh excluded
from `packages/(core|protocol|engine)`, `modules/`, `worklet.ts` (copy from `../sreda/apps/web/vite.config.ts`).

- [ ] **Step 1: Write failing e2e** `e2e/start.spec.ts`: the page shows `CLICK TO START AUDIO`; after a click the
  line is gone and `window.__sreda.ctxState === 'running'` (main.tsx exposes this debug hook in dev only).
- [ ] **Step 2:** Run `pnpm exec playwright test e2e/start.spec.ts` — FAIL.
- [ ] **Step 3:** Implement; `main.tsx` renders a bare page with the start line; one click calls
  `EngineHost.start` and sends a `pulse` seed plan.
- [ ] **Step 4:** Run it — PASS; `pnpm check` — PASS.
- [ ] **Step 5:** Commit `feat(web): worklet host and start gate`.

### Task 15: PatchStore, EngineSync, autosave

**Files:**
- Create: `packages/ui/src/store.ts`, `packages/ui/src/sync.ts`, `packages/ui/src/persist.ts`
- Test: `packages/ui/src/store.test.ts`, `packages/ui/src/sync.test.ts`, `packages/ui/src/persist.test.ts`

**Interfaces:**
- Consumes: core ops, `History`, `compile`, `ToEngine`.
- Produces:
```ts
export class PatchStore {
  constructor(initial: Doc, specs: Specs, now?: () => number);
  readonly doc: ReadonlySignal<Doc>;
  edit(fn: (doc: Doc) => Doc, merge?: Merge): void;   // RuleError → no change, rethrown
  undo(): void; redo(): void;
}
export class EngineSync { constructor(store: PatchStore, specs: Specs, send: (m: ToEngine) => void);
  readonly layout: ReadonlySignal<ReadoutLayout>; } // last sent plan's layout
export interface Persist { load(): Promise<{ doc: Doc } | { doc: null; corrupt: boolean }>; save(doc: Doc): void }
export function createPersist(specs: Specs, kv?: { get; set }): Persist; // key 'sreda2:canvas', backup 'sreda2:canvas:corrupt'
export function autosave(store: PatchStore, persist: Persist, delayMs = 500): () => void;
```
EngineSync rule: a new doc whose modules (ids, types), cables and depth keys equal the previous one's sends only
`knob`/`depth` messages for changed values (moves send nothing); anything else sends a `plan` with seq + 1.
A doc replaced by NEW (`replaceDoc`) sends a plan with `fadeInMs: 200`.

- [ ] **Step 1: Write failing tests:** a knob edit sends one `knob` message, no plan; a move sends nothing; a
  connect sends a plan with a higher seq; NEW sends `fadeInMs: 200`; autosave writes once 500 ms after a burst of
  edits (fake timers); `load` on invalid JSON, `version: 2`, an unknown type or a dangling cable returns
  `{ doc: null, corrupt: true }` and copies the raw value to the backup key; empty storage returns
  `{ doc: null, corrupt: false }`.
- [ ] **Step 2:** Run — FAIL. **Step 3:** Implement. **Step 4:** Run — PASS.
- [ ] **Step 5:** Commit `feat(ui): patch store, engine sync, autosave`.

### Task 16: Canvas and module rendering

**Files:**
- Create: `packages/ui/src/theme.css`, `packages/ui/src/canvas/{state.ts,layout.ts,Canvas.tsx,ModuleView.tsx,Knob.tsx,CableLayer.tsx}`,
  `packages/ui/src/App.tsx`
- Test: `packages/ui/src/canvas/layout.test.ts`, `packages/ui/src/canvas/Canvas.test.tsx`

**Interfaces:**
- Produces:
```ts
// layout.ts — pure; positions in canvas px relative to the module's x, y
export const GRID = 16, HEADER = 24, ROW = 20, CELL_W = 48, CELL_H = 56, GUTTER = 24;
export interface ModuleLayout { w: number; h: number; jacks: Record<string, { x: number; y: number }>;
  cells: Record<string, { x: number; y: number }> }  // cells: param id → top-left of its knob/option cell
export function layoutModule(spec: ModuleSpec): ModuleLayout;
// width = snapUp(2·GUTTER + cols·CELL_W) with cols = spec.cols ?? 3; height = snapUp(HEADER + max(inputs·ROW,
// outputs·ROW, knobRows·CELL_H) + 8); input jacks on x = 8, outputs on x = w − 8, rows from HEADER + ROW/2;
// a knob's mod jack (`@id`) at its cell's top-left + (6, 6)
// state.ts
export class CanvasState { view = signal({ x: 0, y: 0, zoom: 1 }); selection = signal<string[]>([]);
  hovered = signal<string | null>(null); listen = signal<{ id: string; port: string } | null>(null);
  search = signal<{ x: number; y: number; from?: [string, string]; dir?: 'in' | 'out' } | null>(null); }
```
Rendering: `Canvas` is a full-window element with a background grid; its child layer has
`transform: translate(x,y) scale(zoom)`. Drag on empty space pans; wheel pans; ⌘-wheel / pinch zooms around the
pointer, clamped 0.25–2. `ModuleView` draws the name, jacks coloured by role, knob cells (`Knob`: vertical drag,
200 px = full range, Shift ×0.1, wheel 1 % per notch, double-click → default, Alt-drag on a modulated knob sets
depth) and option cells (click cycles). `CableLayer` draws each cable as a cubic Bézier between jack positions
from `layoutModule`, stroke in the source role's colour. All colours from `theme.css` tokens.

- [ ] **Step 1: Write failing tests:** `layoutModule(SPECS.seq)` has width `snapUp(48 + 8·48)` and a jack for every
  input, output and knob mod jack; a rendered doc with two connected modules has two `[data-module]` elements and
  one `path[data-cable]`; dragging a knob 100 px up commits one history step with the knob at +0.5; ⌘-wheel clamps
  zoom at 2.
- [ ] **Step 2:** Run — FAIL. **Step 3:** Implement. **Step 4:** Run — PASS.
- [ ] **Step 5:** Commit `feat(ui): canvas, modules, knobs, cables`.

### Task 17: Patching and editing gestures

**Files:**
- Modify: `packages/ui/src/canvas/{Canvas.tsx,ModuleView.tsx,CableLayer.tsx}`
- Create: `packages/ui/src/canvas/keys.ts`
- Test: `packages/ui/src/canvas/gestures.test.tsx`

Gestures (pointer events on window during a drag; the target under the pointer via `closest('[data-jack]')`):
- jack → jack wires (either direction; `connect` replaces an occupied input); a dashed rubber band follows the
  pointer while dragging;
- grabbing a cable near its input end lifts it: drop on empty space → `disconnect`; drop on an input → re-route
  (one history step);
- module name drag moves (snapped on drop, one step); Shift-drag on empty space box-selects;
- `keys.ts`: ⌘Z / ⇧⌘Z undo/redo, ⌘D duplicate selection offset (+32, +32), Backspace deletes selection, Esc cancels
  the current drag.
- A jack press that moves < 4 px is a click (Task 19), not a drag.

- [ ] **Step 1: Write failing tests:** jack-to-jack drag adds one cable; dropping on an occupied input replaces it;
  lifting a cable into empty space removes it; ⌘D copies the selection with its inner cables; Backspace then ⌘Z
  restores modules and cables; a 2 px jack press adds nothing.
- [ ] **Step 2:** Run — FAIL. **Step 3:** Implement. **Step 4:** Run — PASS.
- [ ] **Step 5:** Commit `feat(ui): patching and editing gestures`.

### Task 18: Module search

**Files:**
- Create: `packages/ui/src/canvas/search.ts`, `packages/ui/src/canvas/Search.tsx`
- Test: `packages/ui/src/canvas/search.test.ts`, `packages/ui/src/canvas/Search.test.tsx`

**Interfaces:**
- Produces:
```ts
export function searchModules(query: string, specs: Specs,
  from?: { dir: 'in' | 'out'; role: Role }): ModuleSpec[];
// filter: label or type starts with / contains query (case-insensitive), prefix matches first;
// with `from.dir === 'out'` (dragged from an output) only specs with an input or knob; 'in' → only specs with an output;
// within each group, specs having a port of `from.role` on the opposite side rank first; then alphabetical.
// A knob's mod jack counts as an input of role 'mod', ordered after the spec's regular inputs.
```
Opening: dropping a jack drag on empty space, or double-clicking empty space, sets `CanvasState.search`. `Search`
is an input at the drop point with the list below; ↑/↓ move, Enter places the highlighted spec at the point
(`addModule`) and, when `from` is set, connects to its first opposite-direction port preferring `from.role`; both in
one history step. Esc or a click outside closes it.

- [ ] **Step 1: Write failing tests:** `searchModules('', SPECS, { dir: 'out', role: 'trigger' })` returns all 16
  specs with `div env lfo osc sah seq` (the ones with a trigger input) before the rest; `searchModules('fi', SPECS)`
  → `filter` first; `searchModules('', SPECS, { dir: 'in', role: 'audio' })` excludes `out`; Enter after dragging
  from `lfo.out` places a FILTER wired `lfo.out → filter.@cutoff` (first mod-role input) with depth 0.25, and one
  ⌘Z removes both module and cable.
- [ ] **Step 2:** Run — FAIL. **Step 3:** Implement. **Step 4:** Run — PASS.
- [ ] **Step 5:** Commit `feat(ui): module search from jacks and empty space`.

### Task 19: Listen, randomise, NEW, readouts, notice

**Files:**
- Create: `packages/ui/src/canvas/readouts.ts`
- Modify: `packages/ui/src/App.tsx`, `packages/ui/src/canvas/{ModuleView.tsx,Knob.tsx,keys.ts}`
- Test: `packages/ui/src/App.test.tsx`, `packages/ui/src/canvas/readouts.test.ts`

**Interfaces:**
- Produces: `startReadouts(view: Float32Array, layout: ReadonlySignal<ReadoutLayout>, root: HTMLElement): () => void`
  — a rAF loop; skips frames where `view[0] !== layout.value.seq`; sets each `[data-knob-tick]` rotation, toggles
  `data-flash` on `[data-trigger-in]` for 120 ms when its count grows, sets each `[data-level]` width.

Behaviour:
- Clicking an output jack sets `CanvasState.listen` and sends `listen`; the top bar shows
  `LISTENING · <MODULE LABEL> › <PORT LABEL>`; clicking the bar, Esc, or the same jack clears it. When the listened
  module leaves the doc (delete, NEW, undo), listen clears.
- R over a hovered module → `randomize(doc, specs, id, Math.random)` as one step.
- NEW button (top right) → `replaceDoc(doc, pickSeed(Math.random, lastSeed).doc)` as one step.
- On a `corrupt` load, a one-line notice `AUTOSAVE WAS DAMAGED — KEPT A COPY, OPENED A SEED` shows until dismissed.
- `main.tsx` wires it all: load → doc or seed → PatchStore → EngineSync → autosave → App; click to start audio.

- [ ] **Step 1: Write failing tests:** clicking `osc.out` sends `{ t: 'listen', target: { id, port: 0 } }` and shows
  `LISTENING · OSC › OUT`; Esc clears it and sends `target: null`; deleting the listened module clears it; R changes
  only knob params and one ⌘Z restores them; NEW twice gives two different seed names, ⌘Z returns the first; the
  readouts loop flashes a trigger input when its count grows and ignores a stale seq.
- [ ] **Step 2:** Run — FAIL. **Step 3:** Implement. **Step 4:** Run — PASS.
- [ ] **Step 5:** Commit `feat(ui): listen, randomise, NEW, live readouts`.

### Task 20: End-to-end gestures

**Files:**
- Create: `e2e/{patch.spec.ts,listen.spec.ts,session.spec.ts}`, `e2e/helpers.ts`

- [ ] **Step 1: Write the e2e tests:**
  - patch: drag from a module's output jack to empty space, type `vca`, Enter → a VCA module exists, wired;
  - listen: click an output jack → the listen bar shows; Esc → it is gone;
  - session: R over a module changes a knob's value text, ⌘Z restores it; NEW changes the module set, ⌘Z restores it;
    after an edit and 600 ms, reload → the same modules, positions and cables are back.
  Poll trigger flashes with `intervals: [50]` (a flash lasts 120 ms).
- [ ] **Step 2:** Run `pnpm e2e` — fix until PASS; `pnpm check` — PASS.
- [ ] **Step 3:** Commit `test(e2e): patching, listening, session`.
