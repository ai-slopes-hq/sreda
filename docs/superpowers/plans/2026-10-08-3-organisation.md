# SREDA 2 · Plan 3 — Organisation: frames, factory patches, library, WIRES, the remaining gestures

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish the first build. This plan adds:

- frames with their own clocks, MUTE, STACK and WIRE FIX;
- the factory patches (Pulse, Acid, Drone, …) in a picker with tabs;
- a library folder on disk with SAVE / NEW / ⌘S / ⌘O;
- the WIRES sidebar;
- the remaining gestures: magnets, replace, insert into a cable, wire hover, cable focus, ⌘D, R;
- a 200-module patch that runs in real time and stays smooth to edit.

**Architecture:** frames live in the document as `groups` with containment-based `parent` links, edited by pure
functions in `packages/core/src/frames.ts`. `compile` turns each frame into a hidden `clock` node (a Rust module marked
`internal`), appended after the modules. Mute is a per-frame gain in the engine that gates the cables leaving a frame
and the OUT modules inside it; a toggle is a `mute` message, not a plan. Factory patches are TypeScript builders in
`packages/core/src/factory/`. The library is a folder that the Electron main process reads and writes over IPC. WIRES
is a sidebar whose sections and problems are computed in `packages/core/src/wires.ts`.

**Tech Stack:** as Plans 1–2: a Rust → WASM engine in an AudioWorklet, a TypeScript core and a SolidJS UI, tested with
Vitest (happy-dom), cargo test and Playwright driving Electron. New here: Electron `ipcMain` / `contextBridge` and
`dialog.showOpenDialog`.

**Spec:** `docs/superpowers/specs/2026-10-07-canvas-ux-design.md` (revision 15). The relevant sections:

- §4 the gestures;
- §5 frames;
- §5a the sidebar and WIRES;
- §6 session, library and factory patches;
- §8 the document, compile, mute and readouts;
- §10 the e2e list.

**Reference implementations.** The prototype `docs/prototype/Main.dc.html` already does all of this in plain JS.
Port its algorithms, never its markup or styling wholesale. Where the spec and the prototype differ, the spec wins.

| What | Prototype functions |
|---|---|
| Frames | `recomputeParents`, `descendants`, `fitFrame`, `landingFrame`, `relayoutRoutes`, `group()`, `ungroup()` |
| Packing | `readingOrder`, `packRows`, `packWidth`, `shrinkFrame` |
| Routing | `routeFrames`, `routedIn`, `routePts`, `roundPath`, `cableGeoms`, `bezPts`, `segDist` |
| Gestures | `magnet`, `canInsert`, `insertIntoCable`, `replaceModule`, `duplicate()` |
| Factory | `SEEDS`, `FACTORY_GROUPS`, `buildWith`, `extractGroup`, `mergeInto` |
| WIRES | `chainOf`, `wireSection`, `allPorts`, `NEEDS_INPUT`, `wireProblems` |
| Clock and TAP | `tap()`, the group-clock part of `Sim.step` |
| Gliding to a candidate | `ensureVisible` |

**This is Plan 3 of 3.** Plans 1 and 2 are merged. When this plan lands the first build is complete; the sound pack
(§7a) gets its own plan.

## Global Constraints

- Everything in Plan 1's and Plan 2's Global Constraints still holds:
  - the audio-thread rules in `CLAUDE.md`;
  - roles, stacking, attenuverters and ratios;
  - glides, fades and the master stage;
  - the panel grammar;
  - the 8 px grid;
  - UI copy in English capitals.
- **Frame geometry.** Constants live in `packages/core/src/frames.ts`:

  | Constant | Value |
  |---|---|
  | header `GHEAD` | 28 |
  | padding `GPAD` | 16 |
  | WIRE FIX channel `RGAP` | 32 |
  | minimum frame | 352 × 96 |
  | tints `TINTS` | 7 (0 = neutral) |
  | CLK IN jack, frame-relative | (0, 14) |
  | CLK OUT jack, frame-relative | (12, 36) |

  The tint colours are the prototype's `TINTS`.
- **Ids.** Modules are `m<n>`, frames `g<n>`, both from the document's one `nextId`. A frame's jacks are
  `[gid, 'clkIn']` (input, trigger role) and `[gid, 'clkOut']` (output, trigger role).
- **Frame fields.** `Group = { id, name, x, y, w, h, parent, ratio, tint, layout: 'free' | 'route', muted, clock: { on,
  bpm } }`:
  - a new frame is `GROUP <n>`, ratio 1, tint 0, layout `'route'` (WIRE FIX on by default), clock off at 120 BPM;
  - BPM ranges over 20…300.
- **Engine messages.** BPM, clock on/off, the CLK IN ratio and mute are messages; they never send a plan. Adding,
  removing or re-parenting a frame, layout changes and cable changes send a plan.
- **Mute timing.** A mute ramps over 50 ms. A project opened from the picker or on first launch fades in over 200 ms.
- **Every structural action is one undo step.** That covers frame, unframe, delete, move, resize, STACK, FIX, replace,
  insert, ⌘D, R, opening a project and placing a group.
- **Factory entries are read-only**: saving one asks for a new name.
- **Library file names:**
  - `groups/<path>.sreda-group.json` and `projects/<path>.sreda.json`;
  - `<path>` is made of `/`-separated segments; each segment is non-empty, not `.` or `..`, has no `\` or NUL, and is
    at most 100 characters;
  - the stored JSON is the document (`version`, `modules`, `cables`, `groups`, `nextId`).
- **Sidebar sizes:** 440 px on open, 320 px … 70 % of the window when dragged. It is closed on launch and on every
  project open.

## Review Focus

1. **Documents from disk or an old autosave with broken frames.** The cases:
   - a `parent` naming no frame, or two frames that are each other's parent;
   - a cable to `[gid, 'clkOut']` of a missing frame;
   - a frame with w = 0;
   - `groups` missing entirely (Plan 2 autosaves).

   `validateDoc` must repair what it can (recompute parents, drop dangling cables, clamp sizes to the minimum) or
   refuse the whole thing; it must never crash or hang. Tests in Task 1.
2. **Moving frames into frames.**
   - Dragging a frame into one of its own descendants must not nest it inside itself.
   - A frame dropped over another frame must not capture what it lands on.
   - Dragging the last module out of a WIRE FIX frame leaves an empty frame at the minimum size.

   Tests in Tasks 1 and 4.
3. **Undo and redo across frame state.** Undoing a mute, a BPM drag, a clock on/off or a deleted frame must leave the
   engine in step with the document: the next plan or messages carry the restored state. A deleted parent frame takes
   its child's CLK IN normal with it. Tests in Tasks 2 and 3.
4. **The library folder going wrong:**
   - a file with invalid JSON, or a valid file from another app;
   - the folder deleted while the app runs;
   - saving over an existing name;
   - a name with `..` or a leading `/`.

   Each lists, refuses or asks; none crashes, and the app never writes outside the folder. Tests in Task 6.
5. **The sidebar narrowing the canvas.** With the sidebar open:
   - F, ⇧F, picker placement, the drop point under the pointer and the 250 ms glide all use the canvas element's width,
     not `innerWidth`;
   - wire hover never looks through the sidebar.

   Tests in Tasks 9 and 10.

---

## File structure

```
engine/src/
  spec.rs              ModuleSpec gains `internal: bool` (skipped in JSON when false)
  modules/clock.rs     the hidden per-frame clock node
  plan.rs              Source.gate, PlanNode.gate, Plan.frames, ReadoutLayout.frames (all serde-default)
  engine.rs            frame gains (50 ms), gated sources and OUT nodes, frame meters, fade_in message
  wasm.rs              + engine_mute, engine_fade_in
