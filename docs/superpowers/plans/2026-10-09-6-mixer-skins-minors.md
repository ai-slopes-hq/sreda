# Mixer, skins, minors — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Clear the deferred minors of Plans 4–5, make every UI colour a skin token with the six skins chosen in a
SETTINGS sidebar tab, and add the MIX tab: a strip per OUT (its LVL, mute, solo, meter) and a master fader.

**Architecture:** Skins are CSS custom properties set on `:root` from one table in `packages/ui/src/skins.ts`; the
choice lives in the main process's `settings.json` behind the bridge. The mixer keeps one truth per value: a strip's
fader is the OUT's LVL knob, mute / solo are hidden options of OUT (fixed values → messages), the master is a document
field sent as a message; the engine applies solo across OUTs and the master gain before the fixed master stage.

**Tech Stack:** Rust (engine, WASM), TypeScript (core, protocol), SolidJS (ui), Electron (app), Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-07-canvas-ux-design.md` revision 22 — §1a (skins, the token table), §5a
(tabs; MIX; SETTINGS), §7 (the output chain); `docs/backlog.md` "From the Plan 5 review" and "From the Plan 4 review".

## Global Constraints

- Answer the user in Russian; code, docs, commits and UI copy English. Commits end with
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`; `git add` files explicitly, never `git commit -a`.
- Audio-thread rules (CLAUDE.md): nothing in `Engine::process`, `Dsp::process` or the worklet's `process()` allocates,
  locks, logs or panics; `engine/tests/alloc.rs` guards it. Parameters glide 10 ms.
- The skin is app-wide (never in a document); a new install starts on DEFAULT; a frame's tint stays an index 0–6.
- Mute wins over solo; while any strip is soloed only soloed strips sound; listening and audition skip the strips but
  go through the master stage.
- `pnpm check` and `pnpm e2e` green before every commit.

## Review Focus

1. **Old documents** (no `master`, OUT without `mute` / `solo`) open with master 1 and every strip unmuted, unsoloed,
   sounding as before (Task 4 test).
2. **Solo with the soloed OUT deleted or inside a muted frame**: deleting the only soloed OUT brings the others back;
   solo inside a muted frame keeps the others silent and the soloed one silent too (Task 4 test).
3. **A skin hovered then the list left without a click** returns to the chosen skin; a hover never writes
   `settings.json` (Task 3 test).
4. **A broken or missing `settings.json` / an unknown skin name** starts on DEFAULT without an error (Task 3 test).
5. **Undo of a fader drag, a mute click, a master drag**: each is one step, and the engine follows the undone value
   (Task 5 e2e).

---

### Task 1: The deferred minors of Plans 4 and 5

**Files:** `packages/core/src/{frames.ts,frames.test.ts,doc.ts,wires.ts,names.ts?}`, `packages/ui/src/canvas/{Cables.tsx,Canvas.tsx,Cables.test.tsx}`,
`engine/src/{samples.rs,engine.rs}`, `docs/backlog.md` (strike what is done).

One commit; each item with the test named:
- **Fixed point:** the STACK re-pack loop, when it runs out of its 8 rounds, keeps the last order whose pack is stable
  under `packFrame` (or falls back to strict (y, x)); test: a forced cycle (two-cycle fixture from Task 1 of Plan 5's
  seed 2 setup) ends in a fixed point.
- **Off-grid widths:** skyline positions snap child x to the 8 px grid when a child's width is off-grid; test with a
  free child frame of width 357.
- **Migration re-fit:** `validateDoc` re-fits STACK / free parents around migrated former-FIX children
  (`repackManaged` on their chains); test with a STACK parent holding a former FIX child.
- **WIRES and collapse:** cables hidden inside a collapsed frame are listed in WIRES dimmed with the suffix
  `(collapsed)` and picking one expands that frame; `rows.test.ts`.
- **Ghost normals:** their stubs are memoised by the two jack positions (no rebuild per document change unless a
  jack moved); a test of the Canvas `wholeNormal` predicate (sidebar open / either frame hovered / selected).
- **Tests to strengthen:** the nested-resize test proves the parent re-pack comes from `also` (without it the parent
  overlaps); the migration's reading-order assertion compares with the pre-migration order; a block test with four
  jacks on a side (`h` = 28 + 16 + 96, rows at 48, 72, 96, 120); the collapse e2e compares the master peak collapsed
  and expanded within 10 %.
