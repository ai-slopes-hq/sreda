# SREDA 2 — roadmap and where we are

**Start here in a new session.** Read this file, then the plan it points to; continue at the first unchecked step.
Update the **Status** section at the end of every task (and commit it with the task).

SREDA 2 is a canvas for sketching rhythmic / techno and ambient / drone patches — "nothing, just play" — with a
Serge / Buchla / Eurorack feel: small atomic modules (Bitwig Grid-like), a professional look (no toys, no eye
candy), clock-unbound (anything periodic can clock anything). It replaces `../sreda`, which grew into a DAW instead
of a creative tool; nothing of its UI is ported.

## Documents

| What | Where |
|---|---|
| The design (approved, revision 18) | `docs/superpowers/specs/2026-10-07-canvas-ux-design.md` |
| Plans 1–3 (done) | `docs/superpowers/plans/2026-10-07-1-foundation.md`, `…-2-modules.md`, `2026-10-08-3-organisation.md` |
| Ideas for later | `docs/backlog.md` |
| The clickable prototype and its headless checks | `docs/prototype/` (see its README; live artifact linked there) |
| Repo rules for Claude | `CLAUDE.md` |

## Status

- **2026-10-07** — design done: spec revision 14, prototype boards (Main canvas, Panel system, Sound pack, Panel
  density), Plan 1 rewritten sound-first. **No code yet.**
- **Plan 1 done and merged into `main`** (2026-10-07): an Electron app where OSC → OUT is patched and played on
  the canvas — the Rust engine in WASM in an AudioWorklet, document / compile / undo / autosave in TS, generic
  panels, patching gestures. Reviewed by a fresh reviewer; its fixes are in; deferred items are in `docs/backlog.md`
  ("From the Plan 1 review"). Rulings made during Plan 1 are in the git history of the commits (the ledger was
  scratch and is gone).
- **Plan 2 done and merged into `main`** (2026-10-07): all 24 first-build modules with their displays (scope, contour,
  pads), DICE and the generators, glyphs, normal ghosts, fixed-value messages. Reviewed by a fresh reviewer; its
  fixes are in; deferred items are in `docs/backlog.md` ("From the Plan 2 review"). Every module type in one plan
  allocates nothing; a minute of audio takes 2.6 % of real time natively.
- **Plan 3 done and merged into `main`** (2026-10-08): frames (G, clocks, MUTE, STACK / WIRE FIX), factory projects
  and groups with picker tabs, the library folder (SAVE / NEW / ⌘S / ⌘O), wire hover / focus / insert, magnets /
  replace / ⌘D / R, the sidebar with WIRES, and a 200-module patch in real time (16.6 % natively, ~36 % in WASM).
  Reviewed by a fresh reviewer; its fixes are in; deferred items are in `docs/backlog.md` ("From the Plan 3 review").
  Spec revision 16: the top-right button is SIDEBAR. **The first build is complete.**