engine/tests/realtime.rs   + the 200-module benchmark
packages/core/src/
  doc.ts               Group; validateDoc repairs / refuses frames
  frames.ts            frame geometry and edits (new)
  ops.ts               connect / deleteObjects / moveObjects know frames; replaceModule, insertIntoCable,
                       duplicate, randomise
  compile.ts           clock nodes, gates, frames, frame meter offsets
  wires.ts             WIRES sections, port lists, problems (new)
  factory/             build.ts, projects.ts, groups.ts, index.ts (new)
  bigpatch.ts          the 200-module test patch (new)
packages/protocol/src/ messages (mute, fade); engine.ts (mute, fadeIn, plan bytes); render.test.ts (factory)
packages/app/src/
  main/library.ts      the library folder: settings, dialog, list / read / write (new)
  main/index.ts        IPC handlers; preload/index.ts exposes window.sreda
packages/ui/src/
  library.ts           the bridge type, the factory + folder entries, save / open flows (new)
  store.ts             frame(), mute sync, project name / dirty, openProject, placeGroup
  canvas/Frame.tsx     a frame: header, tools, clock, CLK jacks, resize handles (new)
  canvas/cablegeom.ts  cable geometry: curves, WIRE FIX routes, hit testing, memoised (new)
  canvas/keys.ts       the canvas keyboard (moved out of Canvas.tsx) (new)
  canvas/magnets.ts    magnet snapping (new)
  canvas/Picker.tsx    tabs, groups / projects rows, REPLACE mode
  canvas/Chrome.tsx    top bar: SREDA + project path, WIRES / SAVE / NEW; zoom control; hint line (new)
  sidebar/Sidebar.tsx, sidebar/Wires.tsx, sidebar/PortList.tsx (new)
scripts/render.ts      `pnpm render <name>` → <name>.wav (new)
```

---

## Stage D1 — frames you can hear

### Task 1: Frames in the document and on the canvas

**Files:**
- `packages/core/src/{doc.ts,frames.ts,ops.ts,index.ts}`, with `frames.test.ts` and `doc.test.ts`;
- `packages/ui/src/canvas/{Frame.tsx,Frame.test.tsx,keys.ts,Canvas.tsx,canvas.css}`, `packages/ui/src/store.ts`;
- the e2e tests (from Task 5 on, the `launch()` helper sets `SREDA_FIRST=starter`).

**Interfaces** (`frames.ts`; `Rect = { x, y, w, h }`, `Pt = { x, y }`):
```ts
export interface Group { id: string; name: string; x: number; y: number; w: number; h: number; parent: string | null;
  ratio: number; tint: number; layout: 'free' | 'route'; muted: boolean; clock: { on: boolean; bpm: number } }
// Doc.groups: Group[]
export const GHEAD = 28, GPAD = 16, RGAP = 32, FRAME_MIN = { w: 352, h: 96 }, TINTS = 7;
export const isGroupId = (id: string): boolean => /^g\d+$/.test(id);
export function rectOf(doc: Doc, specs: Specs, id: string): Rect;
export function jackAt(doc: Doc, specs: Specs, id: string, port: string): Pt;          // modules and frames
export function descendants(doc: Doc, gid: string): string[];                          // modules and frames
export function chainOf(doc: Doc, id: string): string[];   // frames holding id, innermost first (a frame holds itself)
export function recomputeParents(doc: Doc, specs: Specs, only?: readonly string[]): Doc;
export function frameSelection(doc: Doc, specs: Specs, ids: readonly string[]): { doc: Doc; id: string };
export function unframe(doc: Doc, specs: Specs, gids: readonly string[]): Doc;
export function landingFrame(doc: Doc, specs: Specs, ids: readonly string[], dx: number, dy: number): string | null;
export function resizeFrame(doc: Doc, specs: Specs, gid: string, r: Rect): Doc;
export function editFrame(doc: Doc, gid: string,
  patch: Partial<Pick<Group, 'name' | 'tint' | 'muted' | 'ratio' | 'clock'>>): Doc;