- **Tidy:** break the `frames.ts` ↔ `wires.ts` cycle (move `portLabel` and `nameOf` users into `names.ts`, which
  imports neither); drop `rectsOf2`, the bare `{}` block and the filler assertion in `frames.test.ts`.
- **Plan 4:** `Sample::from_planar` takes the staging `Vec<f32>` by value and splits it without copying the left
  channel (`Vec::split_off` / truncate); `alloc.rs` still zero.
- [ ] Steps: failing tests → implement → `pnpm check && pnpm e2e` → commit `chore: Plan 4–5 review minors`.

### Task 2: Skin tokens — every colour from the §1a table

**Files:**
- Create: `packages/ui/src/skins.ts`, `packages/ui/src/skins.test.ts`.
- Modify: `packages/ui/src/canvas/canvas.css` (every colour literal → `var(--<token>)`; the `:root` block holds
  DEFAULT's values so the page is right before any script runs), `Frame.tsx` (`TINT_FILL` → tokens `tint-0`…`tint-6`
  and their swatches), `glyphs.ts` (`ROLE` → `var(--role-…)` used through `style`, since SVG presentation attributes
  do not resolve `var()`), `Jack.tsx`, `Knob.tsx`, `Panel.tsx`, `Cables.tsx`.

**Interfaces:**
- Produces: `type SkinName = 'DEFAULT' | 'ANNABIOSIS' | 'KANAGAWA' | 'TOUCH' | 'NORD' | 'TOKYO NIGHT'`;
  `SKINS: Record<SkinName, Record<Token, string>>` with every token row of §1a's table verbatim (hex values copied
  exactly); `TOKENS: readonly Token[]`; `applySkin(name: SkinName, root?: HTMLElement): void` (sets
  `--<token>` on `root`, default `document.documentElement`).
- [ ] **Step 1: Failing tests** (`skins.test.ts`): every skin defines every token; DEFAULT's values equal the `:root`
  values in `canvas.css` (parse the file); `applySkin('NORD')` sets `--ground` to `#2e3440`; a scan of
  `packages/ui/src/**/*.{css,ts,tsx}` (excluding `skins.ts` and tests) finds no `#rrggbb` / `rgb(` / `rgba(` literal
  outside `canvas.css`'s `:root` block.
- [ ] **Step 2:** → FAIL. **Step 3:** Implement (map each literal to the token whose "Used for" fits; a literal with
  no token gets a new token added to all six skins in `skins.ts` *and* to §1a's table in the spec — list them in the
  report). **Step 4:** `pnpm check && pnpm e2e` (DEFAULT looks unchanged: take a before/after screenshot of the
  starter patch and the Pulse project; they must match within anti-aliasing).
- [ ] **Step 5:** Commit `feat: every UI colour is a skin token`.

### Task 3: Sidebar tabs and SETTINGS — choosing a skin

**Files:** `packages/app/src/main/{index.ts,library.ts?}` and `preload/index.ts` (`settings: { skin(): Promise<string | null>; setSkin(name: string): Promise<void> }`, read / merged into `<userData>/settings.json` beside `library`),
`packages/ui/src/library.ts` (bridge type), `packages/ui/src/store.ts` (`sidebar.tab: 'WIRES' | 'MIX' | 'SETTINGS'`,
remembered in the session), `packages/ui/src/sidebar/{Sidebar.tsx,Settings.tsx}` (new tab row; the skin list),
`packages/ui/src/canvas/keys.ts` (W → WIRES; the same key while that tab shows closes), `App.tsx` (apply the saved
skin at start), tests and e2e.

- [ ] **Step 1: Failing tests:**
  - app `library.test.ts` (or a new `settings.test.ts`): `setSkin('NORD')` keeps `library` in `settings.json`;
    Review Focus 4: a corrupt `settings.json` or `skin: 'PURPLE'` reads as `null`.
  - ui `Settings.test.tsx`: six rows with names and seven swatches each; hovering KANAGAWA applies it (`--ground` =
    `#1f1f28`) without calling `setSkin`; leaving the list restores the chosen skin (Review Focus 3); a click calls
    `setSkin` and applies it.
  - e2e: W opens WIRES; clicking SETTINGS, then NORD → the canvas background is `rgb(46, 52, 64)`; relaunch with the
    same user-data → still NORD.
