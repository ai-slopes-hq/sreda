# The LIBRARY tab, ⌘O, Import Samples, sample analysis and unloading — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sample loading never freezes the UI and unused samples leave memory; projects open from anywhere with ⌘O
and save back there; samples import through the system dialog; the sidebar gets a LIBRARY tab (PROJECTS, GROUPS,
SAMPLES) and the picker loses its PROJECTS tab.

**Architecture:** Analysis (AIFF parse, onsets, peaks) moves to a Vite Web Worker behind an injectable
`analyse(...)` so the registry stays testable; the registry ages out samples the shown document stops naming and the
engine drops them on an `unsample` message. File dialogs live in the Electron main process (IPC handlers; an app menu
item for Import Samples); a session's project is either a library path or an absolute file path.

**Tech Stack:** TypeScript, SolidJS, Electron (main / preload IPC, `dialog`, `Menu`), Rust engine (WASM), Vitest,
Playwright.

**Spec:** `docs/superpowers/specs/2026-10-07-canvas-ux-design.md` revision 23 — §5a (LIBRARY), §6 (the picker, ⌘O,
File › Import Samples…), §7a ("Sample analysis off the main thread", "Unused samples are unloaded").

## Global Constraints

- Russian to the user; English code, docs, commits, UI copy. Commits end with
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`; `git add` explicit files, never `git commit -a`.
- Audio-thread rules (CLAUDE.md): `unsample` frees memory while handling the message, never inside `process`;
  `engine/tests/alloc.rs` stays zero.
- The main process reads files only under the library folder, except files the user picked in a system dialog
  (⌘O, Import Samples) — those paths come from `dialog.showOpenDialog`, never from the renderer.
- Unload delay 30 s; analysis results equal today's (`onsets`, `peaksOf`, `parseAiff`) exactly.
- `pnpm check` and `pnpm e2e` green before every commit.

## Review Focus

1. **A sample unloaded and asked for again** (undo brings back its SAMPLER) reloads and sounds; the module never
   points at a freed pool slot that a different sample now fills (Task 2 test).
2. **⌘O on a file outside the library, then ⌘S**: the file on disk changes, the library does not; the `●` clears
   (Task 3 e2e).
3. **⌘O on a non-SREDA JSON or a corrupt file**: notice `<NAME> COULD NOT BE OPENED`, the current project and its
   undo history stay (Task 3 test).
4. **Import Samples with a name already in `samples/`** gets a free name (`kick 2.wav`); with SAMPLER selected only
   the first file becomes its sample (Task 4 test).
5. **The worker fails or is unavailable** (tests, a crash): analysis falls back to the main thread, loading still
   succeeds (Task 1 test).

---

### Task 1: Sample analysis in a Web Worker

**Files:** Create `packages/ui/src/samples/analysis.worker.ts`, `packages/ui/src/samples/analysis.ts`
(`analyse(channels: Float32Array[], rate: number): Promise<{ hits: {at:number;strength:number}[]; peaks: Float32Array }>`
and `parseAiffOff(bytes: ArrayBuffer): Promise<{ channels: Float32Array[]; rate: number }>` — post to the worker with
transferred buffers, return them back; fall back to the in-thread `onsets` / `peaksOf` / `parseAiff` when `Worker` is
missing or the worker errors); modify `packages/ui/src/samples.ts` (`decodeSample` uses them); tests; e2e.

- [ ] **Step 1: Failing tests:** `analysis.test.ts` — with no `Worker` (Vitest/happy-dom) `analyse` returns exactly
  `onsets(...)` and `peaksOf(...)` for a click track (Review Focus 5); a fake worker that throws → same result.
  e2e — a 3-minute stereo WAV (generated in the test like `wav()` in `e2e/app.spec.ts`) imported by drop: a
  requestAnimationFrame heartbeat in the page sees no gap above 200 ms while it loads, and the SAMPLER's display
  shows its peaks.
- [ ] **Step 2:** → FAIL. **Step 3:** Implement (Vite `new Worker(new URL('./analysis.worker.ts', import.meta.url),
  { type: 'module' })`; the renderer is served from `app://sreda/` — confirm the worker loads there in e2e).
  **Step 4:** `pnpm check && pnpm e2e`. **Step 5:** Commit `feat: sample analysis in a worker`.

### Task 2: Unused samples are unloaded

**Files:** `packages/ui/src/samples.ts` (`loadDoc` marks the paths the shown document names; a path unnamed for
`UNLOAD_MS = 30_000` is dropped: `bytes`, `ready`, `status`, `pending` deleted, `{ t: 'unsample', id }` posted; ids stay
stable per path; inject the clock / timer for tests), `packages/protocol/src/{messages.ts,engine.ts}`
(`unsample(id)`), `packages/ui/src/audio/worklet.ts`, `engine/src/{samples.rs,engine.rs,wasm.rs}`
(`SamplePool::remove(id)`, `engine_unsample`; `Sample::from_planar` shrinks the left channel's capacity so a stereo
sample holds 2× frames — the backlog item), tests; strike the two backlog items.

- [ ] **Step 1: Failing tests:** `samples.test.ts` — a path named, then not named for 30 s (fake timers) → `status`
  undefined, `peaks` null, an `unsample` posted with its id; named again within 30 s → nothing dropped; Review
  Focus 1: dropped then asked for again → read again, `ready`, the same id, a new `sample` posted. Rust — `remove`
  frees the slot (`get` → None) and a later `insert` under that id works; `alloc.rs`: processing after an `unsample`
  allocates nothing; a stereo `from_planar` has `capacity() == frames` per channel.