export function effectiveMuted(doc: Doc, gid: string): boolean;                         // itself or a parent muted
// ops.ts changes:
export function moveObjects(doc: Doc, specs: Specs, ids: readonly string[], dx: number, dy: number): Doc;
// moves frames with their descendants, snaps to 8 px, re-parents the moved roots (landingFrame)
export function deleteObjects(doc: Doc, ids: readonly string[]): Doc;   // frames take their descendants and clk cables
// connect(): [gid, 'clkOut'] is an output and [gid, 'clkIn'] an input (trigger role)
```

**Behaviour:**
- **Membership (§5).** An object's parent is the innermost frame containing its centre. A frame's parent must be larger
  than the frame and must not be the frame itself or one of its descendants.
- **G / ⌘G.** Fit the selection with 16 px padding plus the header (`fitFrame`). Nest the frame in the selection's
  innermost common parent and name it `GROUP <max n + 1>`. In this task the layout stays `'free'`; Task 4 turns WIRE FIX
  on by default and packs the frame.
- **G on frames only, or ⇧⌘G.** Unframe them: their children move to their parent.
- **Backspace.** A frame goes with its descendants, in one step.
- **Moving.** A move re-parents only the moved roots; a moved frame never captures what it lands on. A resize
  re-parents everything.
- **Frame drawing (`Frame.tsx`):**
  - a translucent tint fill and a 28 px header;
  - the name: double-click renames; Enter or blur saves, Esc cancels;
  - the tint swatch cycles 0…6;
  - dragging the header moves the frame with everything inside it; clicking the header selects the frame;
  - resize handles on the left, right, bottom and the two bottom corners;
  - the frame tools show while the header is hovered.
- **While dragging,** the landing frame gets the class `drop`.
- **Box select** selects the modules the box touches and the frames it fully encloses.
- **F and ⇧F** include frames.
- **Draw order.** Frames are drawn under the modules, outer frames first.
- **Keys.** The keyboard moves into `canvas/keys.ts` as `handleKey(e: KeyboardEvent, k: KeyCtx): void`.
  - `KeyCtx` exposes the session, the picker setter, `fit` and `pointer`.
  - G is plain `g` without ⌘. Unframing needs every selected id to be a frame. ⌘G frames, ⇧⌘G unframes.

- [ ] **Step 1: Failing tests** (`frames.test.ts`, `doc.test.ts`):
  - `frameSelection` of two modules: the frame is the modules' bounds + 16 px each side + 28 px header, at least
    352 × 96; both modules get `parent === id`; the name is `GROUP 1`, then `GROUP 2`.
  - Framing a module inside G1 nests the new frame in G1. `unframe` gives G1 its children back.
  - `moveObjects` of a module into a frame sets the parent; out of it clears the parent; moving a frame moves its
    descendants by the same delta.
  - Review Focus 2: moving a frame over a smaller module, or over a frame it does not contain, leaves their parents
    unchanged. Moving frame A into its own child B leaves A's parent unchanged.
  - `resizeFrame` growing over a module attaches it; the size is clamped to 352 × 96.
  - `deleteObjects([gid])` removes its descendants and every cable touching them or the frame's clk jacks.
  - `connect(doc, specs, [g, 'clkOut'], [m, 'trig'])` adds a cable; `[g, 'clkIn']` cannot be a source.
  - `validateDoc` (Review Focus 1):
    - keeps a well-formed frame;
    - recomputes a parent naming no frame, and a parent cycle;
    - drops cables to the jacks of a missing frame;
    - clamps w = 0 to 352;
    - reads `groups` missing as `[]`;
    - refuses a frame with a non-numeric x;
    - with `g7` in the document, `nextId` comes out ≥ 8.
  - UI (`Frame.test.tsx`, happy-dom): a frame renders its name and, on header hover, its tools; double-clicking the
    name and typing `drums⏎` renames it.
  - e2e: box-select OSC and OUT and press G → one `.sr-frame` named `GROUP 1`; drag OUT out of it → OUT's parent is
    null; select the frame and press G → the frame is gone and the modules remain; ⌘Z brings the frame back.
- [ ] **Step 2:** `pnpm test packages/core && pnpm test packages/ui` → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** `pnpm check && pnpm e2e` → PASS.
- [ ] **Checkpoint for the user (stop):** frame a few modules with G, nest a frame in a frame, drag modules in and
  out, resize, rename, tint; G again unframes.
- [ ] **Step 5:** Commit `feat: frames — G, nesting by containment, move / resize / rename / tint / delete`.

### Task 2: Frame clocks

**Files:**
- `engine/src/{spec.rs,registry.rs}`, `engine/src/modules/clock.rs`;
- `packages/core/src/{spec.ts,compile.ts,doc.ts}` and `compile.test.ts`;
- `packages/ui/src/{store.ts,canvas/Frame.tsx,canvas/patching.ts}`;
- the e2e tests.

**Interfaces:**
```rust
// spec.rs: ModuleSpec gains `pub internal: bool` (#[serde(skip_serializing_if = "is_false")]); every existing spec false
// clock.rs: type "clock", internal; inputs [clk (trigger)]; outputs [out (trigger)];
//   params: option `on` [OFF, ON], hidden knob `bpm` 20…300 def 120 (lin); size (1, 1)
// state() = ticks emitted so far, modulo 2^24 (for the CLK OUT flash)
```
```ts
// spec.ts: ModuleSpec gains internal?: boolean. pickerItems, layoutPanel's "every spec fits" test and validateDoc
// (a module of an internal type is refused) skip internal specs.
export function clockNode(doc: Doc, gid: string): number;   // modules.length + the frame's index in doc.groups
```

**Clock behaviour, highest priority first:**
1. With a cable in CLK IN (`connected_in[0]`), OUT copies the prepared input. The ratio is already applied, as a 1 ms
   pulse.
2. Otherwise, with ON set, the own clock emits a 1 ms pulse every `60 / bpm` s. The first pulse comes at the first
   sample after it is turned on. BPM changes take effect from the current phase.
3. Otherwise OUT copies the prepared input. That input is the parent's clock normal, after this frame's ratio.

**Compile.** Each frame becomes the node `{ id: gid, type: 'clock', knobs: [], fixed: [on ? 1 : 0, bpm], inputs:
[clkIn], connectedOut }`. Its input:
- `sources` are the cables into `[gid, 'clkIn']`;
- `normal` is `{ node: clockNode(parent), port: 0 }` while the frame has a parent;
- `kind` is `'trigger'` and `ratio` is `group.ratio`.

Further rules:
- A cable from `[gid, 'clkOut']` is a source with `{ node: clockNode(gid), port: 0 }`.
- Add a graph edge from the parent's clock to the child's, so the order and Tarjan see the normal.
- In `plan.rs` the doc comment on `NormalPlan::Own` becomes "a node's output (its own, or a parent frame's clock), read
  one sample late". The engine code already resolves any node.
- Frame clock nodes get a normal readout layout: one trig, one out and the state.

**Session.** `session.frame(gid, patch: Partial<Pick<Group, 'name' | 'tint' | 'muted' | 'ratio' | 'clock'>>, merge?:
Merge)` commits `editFrame` and then sends only messages:
- `clock.on` → `fixed` index 0;
- `clock.bpm` → `fixed` index 1;
- `ratio` → `ratio` on input 0 of `clockNode(gid)`;
- `name` and `tint` → nothing.

`muted` is wired in Task 3.

**Header UI (§5):**
- `+ CLOCK` turns the clock on.
- Then `<bpm> BPM`: drag vertically, 1 BPM per 4 px; Shift for 0.1 per px; rounded to 1.
- `TAP` uses the last up to 4 taps within 2.5 s and needs at least 2; consecutive taps on one frame merge into one undo
  step.
- `✕` turns the clock off.
- The BPM is dimmed (class `dim`) while CLK IN has a cable.

**CLK jacks:**
- The CLK IN jack sits outside the left end of the header, with its ratio field beside it (drag, wheel, double-click
  resets, like a module's ratio field). It flashes on each event (`trigs`). Its title is `CLK IN ← <PARENT> (normal)`
  while normalled, and it shows a faint dashed ghost line from the parent's CLK OUT.
- The CLK OUT jack sits inside the frame under the header, labelled `CLK`, and flashes on each tick (the clock node's
  `state` readout).
- Both jacks patch like module jacks. A click on CLK OUT listens to it: `setListen` accepts a frame id (node
  `clockNode(gid)`, port 0) and the bar reads `LISTENING · GROUP 1 › CLK`.
- `Cables.tsx` uses `jackAt`.

- [ ] **Step 1: Failing tests:**
  - Rust `clock.rs`:
    - ON at 120 BPM at 48 k gives a pulse every 24 000 ± 1 samples, each 48 samples long; at 44.1 k every
      22 050 ± 1 samples;
    - with `connected_in[0]`, OUT follows the input and the own clock is silent;
    - with ON off, OUT follows the input (the normal);
    - blockwise equals per sample;
    - `state()` counts ticks;
    - a BPM change via `fixed` mid-run keeps the phase (the next pulse comes within one new period).
  - compile:
    - a frame adds a `clock` node after the modules, with `fixed` [1, 128] for `{ on: true, bpm: 128 }`;
    - a cable from `[g, 'clkOut']` to a module resolves to `{ node: modules.length, port: 0 }`;
    - a nested frame's input has `normal: { node: clockNode(parent), port: 0 }` and `ratio` −2 for ratio ÷2;
    - deleting the parent removes that normal (Review Focus 3);
    - the steps put the parent's clock before the child's.
  - engine (Rust): with a parent clock at 120 BPM and a child with ratio −2 and its own clock off, the child's output
    pulses every 48 000 ± 2 samples.
  - store: dragging BPM sends `fixed` messages and no plan; undo restores the BPM and sends a plan carrying it (Review
    Focus 3).
  - e2e:
    - frame an LPG with G, press + CLOCK, patch CLK → LPG PING;
    - after audio starts the LPG's PING flash fires within 1 s;
    - a nested frame at ÷2 flashes half as often: count the flashes over 3 s, ±1.
- [ ] **Step 2:** → FAIL.
- [ ] **Step 3:** Implement; then `pnpm specs`.
- [ ] **Step 4:** `pnpm check && pnpm e2e` → PASS.
- [ ] **Checkpoint for the user (stop):** a frame with its own clock at 120 BPM pings an LPG on an OSC; TAP a tempo;
  nest a frame at ÷2 with its own LPG voice; patch an outside SLOPE EOC into the child's CLK IN and hear it take over.
- [ ] **Step 5:** Commit `feat: frame clocks — own clock, BPM / TAP, CLK in / out, nested frames inherit at their ratio`.

### Task 3: MUTE and the frame meter

**Files:**
- `engine/src/{plan.rs,engine.rs,wasm.rs}` and `engine/tests/alloc.rs`;
- `packages/core/src/{plan.ts,compile.ts}`;
- `packages/protocol/src/{messages.ts,engine.ts}`;
- `packages/ui/src/{store.ts,audio/worklet.ts,live.ts,canvas/Frame.tsx,canvas/Canvas.tsx}`;
- the e2e tests.

**Interfaces:**
```ts
// plan.ts additions
export interface Source { node: number; port: number; late: boolean; gate?: number }  // frame index: silenced by it
export interface PlanNode { /* … */ gate?: number }       // OUT nodes: their speaker output is gated by this frame
export interface FramePlan { muted: boolean; sources: { node: number; port: number }[]; outs: number[] }
export interface Plan { /* … */ frames: FramePlan[] }
export interface ReadoutLayout { size: number; nodes: NodeReadouts[]; frames: number }   // one float per frame
// messages.ts
| { t: 'mute'; frame: number; on: boolean }
| { t: 'fade'; ms: number }
```
```rust
// wasm.rs
pub unsafe extern "C" fn engine_mute(e: *mut Engine, frame: u32, on: i32);
pub unsafe extern "C" fn engine_fade_in(e: *mut Engine, ms: f64);
// engine.rs
pub fn mute(&mut self, frame: usize, on: bool);   // the frame's gain glides to 0 or 1 over 50 ms
pub fn fade_in(&mut self, ms: f64);               // Master::fade_in
```

**Compile:**
- **`gate` of a cable.** The index in `doc.groups` of the innermost frame that holds the source but not the target, via
  `chainOf`. A cable with no such frame has no gate.
- **`gate` of an OUT node.** Its parent frame, if it has one.
- **`frames[k].muted`** is `effectiveMuted(doc, groups[k].id)`.
- **`frames[k].sources`** are the distinct `{ node, port }` sources of audio-role outputs on cables that leave frame k.
  A cable leaves frame k when frame k is in the source's chain and not in the target's.
- **`frames[k].outs`** are the OUT nodes among frame k's descendants.
- **The readout layout** gets `frames` = one float per frame, placed after the nodes.

**Engine:**
- `gains: Vec<FrameGain { cur, target, step }>` and `gain_buf: Vec<[f32; BLOCK]>` are sized in `apply`. A gain is kept
  across plans when the frame's index persists.
- At the start of `process`, fill each frame's `gain_buf` for the block.
- `sum` and the trigger scratch multiply a gated source by `gain_buf[gate][i]`.
- An OUT node with a gate runs with the master saved: as in `retire_block`, add its contribution scaled per sample by
  the gate and record its peak in `slot.master_peak`.
- The frame meter `readouts[frames + k]` is the maximum of the peaks of `frames[k].sources` and the `master_peak` of
  `frames[k].outs`, times `gain_buf[k][BLOCK - 1]`.

**Session.**
- `frame(gid, { muted })` recomputes `effectiveMuted` for every frame before and after the change. It sends `mute` for
  each frame whose effective state changed; no plan.
- Opening a project sends `{ t: 'fade', ms: 200 }` after the plan (Task 5 uses this).

**UI:**
- **M** in the header toggles mute. It is lit while on, and the tools stay visible while FIX or M is on.
- A muted frame's contents get the class `muted` (opacity 0.4); its own header does not.
- **The header meter** is the live kind `'meter'` registered at `layout.frames + k`, with a held peak and a 300 ms
  fall.

- [ ] **Step 1: Failing tests:**
  - compile:
    - a cable from a module in frame G1 to an OUT outside it has `gate` 0; a cable inside G1 has none;
    - nested case: with source in G2 ⊂ G1 and target outside G1, the gate is G2's index;
    - an OUT inside G1 has `gate` 0;
    - `frames[0].sources` lists the leaving audio source once even when it is cabled twice.
  - Rust engine:
    - muting a gated sine's frame brings OUT to −60 dB within 50 ms ± 1 ms with no step above 0.01 between samples;
    - unmuting ramps back;
    - an OUT inside a muted frame goes silent while the sources keep running (their output buffers unchanged);
    - the frame meter reads the leaving peak, and 0 when muted;
    - `alloc.rs`: a plan with two frames, gated sources and a gated OUT, plus `mute` toggles inside the measured loop
      — zero allocations.
  - store: muting G1 with child G2 sends `mute` for both frames and no plan; undo sends a plan with `muted` false for
    both (Review Focus 3).
  - e2e: frame OSC and OUT, start audio, master peak (readout 1) > 0.05; press M → the peak is below 0.001 within
    0.5 s; M again → back above 0.05.
- [ ] **Step 2:** → FAIL.
- [ ] **Step 3:** Implement; rebuild the WASM.
- [ ] **Step 4:** `pnpm check && pnpm e2e` → PASS.
- [ ] **Checkpoint for the user (stop):** two framed voices on one OUT; mute and unmute one while it plays (it comes
  back in time); watch the header meters.
- [ ] **Step 5:** Commit `feat: frame MUTE (50 ms, gates leaving cables and OUTs) and the frame meter`.

### Task 4: STACK, WIRE FIX and cable geometry

**Files:**
- `packages/core/src/frames.ts` and `frames.test.ts`;
- `packages/ui/src/canvas/{cablegeom.ts,Cables.tsx,Frame.tsx,Canvas.tsx}`, with `cablegeom.test.ts`;
- the e2e tests.

**Interfaces:**
```ts
// frames.ts
export function packFrame(doc: Doc, specs: Specs, gid: string, mode: 'stack' | 'route'): Doc;
//   'stack': packRows(gap 0, pad GPAD), layout 'free'; 'route': packRows(gap RGAP, pad RGAP), layout 'route'
export function setLayout(doc: Doc, specs: Specs, gid: string, layout: 'free' | 'route'): Doc; // route → packFrame
export function repackRoutes(doc: Doc, specs: Specs, gids: readonly string[]): Doc; // 'route' frames, innermost first
// cablegeom.ts
export interface CableGeom { key: string; cable: Cable; pts: Pt[]; d: string; from: Role; to: Role; routed: string | null }
export function cableGeoms(doc: Doc, specs: Specs): CableGeom[];   // memoised per cable on its end positions
export function cableAt(geoms: CableGeom[], p: Pt, thr: number): number | null;   // index of the nearest within thr
```

**Behaviour:**
- **Packing** is the prototype's `readingOrder`, `packRows`, `packWidth` and `shrinkFrame`:
  - rows by position, a row break at `packWidth`, rows top-aligned;
  - the frame shrinks to the same margin on all four sides; the minimum width is 352;
  - the height is exact, not snapped.
- **Press semantics.** STACK turns FIX off. Pressing STACK or FIX again changes nothing. Switching between them keeps
  rows and order.
- **WIRE FIX by default.** `frameSelection` now creates `layout: 'route'` and packs the frame; factory frames do the
  same in Task 5.
- **Re-packing.** After a move, a drop, a removal, a frame or an unframe, `repackRoutes` re-packs every `'route'` frame
  that gained or lost a direct child, and their `'route'` parents, innermost first.
- **Routed cables** are cables between two direct children of a `'route'` frame. `routePts` routes them through the
  channels:
  - lanes `6 + ((n − 1) mod 6) · 4` per frame;
  - corners rounded with `roundPath(pts, 6)`.

  Every other cable stays a curve: the existing `bez`, sampled to 25 points by `bezPts` for hit testing.
- **Gradient.** A cable joining two roles uses the spec's 40 / 20 / 40 stops (backlog item).
- **Performance.** `layoutPanel` is memoised per spec object. `cableGeoms` recomputes only cables whose end positions
  changed: memo key `from|to|x0,y0|x1,y1|routeFrame`.

- [ ] **Step 1: Failing tests:**
  - frames:
    - STACK on a frame of three 1U modules gives rows flush at 16 px from the edges and the frame fitted with equal
      margins;
    - STACK twice gives the same document; FIX after STACK keeps the rows' order; STACK after FIX turns layout to
      `'free'`;
    - a `'route'` frame re-packs when a module is dropped into it;
    - Review Focus 2: dragging the last module out of a `'route'` frame leaves it at 352 × 96 + header, with no NaN
      sizes.
  - cablegeom:
    - a cable between neighbours in a row is a straight segment (2 points) when the jacks are level, else 4 points
      with the step at mid-gap;
    - a cable to the next row goes source → right channel → channel above → trunk → down into the jack;
    - every routed segment is horizontal or vertical;
    - moving one module recomputes only its cables (a counter exported for tests);
    - `cableAt` finds a cable within 6 px and none at 7.
  - e2e:
    - ⌘G on three patched modules gives FIX lit and every routed cable path made of only `H`, `V`, `L` and `Q`
      commands with axis-aligned `L` segments;
    - STACK packs (the module positions change) and FIX goes dark.
- [ ] **Step 2:** → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** `pnpm check && pnpm e2e` → PASS.
- [ ] **Checkpoint for the user (stop):** ⌘G a patched voice (rows, routed wires); move a module inside it (it
  re-packs); STACK; FIX again; drop a module in.
- [ ] **Step 5:** Commit `feat: STACK and WIRE FIX (packed rows, orthogonal routes), memoised cable geometry`.

## Stage D2 — patches to open and keep

### Task 5: Factory patches and the picker tabs

**Files:**
- `packages/core/src/factory/{build.ts,projects.ts,groups.ts,index.ts}` and `factory.test.ts`; `frames.ts`;
- `packages/protocol/src/render.test.ts`;
- `packages/ui/src/{store.ts,App.tsx,autosave.ts,canvas/Picker.tsx,canvas/patching.ts,canvas/Canvas.tsx}`;
- `packages/app/src/{main/index.ts,preload/index.ts}`;
- `scripts/render.ts` and `package.json`;
- the e2e tests.

**Interfaces:**
```ts
// factory/build.ts — values in real units (knobs) or option indices; positions in the prototype's units ×7/6, ×9/7
export interface Builder {
  add(type: string, x: number, y: number, values?: Record<string, number>): string;
  wire(a: string, ap: string, b: string, bp: string): void;
  att(id: string, port: string, v: number): void;
  rat(id: string, port: string, r: number): void;
  notes(values: Record<string, number>, semis: number[], slides: number[]): Record<string, number>; // STAGES v / g
  grid(id: string, gates: string, accents: string): void;   // RHYTHM: 'x' on, '-' TIE, '.' off; 'A' accent
  frame(ids: string[], name: string, o?: { ratio?: number; tint?: number; bpm?: number }): string;
}
export function build(specs: Specs, f: (b: Builder) => void): Doc;  // recompute parents, pack 'route' frames inner-first
// factory/index.ts
export interface FactoryEntry { kind: 'project' | 'group'; name: string; build(specs: Specs): Doc }
export const FACTORY: FactoryEntry[];  // projects: pulse drone self-clocked polymeter ratchet acid;
                                       // groups: 303 voice, complex vco, bleep-bloop, vca-lpg