- **Plan 4 done and merged into `main`** (2026-10-09), milestone 2, the sound pack (spec §7a): real 2× oversampling
  (`Os2x`) and ADAA; DRIVE; FILTER models SVF / LADDER / DIODE / SK / COMB / VOWEL with DRV and PTCH; DELAY types DIGI /
  TAPE / SPRING with CHAR, PING, CLK sync, L / R; REVERB ROOM / PLATE / HALL with FREEZE and the room display; samples
  as a system (library `samples/`, decoding and resampling, AIFF, onsets, the engine's pool, MISSING, audition);
  SAMPLER (ONE / LOOP / SLICE, AUTO); the SAMPLES picker, S, LOAD, drop to load; GRAINS (FILE / LIVE, FREEZE). Rulings
  are in `.superpowers/sdd/2026-10-08-4-sound-pack/progress.md`; the 200-module patch runs at 21.5 % natively.
  Reviewed by a fresh reviewer; its fixes are in; deferred items are in `docs/backlog.md` ("From the Plan 4 review").
  **Milestone 2 is complete.**
  Spec revision 18 (skins, §1a, written down only) and revision 19 (how the sound pack was built, §7a) are in.
- **Plan 5 done and merged into `main`** (2026-10-09), spec revisions 20–21: STACK packs densely (skyline, reading
  order) and is the one managed layout (WIRE FIX removed; old FIX frames open stacked); dragging a STACK frame's width
  re-packs it live; cables are drawn behind (stubs; whole on hover, on the hovered or selected module / frame, in
  WIRES); frames collapse to a block with a jack per crossing port (C / ⇧C, `▾` / `▸`). Executed with subagents
  (token-lean); reviewed per task and as a whole branch; deferred items in `docs/backlog.md` ("From the Plan 5
  review").
- **Plan 6 done and merged into `main`** (2026-10-09), spec revision 22: the Plan 4–5 review minors; every UI colour
  is a skin token (six skins, §1a); sidebar tabs WIRES / MIX / SETTINGS; SETTINGS chooses the skin (hover tries it,
  kept in `settings.json`); the mixer — OUT mute / solo, the master fader (listening and audition skip it), the MIX
  tab with a strip per OUT. Subagent-driven, token-lean; final review fixes in; deferred items in `docs/backlog.md`
  ("From the Plan 6 review").
- **Plan 7 done and merged into `main`** (2026-10-09), spec revisions 23–24: sample analysis in a Web Worker (no UI
  freeze on long files); samples unnamed for 30 s are unloaded (registry and engine pool); ⌘O opens any project file
  and ⌘S saves it back, also after a relaunch; File › Import Samples… (⇧⌘I); the LIBRARY tab (PROJECTS, GROUPS,
  SAMPLES); LOAD / a click on a sample display open the system file dialog; the picker has ALL · MODULES · GROUPS (no
  PROJECTS, no SAMPLES, S free). Subagent-driven, token-lean; final review fixes in; deferred items in
  `docs/backlog.md` ("From the Plan 7 review").
- **Plan 8 done on the branch `plan-8-scrub`** (2026-10-09), spec revision 25: a loaded SAMPLER / GRAINS display is a
  cursor and a scrub — a click moves START (SAMPLER ONE / LOOP) or POS (GRAINS), a drag scrubs the file through the
  module's outputs (hidden `scrub` voice, 10 ms glide) with START / POS following; in SLICE a click plays the slice
  (hidden `play` one-shot). Awaiting review and the user's listening check.
- **Plan 8 done and merged into `main`** (2026-10-09), spec revision 25: on a loaded SAMPLER / GRAINS display a click
  is the cursor (START / POS) and a drag scrubs (heard through the module's outputs; a pointer at rest fades out;
  SLICE: a click plays that slice); LOAD loads another file. Reviewed; fixes in.
- **Plan 9, Task 1 done and merged into `main`** (2026-10-10), spec revision 26: DRIVE has seven models (SOFT, TUBE,
  OD, DIST, FUZZ, RECT, DIGI), a BIAS knob and loudness matched across models and gains; old MODE values migrate.
  Task 2 (tuning against Ableton reference renders in `projects/refs/drive/`) waits for the renders.
- **Plan 10 done and merged into `main`** (2026-10-10), spec revision 27: FOLD has four models (SINE, TRI, WRAP, CHEB),
  FOLD ×1…×40, LEVEL and loudness matched by a measured table; old FOLD values keep their drive. The 200-module patch
  now runs at 23.2 % natively (FOLD is heavier).
- **Plan 11 done and merged into `main`** (2026-10-10), spec revision 28: FILTER after Ableton's Auto Filter renders
  (`projects/refs/filter/`) — RES means the same on every model (+7 dB at 0.5, ≈ +20 dB at 0.9), the passband holds at
  any RES, each model's saturation matches its reference within ±6 dB; the MODEL glyph follows the live cutoff and RES.
  The sound block from listening (DRIVE, FOLD, FILTER) is done; DRIVE's tuning against renders waits for them.
- **Next:** choose the next milestone (candidates in `docs/backlog.md`: DICE for the whole project, sends to shared
  effects, recording and export).

## The road (vertical slices: something to hear at every stage)

| Stage | Plan | Ends with | State |
|---|---|---|---|
| **A. Sound** — scaffold; Rust engine → WASM → AudioWorklet → speakers | Plan 1, Tasks 1–2 | a 220 Hz test tone after a click — **checkpoint: listen** | done, merged |
| **B. Playable canvas** — specs from Rust, OSC + OUT, document → compile → engine, generic panels, patching | Plan 1, Tasks 3–7 | OSC → OUT on the canvas, knobs turn the sound — **checkpoint after Task 6**; two OSCs patched FM / PTCH — **checkpoint after Task 7** | done, merged |
| **C. Modules one by one** — each task: Rust DSP + tests, appears in the picker by itself, then listen | Plan 2 (`2026-10-07-2-modules.md`) | the 24 first-build modules | done, merged |
| **D. Organisation** — frames (G, FIX / STACK, own clock, MUTE), sidebar + WIRES, library folder, group / project pickers, factory patches, remaining gestures, real-time benchmark | Plan 3 (`2026-10-08-3-organisation.md`) | the first build complete | done, merged |
| **E. Sound pack** (milestone 2) — FILTER models, DRIVE, DELAY types, REVERB, SAMPLER, GRAINS, samples | Plan 4 (`2026-10-08-4-sound-pack.md`) | spec §7a | done, merged |

**Plan 2 order** (chosen so real patches come together early): SCOPE (see signals) → LPG, SLOPE, NOISE (*Pulse*) →
FILTER, MIX → RHYTHM, STAGES, QUANT with generators and DICE (*Acid*) → FOLD, COMPLEX, DELAY (*Drone*) →
UNCERTAINTY, S&H, CHANCE, SHIFT, COMPARE, FOLLOW, SWITCH, SPREAD, ATT, A×B+C. Each module's behaviour table lives in
git history of Plan 1 (`git show 2dd91ab:docs/superpowers/plans/2026-10-07-1-foundation.md`, "Tasks 10–14") — reuse
it when writing Plan 2.

## Working agreements

- **Language.** The user writes Russian; answer in Russian. Docs, code, commits and UI copy are English.
- **Execution:** native (Claude implements in the session), TDD per the plan, commit per task. Stop at each
  checkpoint so the user can run `pnpm dev` and listen before going on. Don't spawn subagents unless asked.
- **Results early.** The user does not want to build for ages before hearing anything: keep every plan sliced so
  each task ends in something audible or visible.
- **Commits** end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Spec first.** A design change goes into the spec (bump its revision line), then the plan, then code; the
  prototype is updated when the change is visual or interactive.
- **The prototype.** Edit the boards in `docs/prototype/`, run its checks (`node docs/prototype/check/main.js
  docs/prototype/Main.dc.html`, `frames.js`, `holes.js <board>`), then republish the artifact (README says how).
  Say plainly that the checks run in Node and the page itself was not seen in a browser.

## Decisions worth knowing (details in the spec)

- Electron (macOS, one user), Rust → WASM engine and DSP in an AudioWorklet (raw C-ABI exports, no wasm-bindgen),
  TypeScript core, SolidJS UI; device sample rate; "balanced" quality (polyBLEP, ADAA + 2× on nonlinear stages).
- Panel grammar with "air + quiet": HP 56, lanes 32, header 32 (1U 144 / 2U 272 / 3U 400); values appear on hover,
  edit, modulation or when not default; port labels on one line, ≤ 5 characters.
- Keys: `/` (or double-click) opens the picker, ⌘O on PROJECTS; **G** frames / unframes (⌘G, ⇧⌘G too); no M / G / P
  picker keys.
- Frames: STACK uses WIRE FIX's rows without channels and turns FIX off; frames fit their content with equal
  margins; repeated presses change nothing.
- LPG has the VCA folded in; SCOPE has thru outputs (`THR A`, `THR B`); STAGES is a 16-stage contour, RHYTHM 16
  pads with OFF / ON / TIE.
- Sound pack: one SAMPLER (ONE / LOOP / SLICE; slices equal or by hits; breaks follow the clock by re-triggering
  slices) + a separate GRAINS (FILE / LIVE + FREEZE); REVERB has an Elektron-style room display.