- [ ] **Step 2:** → FAIL. **Step 3:** Implement. **Step 4:** `pnpm check && pnpm e2e`.
  **Step 5:** Commit `feat: unused samples are unloaded`.

### Task 3: ⌘O opens any project file; ⌘S saves it back; no PROJECTS tab in the picker

**Files:** `packages/app/src/main/index.ts` + `preload/index.ts` (`project.open(): Promise<{ path: string; doc: unknown } | null>` — `dialog.showOpenDialog` filtered to `*.sreda.json`, reads and parses the chosen file; `project.save(path: string, doc: unknown): Promise<void>` — only to a path previously returned by `open` in this run, written atomically), `packages/ui/src/library.ts` (bridge types; `Session.project` gains `file?: true` for an absolute path; `save()` writes back through `project.save` when `file`; save-as always into the library), `packages/ui/src/autosave.ts` (persist the new project shape), `packages/ui/src/canvas/{keys.ts,patching.ts,Picker.tsx}` (⌘O → `project.open`; picker tabs ALL · MODULES · GROUPS · SAMPLES), the top-left path display (an absolute path shows its file name), tests, e2e.

- [ ] **Step 1: Failing tests:** app — `project.save` refuses a path not returned by `open`; ui — a `file` project
  saves through `project.save`, save-as goes to the library; Review Focus 3: `open` returning a non-document →
  notice `<NAME> COULD NOT BE OPENED`, the session's document and history unchanged; `patching.test.ts` — no
  PROJECTS tab. e2e (dialogs stubbed via `SREDA_E2E_OPEN=<path>` read by main instead of showing the dialog):
  Review Focus 2 — open a project file outside the library, change a knob, ⌘S → the file on disk changed, the
  library's `projects/` unchanged, `●` gone.
- [ ] **Step 2:** → FAIL. **Step 3:** Implement. **Step 4:** `pnpm check && pnpm e2e`.
  **Step 5:** Commit `feat: ⌘O opens any project file and saves it back`.

### Task 4: File › Import Samples…

**Files:** `packages/app/src/main/index.ts` (an application `Menu` with File › Import Samples… ⇧⌘I, keeping the
default Edit / View / Window menus; `samples.importFromDialog(): Promise<string[]>` — `dialog.showOpenDialog`
multi-select filtered to the sample extensions, each file copied with the existing `importSample` logic; the menu
item sends `menu:importSamples` to the renderer, which calls it), `preload/index.ts`, `packages/ui/src/library.ts`,
`packages/ui/src/canvas/Canvas.tsx` (after an import: a selected SAMPLER / GRAINS gets the first path via
`setSample`; else the sidebar opens on LIBRARY › SAMPLES — until Task 5 lands, on LIBRARY with the paths kept in
`st.sidebar.highlight: string[]`), tests, e2e (`SREDA_E2E_IMPORT=<paths>` stubs the dialog).

- [ ] **Step 1: Failing tests:** app — `importFromDialog` copies two files, a second `kick.wav` becomes
  `kick 2.wav` (Review Focus 4); ui — with SAMPLER selected the first path becomes its sample (one undo step), the
  second is only imported; nothing selected → `sidebar.tab` = 'LIBRARY' and the highlight holds both paths. e2e —
  ⇧⌘I with the stub and a SAMPLER selected → its display tag shows the first file.
- [ ] **Step 2:** → FAIL. **Step 3:** Implement. **Step 4:** `pnpm check && pnpm e2e`.
  **Step 5:** Commit `feat: File › Import Samples…`.

### Task 5: The LIBRARY tab

**Files:** Create `packages/ui/src/sidebar/Library.tsx` (+ test); modify `Sidebar.tsx` (tab LIBRARY between MIX and
SETTINGS; `sidebar.tab` gains `'LIBRARY'`), `keys.ts` (none new: ⌘O is the dialog), `Canvas.tsx` (drop targets for
rows dragged from the sidebar: a group places at the drop point; a sample places a SAMPLER or sets a SAMPLER /
GRAINS sample — reuse the picker's `place` / `useSample` paths), `canvas.css` (tokens only), e2e; update
`docs/ROADMAP.md` Status.

- Sections PROJECTS, GROUPS, SAMPLES, each collapsible with its own filter; rows show folder · name; factory entries
  first in PROJECTS and GROUPS. PROJECTS: click opens (one undo step, fit); header SAVE AS and NEW. GROUPS: click →
  middle of the view; drag → drop point. SAMPLES: hover auditions (120 ms, as the picker), drag onto canvas, header
  IMPORT (Task 4), highlighted paths from Task 4 shown first and scrolled into view.
- [ ] **Step 1: Failing tests:** `Library.test.tsx` — the three sections list factory + library entries filtered by
  their field; a PROJECTS click calls `openProject`; a GROUPS click calls `placeGroup` at the view's middle; hovering
  a SAMPLES row calls `audition(path)` after 120 ms and leaving calls `audition(null)`. e2e — open LIBRARY, click the
  factory Acid project → the ACID frame shows; drag the factory group `303 voice` onto the canvas → a new frame; drag
  a sample row onto empty canvas → a SAMPLER with it.
- [ ] **Step 2:** → FAIL. **Step 3:** Implement. **Step 4:** `pnpm check && pnpm e2e`.
- [ ] **Step 5:** Commit `feat: the LIBRARY tab — projects, groups and samples`.

---

## After the last task

Final whole-branch review on the most capable model, one fix wave, then the user's hands-on check (⌘O a project from
the Desktop and ⌘S it; ⇧⌘I a few samples; LIBRARY's three sections; load a long sample and keep working) and merge
after the user's OK.