// frames.ts
export function extractGroup(doc: Doc, gid: string): Doc;   // the frame, its descendants, the cables among them
export function mergeDoc(doc: Doc, src: Doc, dx: number, dy: number): { doc: Doc; map: Record<string, string> };
// patching.ts
export type PickerTab = 'ALL' | 'MODULES' | 'GROUPS' | 'PROJECTS';
export type PickerItem =
  | { kind: 'module'; type: string; label: string; desc: string }
  | { kind: 'group' | 'project'; path: string; label: string; folder: string; factory: boolean };
export interface LibEntry { kind: 'group' | 'project'; path: string; factory: boolean }  // factory paths: 'FACTORY/<name>'
export function pickerItems(specs: Specs, query: string, from: End | null,
  o: { tab: PickerTab; replace: boolean; library: LibEntry[] }): PickerItem[];
// store.ts
openProject(doc: Doc, project: { path: string; factory: boolean }): void;   // one undo step; fit; fade 200 ms
placeGroup(src: Doc, at: Pt, from: { id: string; port: string; dir: 'in' | 'out'; role: Role } | null): void;
                                                       // fresh ids; from a trigger output → CLK IN
```

**The patches.** Port the prototype's `SEEDS` and `FACTORY_GROUPS` (lines 676–791) as they are, checked against §6.
Option values are indices. Where the prototype's module params differ from `specs.json`, use the spec's ids:
- MIX levels are `la`…`ld`;
- OSC's FM index is `fmi`.

§6 settles the details:
- *Acid* is `x.x-..x.x.xx-.x.`, accents on 12 and 15, ×4 on RHYTHM CLK, frame ACID at 128 BPM.
- STAGES is 16 notes in C minor with slides on 3, 6, 11 and 14.

**Picker:**
- The tabs are `ALL · MODULES · GROUPS · PROJECTS`. Tab and ⇧Tab cycle them, a click picks one, and the query searches
  names and folders in the current tab.
- A row shows its folder (`FACTORY`, `acid`, …) and its kind.
- From a jack the picker offers modules and groups, no projects. In REPLACE mode (Task 8) it offers modules only.
- ⌘O opens it on PROJECTS in the middle of the canvas.

**Placing.**
- A group lands with its frame's top-left at the drop point. Opened from a trigger output, the cable goes into the
  group's CLK IN.
- A project replaces the canvas: `openProject` commits one undo step, fits the view, closes the sidebar and sends a
  200 ms fade-in.

**First launch.**
- The first launch opens *Pulse* as the project `FACTORY/pulse`.
- e2e runs set `SREDA_FIRST=starter` to keep the OSC → OUT starter doc. The main process answers
  `ipcRenderer.invoke('sreda:first')` with that variable or `null`, and preload exposes it as `window.sreda.first()`.

**`pnpm render <name> [seconds=8]`** (`tsx scripts/render.ts`) renders a factory project through the WASM engine and
writes a 16-bit stereo `<name>.wav` in the current directory.

- [ ] **Step 1: Failing tests:**
  - `factory.test.ts`: every entry validates (`validateDoc` returns the same document); every group entry has
    exactly one top frame holding everything; Acid's RHYTHM has `g4 = 2` (TIE) and `a12 = a15 = 1`; Acid's frame clock
    is `{ on: true, bpm: 128 }`; every frame of every entry is `'route'` and packed (`packFrame` changes nothing).
  - `render.test.ts`: each factory project renders 4 s with a peak > 0.05 and ≤ 1, all finite, at 48 k; Pulse also at
    44.1 k.
  - frames: `mergeDoc` gives fresh ids (none collides) and keeps the inner cables; `extractGroup` leaves cables from
    outside behind and sets the top frame's parent to null.
  - patching:
    - tab GROUPS lists only groups;
    - query `acid` on ALL finds the Acid project and the 303 voice group (folder match);
    - from a jack, there are no projects;
    - with `replace`, only modules.
  - e2e:
    - `/` → PROJECTS via Tab → Enter on `acid` → the canvas holds a frame ACID and a RHYTHM;
    - ⌘Z returns the previous patch;
    - a factory group dropped from a trigger output lands with a cable into its CLK IN.
- [ ] **Step 2:** → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** `pnpm check && pnpm e2e` → PASS. `pnpm render acid` writes `acid.wav`.
- [ ] **Checkpoint for the user (stop):** open each factory project from the picker and listen: Pulse, Drone,
  Self-clocked, Polymeter, Ratchet, Acid. Drop the 303 voice and bleep-bloop groups next to them.
- [ ] **Step 5:** Commit `feat: factory projects and groups, picker tabs, open / place, pnpm render`.

### Task 6: The library folder, SAVE / NEW, the chrome

**Files:**
- `packages/app/src/main/{library.ts,index.ts}` and `library.test.ts` (Vitest, Node), `packages/app/src/preload/index.ts`;
- `packages/ui/src/{library.ts,store.ts,autosave.ts,canvas/Chrome.tsx,canvas/keys.ts,canvas/Frame.tsx,canvas/Picker.tsx}`;
- the e2e tests.

**Interfaces:**
```ts
// packages/ui/src/library.ts — what preload exposes as window.sreda (app's preload implements it)
export interface SredaBridge {
  first(): Promise<'starter' | null>;
  library: {
    folder(): Promise<string | null>;            // the remembered folder, if it still exists
    choose(): Promise<string | null>;            // a folder dialog; remembered in <userData>/settings.json
    list(): Promise<{ kind: 'group' | 'project'; path: string }[]>;   // walks groups/ and projects/
    read(kind: 'group' | 'project', path: string): Promise<unknown>;  // parsed JSON; throws on bad JSON
    exists(kind: 'group' | 'project', path: string): Promise<boolean>;
    write(kind: 'group' | 'project', path: string, doc: unknown): Promise<void>;  // mkdir -p; atomic (tmp + rename)
  };
}
export function validPath(path: string): boolean;    // the segment rule in Global Constraints
// main/library.ts — pure Node; index.ts registers ipcMain.handle('library:<name>', …) for each
export function fileFor(root: string, kind: 'group' | 'project', path: string): string;  // throws if invalid or outside
export async function listLibrary(root: string): Promise<{ kind: 'group' | 'project'; path: string }[]>;
```

**Library setup.** `SREDA_LIBRARY` (an env var, for e2e) presets the folder and skips the dialog. Every IPC handler
checks `validPath`, and checks that `fileFor`'s result starts with `root + sep`.

**Session state.**
- `project: { path: string | null; factory: boolean }`.
- `savedDoc: Doc | null`: dirty is `history.current !== savedDoc`.
- Autosave stores `{ doc, project }`. A Plan 2 autosave that is a bare document still loads, as an unnamed project.

**Chrome (`Chrome.tsx`):**
- Top left: `SREDA` and the project path, with ` ●` while dirty.
- Top right: `WIRES` (Task 9), `SAVE` and `NEW`.
- A zoom control at the bottom right: `− 100% +`.
- A hint line at the bottom: the prototype's text, minus `SILENT PROTOTYPE`.

**Saving and opening:**
- ⌘S, or SAVE, with exactly one frame selected — or the frame's own SAVE tool — saves that group.
  - A name field appears pre-filled with the frame's name in lower case.
  - The saved document is `extractGroup` of the frame.
- ⌘S with anything else selected saves the project: straight away when it has a non-factory path, else through a name
  field.
- ⇧⌘S always asks for a name.
- **The name field** is a small input at the top centre with the placeholder `NAME — a/b makes folders`. Enter saves;
  Esc cancels.
  - When the name exists, the field reads `REPLACE <name>? ⏎` and a second Enter overwrites.
  - An invalid name stays in the field, outlined in the destructive colour.
- **The library folder** is asked for on the first save or library open, when `folder()` is null: `choose()`. A
  cancelled dialog cancels the save.
- **The picker** lists `FACTORY/…` plus the library's groups and projects.
- **An entry that fails `read` or `validateDoc`** shows the notice `<path> COULD NOT BE OPENED` and changes nothing.
- **NEW** clears the canvas, as an undo step, and makes the project unnamed.

- [ ] **Step 1: Failing tests** (Review Focus 4):
  - `library.test.ts` on a temp dir:
    - `fileFor` refuses `../x`, `/x`, `a//b`, `a\b`, and a segment of 101 characters;
    - it accepts `acid/303 voice` → `groups/acid/303 voice.sreda-group.json`;
    - `listLibrary` lists nested files and ignores other extensions;
    - a write over an existing file replaces it;
    - `listLibrary` on a deleted folder returns `[]`.
  - store / library (happy-dom with a fake bridge):
    - saving an unnamed project asks for a name; saving again does not;
    - a factory project asks;
    - the dirty `●` appears after an edit and goes after a save;
    - a library entry with bad JSON gives the notice and leaves the document unchanged.
  - e2e with `SREDA_LIBRARY` set to a temp dir:
    - ⌘S saves the project as `jam` and `projects/jam.sreda.json` exists;
    - NEW clears the canvas;
    - ⌘O → `jam` restores it;
    - NEW then ⌘Z restores the patch;
    - select a frame, ⌘S → `kit/drums` writes `groups/kit/drums.sreda-group.json`;
    - placing it twice from the picker gives two frames with distinct ids.