- [ ] **Step 2:** → FAIL. **Step 3:** Implement. **Step 4:** `pnpm check && pnpm e2e`.
- [ ] **Step 5:** Commit `feat: sidebar tabs; SETTINGS chooses the skin`.

### Task 4: The mixer in the engine and the document

**Files:** `engine/src/modules/out.rs` (hidden options `mute`, `solo`: OFF / ON; a 10 ms gain glide; `state()` = the
block's peak after LVL, mute and solo), `engine/src/{dsp.rs,engine.rs,master.rs,wasm.rs}` (`Ctx.solo_any: bool`,
computed per block from the OUT slots' fixed values before they run; `Master::set_level(v)` gliding 10 ms, applied
before the DC blocker; `engine_master(e, v)`), `packages/protocol/src/{messages.ts,engine.ts}` (`{ t: 'master';
value: number }`, `WasmEngine.master(v)`), `packages/ui/src/audio/worklet.ts`, `packages/core/src/doc.ts`
(`Doc.master: number`, validated 0…1, default 1), `pnpm specs`, fixtures, tests.

- [ ] **Step 1: Failing tests:**
  - Rust `out.rs`: mute ON → silence within 10 ms (no step > 0.05 on a 0.5 DC input); `state()` is the peak after
    LVL. Engine: two OUTs, solo ON on the first → only the first sounds; solo also ON on a muted OUT → that one silent
    and the other still silent (Review Focus 2); removing the soloed OUT's node (new plan) → the other sounds again.
    `master(0.5)` halves a steady tone's level before the limiter (within 1 %, after 10 ms). `alloc.rs`: mute / solo
    / master messages allocate nothing.
  - core `doc.test.ts`: Review Focus 1 — a document without `master` validates with `master: 1`; OUT params get
    `mute: 0`, `solo: 0`; `master: 3` clamps to 1.
  - protocol `engine.test.ts`: `master(0)` silences the starter patch.
- [ ] **Step 2:** → FAIL. **Step 3:** Implement. **Step 4:** `pnpm check && pnpm e2e`; realtime unchanged.
- [ ] **Step 5:** Commit `feat: OUT mute / solo, the master fader in the engine`.

### Task 5: The MIX tab

**Files:** `packages/ui/src/sidebar/{Mix.tsx,Mix.test.tsx,mix.ts}` (`mixStrips(doc, specs): { id: string; name: string; muted: boolean }[]` — reading order of the OUT modules; name = the frame holding only this OUT, else `nameOf`; `muted` = inside a muted frame),
`packages/ui/src/store.ts` (`setMaster(v, merge)`: one undo step per drag, sends `master`; the master is also sent on
`attach`, after undo / redo and when a project opens), `Sidebar.tsx` (the MIX tab), `keys.ts` (M → MIX), the hint
line, e2e.

- [ ] **Step 1: Failing tests:**
  - `mix.test.ts`: three OUTs (one alone in frame DRUMS, two in frame BASS, one in no frame) → names `DRUMS`,
    `OUT 2`, `OUT 3` in reading order; an OUT in a muted frame has `muted: true`.
  - `Mix.test.tsx`: a strip's fader drag calls the OUT's `knob('level', …)`; M / S call `params(id, { mute: 1 })` /
    `{ solo: 1 }`; the master fader calls `setMaster`; a click on a name selects the OUT.
  - e2e: M opens MIX with one strip `OUT` and MASTER; S on the strip keeps sound; M on the strip → the master peak
    falls below 0.001; ⌘Z → sound returns (Review Focus 5); the master fader to 0 → silence; ⌘Z → sound; turning OUT's
    LVL knob on the canvas moves the strip's fader.
- [ ] **Step 2:** → FAIL. **Step 3:** Implement. **Step 4:** `pnpm check && pnpm e2e`.
- [ ] **Step 5:** Update `docs/ROADMAP.md` Status; commit `feat: the MIX tab — a strip per OUT and the master`.

---

## After the last task

Final whole-branch review on the most capable model, one fix wave, then the user's hands-on check (skins in SETTINGS;
MIX on a project with several OUTs) and merge after the user's OK.
