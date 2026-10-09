# Sample display cursor and scrub — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On a loaded SAMPLER / GRAINS display a click sets the cursor (START / POS) and a drag scrubs, heard through
the module's own outputs.

**Architecture:** SAMPLER gets a hidden knob `scrub` (−1 off, else a position 0…1) that is never stored in the
document: the UI sends it as a `fixed` message while dragging (the compiled plan always carries −1); the DSP runs a
dedicated scrub voice that glides to the target position. START / POS changes go through the existing param path.

**Tech Stack:** Rust (engine), TypeScript / SolidJS (ui), Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-07-canvas-ux-design.md` revision 25, §7a "A loaded display is a cursor and
a scrub".

## Global Constraints

- Russian to the user; English code, commits, UI copy; commits end with
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`; `git add` explicit files.
- Audio-thread rules (CLAUDE.md); `alloc.rs` zero; fades 1 ms; the scrub position glides 10 ms.
- One undo step per gesture (click or drag); the scrub value itself is never in the document or the undo history.
- `pnpm check && pnpm e2e` green before the commit.

## Review Focus

1. **A drag released outside the display or the window** ends the scrub (the voice fades out, `scrub` back to −1)
   and commits START once.
2. **Scrubbing a sample replaced or unloaded mid-drag** is silence, no panic (positions clamp to the frames).
3. **An old document** (no `scrub` param) compiles with `scrub` −1; `scrub` never appears in saved JSON.

---

### Task 1: Cursor and scrub on SAMPLER and GRAINS displays

**Files:** `engine/src/modules/sampler.rs` (hidden knob `scrub` −1…1 last in spec order, after `sample`; a scrub voice:
when `scrub ≥ 0` it fades in at that position and each sample moves toward `scrub · frames` with a 10 ms one-pole glide,
reading with linear interpolation, stereo, × LVL, added to L / R; when `scrub` returns to −1 it fades out over 1 ms),
`pnpm specs` + fixtures, `packages/core/src/compile.ts` (a hidden knob named `scrub` always compiles to −1 and
`validateDoc` drops a stored `scrub` param), `packages/ui/src/canvas/displays/{Wave.tsx,Grains.tsx}` (pointer down /
move / up with capture; a press that moves less than 3 px is a click), `packages/ui/src/canvas/{Panel.tsx,Canvas.tsx}`
(SAMPLER ONE / LOOP: click → START param; drag → `fixed` messages for `scrub` each move plus a START preview, commit
START on release; SLICE: click → the slice under the pointer plays once (send a one-shot trigger via a `scrub` burst or
a dedicated `fixed` slot — implementer's choice, documented), drag → scrub; GRAINS: click / drag → POS (preview while
dragging, one commit on release; LIVE positions relative to the head as the display draws them); an empty display
still opens the dialog), tests, e2e.

- [ ] **Step 1: Failing tests:** Rust — scrub at 0.5 on a ramp sample sounds the ramp's value near 0.5 within 20 ms;
  scrub moving 0.2 → 0.8 over 100 ms produces a rising ramp with no step > 0.05; scrub −1 → silence within 2 ms; a
  scrub voice beside a triggered voice sums; Review Focus 2 — the sample replaced by a shorter one mid-scrub → finite,
  no panic; `alloc.rs` with scrub messages zero. core — Review Focus 3: compile gives −1 for `scrub`; `validateDoc`
  drops `scrub`. ui — Wave: a click at 25 % of the width calls the START change with 0.25; a drag sends scrub values and
  one START commit on release; Review Focus 1 — pointercancel / lostpointercapture ends the scrub. e2e — load a sample
  (the LOAD stub), click at the waveform's middle → `start` ≈ 0.5 in the document; ⌘Z → back; drag across the display
  with audio on → master peak > 0.05 during the drag, and START ends at the release point.
- [ ] **Step 2:** → FAIL. **Step 3:** Implement. **Step 4:** `pnpm check && pnpm e2e`.
- [ ] **Step 5:** Update `docs/ROADMAP.md` Status; commit `feat: sample displays — a click is the cursor, a drag scrubs`.