- [ ] **Step 2:** → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** `pnpm check && pnpm e2e` → PASS.
- [ ] **Checkpoint for the user (stop):** save a project and a group into a folder you pick; look at the files in the
  Finder; make a subfolder there and see it in the picker; reopen the project.
- [ ] **Step 5:** Commit `feat: library folder over IPC, SAVE / NEW / ⌘S / ⇧⌘S / ⌘O, project path and dirty mark`.

## Stage D3 — the remaining gestures

### Task 7: Wire hover, cable focus, insert into a cable

**Files:**
- `packages/core/src/ops.ts` and `ops.test.ts`;
- `packages/ui/src/canvas/{Cables.tsx,Canvas.tsx,cablegeom.ts,canvas.css}`;
- the e2e tests.

**Interfaces:**
```ts
export function canInsert(doc: Doc, specs: Specs, id: string): boolean;   // has inputs and outputs, no cables
export function insertIntoCable(doc: Doc, specs: Specs, id: string, cable: Cable): Doc;
// session state: hoverCable: number | null (index into cableGeoms), focus: string | null (module or frame id)
```

**Wire hover:**
- The pointer within 6 screen px of a wire's drawn path (`cableAt(geoms, p, 6 / zoom)`) hovers it, and the canvas gets
  the class `hovering-wire`.
