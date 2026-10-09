# Frames: dense STACK, resize re-packs, collapse — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** STACK packs a frame densely as a frame mode, dragging a STACK / FIX frame's width re-packs it live, and any
frame collapses to a block showing only its connections (C / ⇧C), so a project of many groups reads at a glance.

**Architecture:** Everything geometric lives in `packages/core/src/frames.ts` (packing, widths, the collapsed block and
where a hidden port's cables end); the UI draws what core computes: `Frame.tsx` draws the block, `cablegeom.ts`
skips hidden cables and ends crossing ones on block jacks, `Canvas.tsx` hides what a collapsed frame holds and wires
the gestures and keys.

**Tech Stack:** TypeScript (core), SolidJS (ui), Vitest, Playwright + Electron (e2e).

**Spec:** `docs/superpowers/specs/2026-10-07-canvas-ux-design.md`, revision 20, §5 (STACK, the packing width, WIRE
FIX, Collapse) and §4 (keys).

## Global Constraints

- Answer the user in Russian; code, docs, commits and UI copy are English. Commits end with
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`; add files explicitly (never `git commit -a`).
- STACK padding 16 px (`GPAD`), no gaps; WIRE FIX padding and channels 32 px (`RGAP`); frame minimum 352 × 96
  (`FRAME_MIN`); header 28 px (`GHEAD`); 8 px grid.
- STACK and WIRE FIX exclude each other; each on / off, each resize, each collapse / expand is one undo step.
- Collapsing changes only the view: the compiled plan of a document is identical collapsed or expanded.
- `pnpm check` and `pnpm e2e` green before every commit.

## Review Focus

1. **Old documents** (`layout` `'free'` / `'route'`, no `collapsed`) open unchanged: FIX frames keep their width and
   rows, nothing is collapsed (Task 1, Task 3 tests).
2. **Narrowing a STACK / FIX frame below its widest child** stops at the widest child + padding, never overlaps
   (Task 1 test).
3. **Pressing STACK again, or re-packing after any drop, is a fixed point** on random sets of 1U / 2U modules and
   child frames: a second pack moves nothing (Task 1 property test).
4. **A cable between two collapsed frames, and a frame's own CLK OUT patched inside it**: the first is drawn between
   the two blocks' jacks, the second is hidden (Task 3 test, Task 4 e2e).
5. **Selection and listening across a collapse**: hidden modules leave the selection; listening to a hidden output
   keeps sounding and its tag stays (Task 4 test).

---

### Task 1: STACK as a dense frame mode; the packing width; resize re-packs (core)

**Files:**
- Modify: `packages/core/src/doc.ts` (`Group.layout: 'free' | 'stack' | 'route'`; `validateDoc` keeps `'stack'`),
  `packages/core/src/frames.ts` (packing, `setLayout`, `resizeFrame`, `repackRoutes` → `repackManaged`, `settle`)
- Test: `packages/core/src/frames.test.ts`

**Interfaces:**
- Produces:
  - `type Layout = 'free' | 'stack' | 'route'` (exported from `doc.ts`).
  - `setLayout(doc: Doc, specs: Specs, gid: string, layout: Layout): Doc` — `'stack'` / `'route'` from `'free'`
    choose the width (`autoWidth`) and pack; between `'stack'` and `'route'` keep the frame's width; the same mode
    again returns `doc` unchanged; `'free'` only sets the mode.
  - `packFrame(doc: Doc, specs: Specs, gid: string): Doc` — packs by the frame's own `layout` at its current width
    (no-op for `'free'`).
  - `resizeFrame(doc, specs, gid, r: Rect): Doc` — unchanged for free frames; for a managed frame only `r.w` counts
    (clamped to the widest child + 2 × padding, and to `FRAME_MIN.w`), `x` / `y` stay, then `packFrame`.
  - `repackManaged(doc, specs, gids)` (renamed from `repackRoutes`, now for `'stack'` and `'route'`); `settle`
    calls it.
- `packFrame(doc, specs, gid, mode)` and the `'stack'` button behaviour of Plan 3 go away (callers: `Canvas.tsx`
  STACK / FIX buttons, factory `build.ts` keeps `layout: 'route'`).

- [ ] **Step 1: Failing tests** in `frames.test.ts`:
  - `stack packs densely in reading order`: the eight modules of the user's patch (`osc`, `osc`, `rhythm`,
    `stages`, `complex`, `lpg`, `att`, `delay` from SPECS, placed in that reading order) in a free frame →
    `setLayout(…, 'stack')`: inner width 1120 (frame `w` 1152), inner height 688 (frame `h` = 28 + 16 + 688 + 16);
    no two children overlap; `stages` at inner (0, 144), `complex` at (560, 272), `att` at (560, 416), `delay` at
    (0, 544); every child on the 8 px grid.
  - `stack again changes nothing; stack ↔ fix keeps width and order`: `setLayout(stacked, …, 'stack')` returns the
    same document; `'route'` then `'stack'` gives the same positions as the first stack; the frame's `w` is
    unchanged by the switches.
  - `a resize of a stack or fix frame re-packs to the new width`: widen the stacked frame to 1700 → `w` 1700, the
    height shrinks, nothing overlaps; narrow it to 100 → `w` = widest child (560) + 32; a `'free'` frame resized keeps
    its children where they were.
  - `a drop into a stack frame re-packs it` (through `settle`): a module moved into the stacked frame at the top-left
    lands first in the reading order.
  - Review Focus 3 — `packing is a fixed point`: 50 seeded random sets (mulberry32) of 3–12 children drawn from
    `osc`, `lpg`, `stages`, `rhythm` and child frames (with 1–3 modules each, themselves stacked), random initial
    positions → after `setLayout('stack')`, `packFrame` changes no position; same for `'route'`.
  - Review Focus 1 — `old documents keep their frames`: a Plan 3 document with a `'route'` frame and a `'free'` frame
    validates with the same `layout`, positions and sizes; `layout: 'stack'` survives `validateDoc`; an unknown
    layout reads `'free'`.
- [ ] **Step 2:** Run `pnpm test packages/core/src/frames.test.ts` → the new tests FAIL.
- [ ] **Step 3: Implement.**
  - Skyline packing for `'stack'` at inner width `W = g.w − 2·GPAD`: children in `readingOrder`; keep the skyline as
    sorted segments `{x, w, y}`; for each child try every segment start `x` with `x + w ≤ W`, its `y` the highest
    skyline under `[x, x + w)`; take the smallest `y`, then the smallest `x`; raise the skyline there. Positions
    snap to 8 (widths and heights are already multiples of 8).
  - If the reading order of the packed result differs from the order used, pack again in the new order (at most 8
    rounds) — this makes a second press a no-op (the fixed-point test).
  - `'route'` keeps Plan 3's rows (gap and padding 32) but breaks rows at the frame's inner width `g.w − 2·RGAP`
    instead of `packWidth`.
  - `autoWidth(order, mode)`: for `'route'` Plan 3's `packWidth`; for `'stack'` the inner width in
    `[widest, Σw]` (step 8) whose skyline pack minimises `area · (1 + 0.15·|aspect − 1.6|)` (aspect = width /
    height), plus padding.
  - Fit after packing as today (height exact, width = the packing width + padding, at least `FRAME_MIN`).
- [ ] **Step 4:** `pnpm test packages/core` → PASS.
- [ ] **Step 5:** Commit `feat: STACK packs densely as a frame mode; the packing width; resize re-packs`.

### Task 2: STACK / FIX buttons and resize handles in the UI

**Files:**
- Modify: `packages/ui/src/canvas/Frame.tsx` (STACK lit while `layout === 'stack'`; tools stay visible while
  STACK is on; a managed frame shows only the `r` and `br` resize handles), `packages/ui/src/canvas/Canvas.tsx`
  (STACK / FIX call `setLayout` with toggling: on → that mode, on again → `'free'`; the resize drag previews
  `resizeFrame` live and commits through `settle`; the magnets gap inside a STACK frame is 0), `Frame.test.tsx`,
  `e2e/app.spec.ts`.

**Interfaces:** Consumes Task 1's `setLayout`, `resizeFrame`, `Layout`.

- [ ] **Step 1: Failing tests:**
  - `Frame.test.tsx`: a `'stack'` frame lights STACK (`.on`) and not FIX; a managed frame renders resize handles
    `r` and `br` only; a free frame all five.
  - e2e `STACK packs a frame densely; dragging its right edge re-packs; STACK again turns it off`: OSC, LPG and
    STAGES framed with G, FIX turned off, STACK → STACK has class `on`, no two `.sr-mod` boxes overlap, the frame is
    narrower than before; drag the right edge 400 px right → the frame's height drops; ⌘Z restores the width; STACK
    again → not `on`, positions unchanged.
- [ ] **Step 2:** → FAIL. **Step 3:** Implement. **Step 4:** `pnpm check && pnpm e2e` → PASS.
- [ ] **Checkpoint for the user (stop):** STACK on `rand melody`; drag its width wider and narrower; switch STACK ↔
  FIX; drop a module into the stacked frame.
- [ ] **Step 5:** Commit `feat: STACK and FIX toggles, live re-pack on resize`.

### Task 3: Collapsed frames (core)

**Files:**
- Modify: `packages/core/src/doc.ts` (`Group.collapsed: boolean`, default false; `validateDoc` reads
  `collapsed === true`), `packages/core/src/frames.ts`, `packages/core/src/index.ts` (exports)
- Test: `packages/core/src/frames.test.ts`, `packages/core/src/compile.test.ts`

**Interfaces:**
- Produces (all in `frames.ts`):
  - `setCollapsed(doc: Doc, gids: readonly string[], on: boolean): Doc`.
  - `toggleCollapsedAll(doc: Doc): Doc` — every frame collapsed when any is expanded, else every frame expanded.
  - `blockOwner(doc: Doc, id: string): string | null` — the outermost collapsed frame strictly containing a module
    or frame (`null`: visible). A collapsed frame is not its own owner.
  - `interface BlockJack { id: string; port: string; label: string; dir: 'in' | 'out'; x: number; y: number }`
    (`x`, `y` relative to the block).
  - `blockOf(doc: Doc, specs: Specs, gid: string): { w: number; h: number; jacks: BlockJack[] }` — `w` =
    `FRAME_MIN.w` (352); rows of 24 px under the 28 px header, 8 px padding top and bottom, `h` = max(96,
    28 + 16 + 24 · max(ins, outs)); inputs at `x` 12, outputs at `x` `w − 12`, row `i` at `y` 28 + 8 + 24·i + 12.
    A jack per inner port (a module's port, or a nested frame's `clkIn` / `clkOut`) with a cable whose other end
    is outside the frame; ports in reading order of their objects, then spec port order; `label` = `NAME › PORT`
    (`nameOf`, the port's label; a nested frame's jacks read `NAME › CLK`). The frame's own `clkIn` stays at the
    header's left end; its own `clkOut` moves to the header's right end (`w`, 14).
  - `jackAt` (existing): a port whose object has a `blockOwner` returns that block's jack position (the block sits
    at the owner's `x`, `y`); a collapsed frame's own `clkOut` returns the header's right end.
  - `cableHidden(doc: Doc, c: Cable): boolean` — both ends have the same `blockOwner`, or one end is a collapsed
    frame's own jack and the other is inside it.
- [ ] **Step 1: Failing tests:**
  - `a collapsed frame lists its crossing ports`: a frame holding OSC → FILTER, FILTER `lp` cabled to an OUT
    outside and an LFO-like OSC outside cabled into FILTER `cut`'s mod jack → `blockOf` has one input
    `FILTER › …` and one output `FILTER › LP`, `h` 96; two cables from FILTER `lp` to two outside modules give one
    jack.
  - `cables end on the block`: `jackAt` of FILTER `lp` equals the block's output jack position; `cableHidden` is
    true for OSC → FILTER and false for FILTER → OUT.
  - Review Focus 4: two collapsed frames cabled to each other → that cable is not hidden and both ends are block
    jacks; a frame's own CLK OUT patched to a module inside it → hidden.
  - nested: a collapsed parent with a collapsed child → `blockOwner` of the child's module is the parent; the parent's
    block lists the child's crossing ports.
  - `toggleCollapsedAll`: some collapsed → all collapsed; all collapsed → none.
  - `compile` gives the identical plan for a document collapsed and expanded.
  - Review Focus 1: a document without `collapsed` validates with every frame expanded; `collapsed: true` survives a
    save (`validateDoc` round trip) and `extractGroup`.
- [ ] **Step 2:** → FAIL. **Step 3:** Implement. **Step 4:** `pnpm test packages/core` → PASS.
- [ ] **Step 5:** Commit `feat: collapsed frames in core — blocks, their jacks, hidden cables`.

### Task 4: Collapsed frames on the canvas; C / ⇧C

**Files:**
- Modify: `packages/ui/src/canvas/Frame.tsx` (the block: header with name, meter, CLK in / out, M, `▸`; a jack row
  per `BlockJack` with its label, each jack wrapped in an element carrying `data-module` = the inner object's id and
  `data-jack` = the port, so dropping a cable on it connects to the inner port; a `▾` / `▸` header button),
  `packages/ui/src/canvas/Canvas.tsx` (skip modules and frames with a `blockOwner`; the box selection and magnets
  ignore them; `show` drops hidden ids from the selection), `packages/ui/src/canvas/cablegeom.ts` (skip
  `cableHidden`; a cable with an end under a block is a curve, never routed), `packages/ui/src/canvas/keys.ts` (C:
  `setCollapsed` on the selected frames, collapsing if any selected frame is expanded; ⇧C: `toggleCollapsedAll`),
  `packages/ui/src/store.ts` (a `collapse` method committing one undo step), `canvas.css`, the hint line in
  `Chrome.tsx` (add `C COLLAPSE`), `Frame.test.tsx`, `cablegeom.test.ts`, `e2e/app.spec.ts`.

**Interfaces:** Consumes Task 3's `blockOf`, `blockOwner`, `cableHidden`, `setCollapsed`, `toggleCollapsedAll`.

- [ ] **Step 1: Failing tests:**
  - `Frame.test.tsx`: a collapsed frame renders `.sr-block` with one `.sr-bjack` per block jack (labels
    `FILTER › LP` …) and no frame body; the `▸` button calls `collapse(false)`.
  - `cablegeom.test.ts`: a hidden cable produces no geometry; a crossing one ends at the block jack and is a curve.
  - Review Focus 5 (store test): collapsing a frame drops its hidden modules from `sel`; `listen` on a hidden output
    stays set.
  - e2e `C collapses a frame to its connections; a cable dragged from a block jack patches the port inside; ⇧C
    expands everything`: starter patch OSC → OUT, OSC framed with G, OUT outside → select the frame, C → no OSC panel
    visible, `.sr-block .sr-bjack` count 1 with text `OSC › OUT`, one cable drawn; drag from that block jack to OUT's
    R → the doc has a cable `[osc, out] → [out, r]`; ⌘Z, ⌘Z → expanded; ⇧C twice → collapsed then expanded; the
    master peak is the same collapsed and expanded.
- [ ] **Step 2:** → FAIL. **Step 3:** Implement. **Step 4:** `pnpm check && pnpm e2e` → PASS.
- [ ] **Checkpoint for the user (stop):** ⇧C on a project with several groups; patch between two collapsed groups;
  C on one group while working in another.
- [ ] **Step 5:** Update `docs/ROADMAP.md` Status; commit `feat: collapsed frames on the canvas, C / ⇧C`.

---

## After the last task

Run a fresh reviewer agent over the whole branch, apply its fixes and defer the rest to `docs/backlog.md` ("From the
Plan 5 review"). Then use the finishing-a-development-branch skill.