- The hovered wire is drawn at full strength and thicker (3 px); every other wire is at 15 %.
- A tag by the pointer reads `SLOPE › EOC  →  STAGES › ADV`: two spaces around the arrow, port labels from the specs,
  `CLK` / `CLK IN` for frame jacks.
- Both ends' modules get an amber outline (class `wire-end`).
- Wire hover wins over cable focus.

**Cable focus.**
- Hovering a module, or a frame header, focuses it: its cables, or for a frame every cable touching anything inside it,
  get full strength and a 2.5 px width; the rest go to 20 %.
- Selection does not focus.

**Insert into a cable.**
- While a lone module with `canInsert` is dragged, a cable within 8 screen px highlights (class `insert`).
- Dropping there splits it, as one undo step:
  - the source goes to the module's first input of the source's role, else its first input;
  - the module's first output of the target's role, else its first output, goes to the old target.
- The hit test skips cables touching the dragged module.

- [ ] **Step 1: Failing tests:**
  - ops:
    - inserting a FILTER into OSC → OUT gives OSC.out → FILTER.in and FILTER.lp → OUT.l, and the old cable is gone;
    - a module with a cable cannot be inserted;
    - inserting into a trigger cable prefers trigger ports.
  - e2e:
    - hovering the OSC → OUT cable shows the tag `OSC › OUT  →  OUT › L`;
    - dragging a fresh FILTER onto the cable and releasing gives two cables through it;
    - ⌘Z restores the one cable.
- [ ] **Step 2:** → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** `pnpm check && pnpm e2e` → PASS.
- [ ] **Try it (no stop):** hover wires in Acid; drop a FOLD into a cable.
- [ ] **Step 5:** Commit `feat: wire hover tag, cable focus, insert a module into a cable`.

### Task 8: Magnets, replace, ⌘D, R

**Files:**
- `packages/core/src/ops.ts` and `ops.test.ts`;
- `packages/ui/src/canvas/{magnets.ts,magnets.test.ts,Canvas.tsx,Panel.tsx,Picker.tsx,keys.ts}`;
- the e2e tests.

**Interfaces:**
```ts
// magnets.ts — the prototype's magnet(); thr in canvas px; gap 0, or RGAP inside a 'route' frame
export function magnet(box: Rect, others: Rect[], thr: number, gap: number):
  { dx: number; dy: number; gx: { x: number; y0: number; y1: number } | null; gy: { y: number; x0: number; x1: number } | null };
// ops.ts
export function replaceModule(doc: Doc, specs: Specs, id: string, type: string): { doc: Doc; id: string };
export function duplicate(doc: Doc, specs: Specs, ids: readonly string[]): { doc: Doc; ids: string[] };  // modules only, +32 / +32
export function randomise(doc: Doc, specs: Specs, id: string, rng: () => number): Doc;
```

**Magnets.**
- While a module or a selection is dragged, its bounding box snaps flush to the nearest other module's edges within
  `10 / zoom`.
- The candidate modules are those not in the selection. A frame's children count only when they are not being moved.
- Guide lines (`.sr-guide`, 1 px, muted) show the active snaps.
- ⌘ held while dragging turns magnets off.
- Inside a `'route'` frame the gap is 32 instead of flush.

**Replace (§4).**
- Double-clicking a module's name opens the picker as `REPLACE <MODULE>`, offering modules only.
- On Enter the new module takes the same place, parent and frame.
- Cables move to the port with the same id, else to the next unused port of the same role; cables with no match are
  removed.
- Knobs with the same id keep their value in real units, re-encoded for the new taper. Options keep their index,
  clamped.
- Attenuverters and ratios move with a port whose id is kept.
- It is one undo step.

**⌘D.** Duplicate the selection's modules with the cables between them, 32 px right and down. Select the copies and
re-parent them.

**R.** With the pointer over a module, set every visible knob to a uniform random value within its `randomRange`
(default: the full range), in real units, then re-encode.
- Options, hidden params, attenuverters and ratios are left alone.
- It is one undo step, sent as knob messages, not a plan.

- [ ] **Step 1: Failing tests:**
  - magnets:
    - a box 6 px right of a module's right edge snaps flush, with `gx.x` at that edge;
    - 12 px does not snap at thr 10;
    - with gap 32 it snaps to 32 px apart;
    - top alignment snaps `dy`.
  - ops:
    - OSC → COMPLEX keeps `freq`'s Hz value and the PTCH cable;
    - FILTER → FOLD moves `in` and drops `bp` / `hp` cables, keeping `lp`'s cable on `out`;
    - replace keeps the parent;
    - `duplicate` copies inner cables only, with fresh ids;
    - `randomise` with a fixed rng keeps every knob inside its `randomRange` and leaves options alone.
  - e2e:
    - double-click OSC's name → `REPLACE OSC` → `complex` ⏎ → a COMPLEX with the cable to OUT;
    - R over OSC changes FREQ and ⌘Z restores it;
    - ⌘D on OSC + OUT gives four modules and two cables;
    - dragging OUT to 5 px from OSC's right edge lands it flush.
- [ ] **Step 2:** → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** `pnpm check && pnpm e2e` → PASS.
- [ ] **Checkpoint for the user (stop):** arrange a patch with magnets; replace OSC by COMPLEX; R a few modules; ⌘D a
  voice.
- [ ] **Step 5:** Commit `feat: magnets, replace, ⌘D, R`.

## Stage D4 — WIRES

### Task 9: The sidebar and WIRES: sections, rows, problems

**Files:**
- `packages/core/src/wires.ts` and `wires.test.ts`;
- `packages/ui/src/sidebar/{Sidebar.tsx,Wires.tsx}`, `packages/ui/src/{store.ts,canvas/Chrome.tsx,canvas/Canvas.tsx,canvas/keys.ts}`;
- the e2e tests.

**Interfaces:**
```ts
export type SectionKey = string | 'ungrouped' | 'between';   // a frame id, or one of the two
export function wireSection(doc: Doc, cable: Cable): SectionKey;   // innermost frame holding both ends
export interface WirePort { id: string; port: string; role: Role; label: string }   // label 'SLOPE 2 › EOC'
export function portLabel(doc: Doc, specs: Specs, id: string, port: string): string;
export function allPorts(doc: Doc, specs: Specs, dir: 'in' | 'out'): WirePort[];    // frames' CLK / CLK IN included
export interface Problem { id: string; text: string; info: boolean }
export function wireProblems(doc: Doc, specs: Specs): Problem[];
// session: sidebar: { open: boolean; width: number; selOnly: boolean; q: string; closed: Record<string, boolean>;
//                     picked: number | null }
```

**Problems** (prototype `wireProblems`, with `NEEDS_INPUT = { filter: 'in', lpg: 'in', fold: 'in', delay: 'in', follow:
'in', out: 'l' }`). The texts are exact:
- `<MODULE> — sound does not reach any OUT`;
- `<MODULE> › <PORT> — empty input`;
- `RHYTHM › CLK — no clock`.

Listed dimmed, as information:
- `loop: A → B → A`;
- `muted: <FRAME>`.

**Sidebar:**
- W or the WIRES button toggles it; Esc closes it.
- It is docked right. The canvas element, the top-right buttons, the zoom control and the hint line end at its edge,
  because the canvas's right inset equals the width.
- The width is 440 on open; dragging its left edge sets it within 320 … 70 % of the window.
- A tab row holds `WIRES` (the only tab), `SELECTION` (a toggle) and `✕`.
- A filter field matches module and port names.

**Sections**, each collapsible, with a wire count:
- one per frame, outer first, nested ones indented and titled `POLY › VOICE A`;
- `UNGROUPED`;
- `BETWEEN GROUPS`;
- `PROBLEMS`.

**A row:**
- It reads `SOURCE › PORT  →  DEST › PORT   value   ✕`, with a role-coloured dot at each end.
- The value is the destination's attenuverter or ratio, edited exactly as on the module (drag, wheel, double-click).
  Audio destinations show no value.
- ✕ removes the wire.
- Normals are listed dimmed in their module's section as `STAGES › ADV  ← STAGE TIMER (normal)`, with no ✕.
- Clicking a problem selects that module and fits it in view.

**Width.** The canvas width used by `fit`, the picker clamp and `toCanvas` is the canvas element's `clientWidth`
(Review Focus 5).

- [ ] **Step 1: Failing tests:**
  - wires:
    - a cable inside G2 ⊂ G1 belongs to G2;
    - a cable from G1 to a loose module is `between`;
    - loose to loose is `ungrouped`;
    - `allPorts('out')` includes `GROUP 1 › CLK`;
    - problems on a FILTER with an empty IN, on a RHYTHM with no CLK, on an OSC → FILTER chain with no OUT, plus a loop
      and a muted frame as info;
    - a SLOPE with no IN is not a problem.
  - e2e:
    - W opens the sidebar and the canvas width shrinks by 440;
    - a framed OSC → OUT lists its wire under `GROUP 1`;
    - a lone FILTER shows `FILTER › IN — empty input` under PROBLEMS;
    - dragging a row's value changes the attenuverter on the module;
    - ✕ removes the cable;
    - with the sidebar open, F fits the patch inside the visible canvas: every module's right edge < the window width −
      440 (Review Focus 5).
- [ ] **Step 2:** → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** `pnpm check && pnpm e2e` → PASS.
- [ ] **Checkpoint for the user (stop):** open WIRES on Acid and Polymeter: read the sections, set depths from the
  sidebar, fix a problem it lists.
- [ ] **Step 5:** Commit `feat: sidebar and WIRES — sections, rows, values, normals, problems`.

### Task 10: WIRES: rewiring and the link to the canvas

**Files:**
- `packages/ui/src/sidebar/{Wires.tsx,PortList.tsx}`, `packages/ui/src/{store.ts,canvas/Canvas.tsx,canvas/Cables.tsx}`;
- the e2e tests.

**Interfaces:**
```ts
// PortList: anchored under the clicked port name; same role as the other end first, then the rest; a filter field;
// ↑ / ↓ / Enter / Esc; props: ports: WirePort[], otherRole: Role, pick(p: WirePort): void, candidate(p: WirePort | null): void
// session: candidate: { id: string; port: string } | null; preview: { from: Pt; to: Pt } | null
export function glideTo(view: View, target: Rect, visible: Rect): View | null;  // null when already visible; centres it
```

**Moving an end.**
- Clicking a port name in a row opens the PortList for that end. Picking a port moves that end of the wire, across the
  whole canvas if needed, as one undo step.
- `+ new wire`, under BETWEEN GROUPS, picks an output, then an input.

**Linking to the canvas.**
- Hovering a row lights that wire on the canvas exactly as wire hover does, and outlines both of its modules in amber.
- A row picked with a click or ↑ / ↓ keeps that state after the pointer leaves.
- The pointer over the sidebar never hovers canvas wires.
- In the PortList, the candidate port gets an amber ring on the canvas and its module an amber outline. Once one end is
  fixed, a dashed amber preview wire runs from that end to the candidate.
- If a candidate, or a row picked with ↑ / ↓, stays the same for 250 ms while it is outside the visible canvas, the
  view glides to centre its module: 220 ms, ease-out cubic, zoom unchanged (prototype `ensureVisible`).

**Selection.**
- Selecting on the canvas highlights the rows touching the selection and scrolls the first one into view.
- `SELECTION` keeps only those rows.

**Keys** while the sidebar is open and the canvas has no text focus:
- ↑ / ↓ move between rows;
- Backspace removes the picked wire;
- Enter opens the PortList for its input end.

- [ ] **Step 1: Failing tests:**
  - `glideTo`: null for a target inside the visible rect; otherwise the target's centre lands at the visible rect's
    centre with z unchanged.
  - e2e:
    - in WIRES, click the destination port of OSC → OUT, type `r`, Enter → the cable now ends at `OUT › R`;
    - hovering a row gives that cable the class `lit` and both modules `wire-end`;
    - `+ new wire` OSC OUT → FILTER IN adds a cable;
    - ↓ then Backspace removes the first wire;
    - SELECTION with OSC selected shows only OSC's wires.
- [ ] **Step 2:** → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** `pnpm check && pnpm e2e` → PASS.
- [ ] **Checkpoint for the user (stop):** rewire Acid's filter envelope from the sidebar; walk the wires with ↑ / ↓
  and watch the canvas follow.
- [ ] **Step 5:** Commit `feat: WIRES rewiring, port list, canvas link, glide to off-screen candidates`.

## Stage D5 — the size the first build promises

### Task 11: 200 modules — performance and the benchmark

**Files:**
- `packages/core/src/{bigpatch.ts,compile.test.ts}`;
- `engine/tests/{realtime.rs,fixtures/plan-200.json}`;
- `packages/protocol/src/{engine.ts,bench.test.ts}`;
- `packages/ui/src/{store.ts,audio/host.ts,audio/worklet.ts}` and `store.test.ts`;
- `docs/backlog.md`, `docs/ROADMAP.md`.

**Interfaces:**
```ts
export function bigPatch(specs: Specs, n = 200): Doc;   // 20 frames × 10: COMPLEX→FOLD→FILTER→LPG→MIX chains clocked by
                                                        // SLOPE / STAGES / RHYTHM, a SCOPE per frame, one OUT; mulberry32(1) knobs
// ToEngine 'plan' carries bytes: { t: 'plan'; seq: number; bytes: Uint8Array } (transferred); the worklet passes them
// straight to engine_alloc / engine_apply
```

**Backlog items this task closes:**
- **Plans on the audio thread.** Plans are encoded with `TextEncoder` on the main thread and the buffer is
  transferred, so the worklet no longer runs `JSON.stringify` or a hand-written UTF-8 encoder.
- **Moves that send plans.** A move that changes no parent, and touches no `'route'` frame's packing, sends no plan.
  The test: `compile` output minus `seq` is deep-equal, checked by a structural key, a string of the doc without
  positions.

**Budgets:**
- natively, a minute of `plan-200.json` takes under 25 % of real time;
- in WASM in Node, 10 s of `bigPatch` take under 50 % of real time;
- in the UI, `compile(bigPatch)` takes under 10 ms;
- a move preview of one module in `bigPatch` recomputes ≤ 4 cable geometries.

- [ ] **Step 1: Failing tests:**
  - compile:
    - `bigPatch(SPECS)` has 200 modules, validates and compiles;
    - it writes `engine/tests/fixtures/plan-200.json`, like the existing fixtures;
    - compile takes < 10 ms, median of 5 runs.
  - realtime.rs (ignored, release): `two_hundred_modules_run_a_minute_in_under_a_quarter_of_real_time`.
  - `bench.test.ts`: 10 s of `bigPatch` through `renderDoc` in < 5 s wall time.
  - store:
    - moving a module within free space sends no plan;
    - moving it into a frame sends one;
    - the posted plan message carries a `Uint8Array`.
  - cablegeom: a one-module move preview in `bigPatch` recomputes ≤ 4 geometries.
  - `alloc.rs`: `plan-200.json` applied, then a minute of `process` → zero allocations.
- [ ] **Step 2:** → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** `pnpm check && pnpm e2e` → PASS. Also `cargo test --release -p sreda-engine --test realtime --
  --ignored` → PASS; note the printed percentage.
- [ ] **Checkpoint for the user (stop):** a 200-module patch (the e2e helper `window.__sreda.load(bigPatch)`, exposed
  in dev builds) plays without dropouts; panning, dragging and mute stay smooth.
- [ ] **Step 5:** Update `docs/backlog.md`: strike the items this plan closed (cables at 200 modules, plans on the
  audio thread, the cable gradient). In `docs/ROADMAP.md` record Plan 3 as done and the first build as complete; next
  is milestone 2, the sound pack.
- [ ] **Step 6:** Commit `perf: 200-module patch in real time; plans encoded on the main thread; no plan for moves`.

---

## After the last task

Run a fresh reviewer agent over the whole branch, apply its fixes and defer the rest to `docs/backlog.md` ("From the
Plan 3 review"). Then use the finishing-a-development-branch skill.
