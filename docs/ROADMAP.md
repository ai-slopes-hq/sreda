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
| The design (approved, revision 34) | `docs/superpowers/specs/2026-10-07-canvas-ux-design.md` |
| The A4 module's design (revision 4) | `docs/superpowers/specs/2026-10-13-a4-module-design.md` |
| Plans 1–15 (all done) | `docs/superpowers/plans/` — `YYYY-MM-DD-<n>-<name>.md`, one per plan |
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
- **Plan 12 done and merged into `main`** (2026-10-10), spec revision 29: DICE at the top right
  beside NEW (spec revision 30) throws a random playable patch — rhythmic (drums, bass, lead, synced FX) or ambient (drone, pad or bells, long delay,
  big reverb, sometimes GRAINS on LIVE) — tested to sound on every seed.
- **Plan 13 done and merged into `main`** (2026-10-10), spec revision 31: 13 factory groups (kick, snare, hats, clap,
  noisy techno drums, fm bass, reese, pluck, chaotic bells, pad, drone, grain cloud, frozen space) and 4 projects
  (techno, ambient bells, dub, generative), built from shared voices in `factory/voices.ts`, each tested to sound.
  Also fixed: a hot reload in `pnpm dev` left the previous audio host playing under the new one.
- **Spec revision 32** (2026-10-10, after a UI / UX review): a module is exactly n × 1U high (144 / 288 / 432 px;
  2U and 3U were 272 / 400), so STACK rows line up; 3U has 12 lanes and STAGES' contour 9; documents re-pack their
  STACK frames on open. The rest of the review is in `docs/backlog.md` ("From the UI / UX review").
  The prototype's live boards (Main, Panels, SoundPack) follow it; the picker stays inside the window. Next by the
  user's choice: reworking the big modules RHYTHM and STAGES.
- **Plan 14 done and merged into `main`** (2026-10-11), META-SEQ, spec §7b revisions 33–34; ledger in
  `.superpowers/sdd/2026-10-10-14-metaseq/progress.md`. META-SEQ replaces RHYTHM and STAGES: the engine module, the
  overview panel, the editor drawer (double-click; lanes NOTE / GATE / TIE / ACC / VEL / CHNC with LEN / RATE / lock),
  patterns A–H (COPY / PASTE, PAT), GEN / DICE / per-lane ⚄, MUTATE (drift written back once per GATE cycle without an
  undo step), old RHYTHM / STAGES documents migrate on open with a notice, factory projects / groups and the DICE
  patches are built on META-SEQ. The whole-branch review is done and its fixes
  are in (the drawer and MUTATE survive a document replace; a pattern tab is no undo step). Deferred items are in
  `docs/backlog.md` ("From Plan 14"). The live prototype artifact is not yet republished (auto mode refused it; it
  awaits the user).
- **Plan 15 done and merged into `main`** (2026-10-13): the Elektron Analog Four over USB MIDI, as two modules
  (spec revision 4): **A4** (one track: PITCH / GATE / VEL, NOTE, OFS, TRK T1–T4) and **A4 CLK** (CLK / RUN / RST →
  MIDI clock 24 PPQ, Start, Stop). Held trigger inputs (`Port.held`), the engine's event outbox and `events()` export,
  a SharedArrayBuffer event ring from the worklet, `MidiDevices` / `MidiPump` / `NoteLedger` / the MIDI session (Web
  MIDI, sends timestamped to the speaker time, hot-plug, no stuck notes on delete / mute / close), the `device`
  display and WIRES rows. Listening Checkpoints 1–3 passed on the A4 (a stuck-note bug found at Checkpoint 1 is
  fixed). Final review (`/code-review`) fixes are in; deferred items are in `docs/backlog.md` ("From Plan 15").
- **Engine performance, merged into `main`** (2026-10-16): META-SEQ inside a feedback loop syncs once per block
  and writes its trace at the block end; QUANT keeps its last snap while input, ROOT and SCALE hold. The 200-module
  patch is back to 23.2 % natively (it was 26 % after Plan 14 put QUANT into it) and ~4.4 s for 10 s in WASM.
- **Later (backlog):** META-OSC (OSC + COMPLEX + LFO range); a patch language with a live REPL.
- **Next milestone (chosen 2026-10-16): the redesign and the UI / UX review leftovers.** A designer's handoff
  (boards `docs/prototype/Redesign*.dc.html`) is written into the spec as revision 35, §1b (the visual style: two
  faces, sentence-case chrome, shadows on floating things, new radii, `popover` / `label` / `shadow` tokens, 14 px
  jacks, a 32 px frame header, restyled chrome, sidebar, frames and META-SEQ drawer). Two plans: **Plan 16** the new
  style plus the small decided behaviours (frame tools on hover, the sidebar narrows the canvas, no SAVE AS / NEW in
  LIBRARY, no empty side column); **Plan 17** the new functions (STACK stretch to the right with a wider display, 2U
  displays for MIX / SPREAD / SWITCH / ATT, context hints and `?`, menu item descriptions, the save dialog, a LIMIT
  lamp, truncated text). **Plan 16 done and merged into `main`**
  (2026-10-16; `docs/superpowers/plans/2026-10-16-16-restyle.md`): spec §1b as built — Plex Mono + Sans shipped,
  `popover` / `label` / `shadow` tokens and four skin fixes (TOUCH `muted` `#a3a3a3` added after the contrast check),
  radius / shadow / ring scales, 14 px jacks, knobs with a body, NOISE / OUT 2 HP and A4 / A4 CLK 3 HP, the menu and
  picker (port pill, from line), LISTEN pill, top bars with the project name, zoom, hints with key caps,
  sentence-case chrome and notices, the floating sidebar that narrows the canvas with the four tabs restyled (MIX:
  horizontal fader, dB meter), frames with a 32 px header and tools on hover, the collapsed card, the META-SEQ
  drawer. `pnpm screens` captures 14 screens in six skins to `screens/`. Executed subagent-driven; every task and
  the whole branch reviewed, the final review's fixes are in; deferred items in `docs/backlog.md` ("From Plan 16").
  Checkpoints 2–4 were the controller's screen checks (the user was away); the user looks at `screens/` or
  `pnpm dev`. **Next:** Plan 17.
- **Plan 18 done and merged into `main`** (2026-10-17; `docs/superpowers/plans/2026-10-16-18-dice-styles.md`),
  spec revision 36: DICE throws a patch in one of eleven styles built from a library of parts (drums, bass, line,
  texture) through an assembler (role frames, MIX, the style's effects, OUT, a clock frame), plus up to three of eight
  twists per throw (FM, S&H, SPREAD switch, DELAY feedback, GRAINS, polymeter, DRIVE / FOLD, CHANCE). Tests: 500 seeds
  valid with no PROBLEMS and every style, part and twist coming up; ten throws of a style are not near-copies; renders
  of every style and of every twist stay in −40…−3 dBFS. The Builder gained `set`, `typeOf` and `retarget` for the
  twists. Deferred items in `docs/backlog.md` ("From Plan 18"). The final review's fixes are in: `feedback` cannot run away
  (60 s at the corners of its ranges stays within 3 dB), one key (every sequenced oscillator on a C, unsequenced ones on
  a degree of the scale), one kick per kit and four-on-the-floor techno, pools pruned of twists that never apply,
  Fisher–Yates in place of a random sort, wider acid / drone / bells / Berlin school pools. Also on the branch: `e2e` and `pnpm screens`
  runs are muted (`SREDA_E2E` → Chromium `mute-audio`).
- **Next phase (chosen by the user, 2026-10-17): every module under the microscope.** No new modules or features
  for now (Plan 17 waits): take each module or group of modules in turn, measure it against a reference and make it
  work seriously. Per module: a reference (an open-source implementation or well-documented hardware — e.g. FILTER
  against Andy Simper's / Cytomic's trapezoidal SVF as in Surge and Vital, DRIVE / FOLD against Surge and Mutable
  Instruments, LPG against vactrol LPG models, REVERB against Dattorro's plate, OSC against a band-limited reference);
  a native measuring bench (sines across the range, saws, noise, impulses over a grid of knobs: response, THD, level,
  self-oscillation, stability) run on ours and on the reference; short A / B renders for the user to listen to; then
  fix the implementation, update the spec where behaviour changes, and pin the numbers in tests. **First: FILTER**
  (`docs/backlog.md`, "From listening": it misbehaves on a sine, DRV and RES).
- **ORCA skin** (2026-10-19, branch `skin-orca`, spec revision 38, §1a): a seventh skin after Hundred Rabbits' Orca —
  pure black, white text, greys only (`destructive` stays red), roles told apart by brightness (audio white, trigger
  `#d0d0d0`, pitch `#a6a6a6`, mod `#7a7a7a`), picks as inverted white blocks. `skins.test.ts` pins it grey with the
  roles stepping down; `pnpm screens` now captures seven skins.
- **Plan 20 — CLOCK** (2026-10-19, branch `clock-module`, `docs/superpowers/plans/2026-10-19-20-clock.md`, spec
  revision 39, §7c), out of the microscope phase by the owner's request: a tempo module without a frame (type `clk`,
  3 × 1): CLK in (passes through while patched, so it also divides / multiplies), BPM 20–300 with its mod jack (a
  modulated tempo bends without a lost beat), TAP (one undo step a run), CLK out. The frame clock's beat is shared
  (`Beat` in `clock.rs`); frames, factory patches and DICE are unchanged. Checkpoint pending: the owner listens in
  `pnpm dev`.

## The road (vertical slices: something to hear at every stage)

| Stage | Plan | Ends with | State |
|---|---|---|---|
| **A. Sound** — scaffold; Rust engine → WASM → AudioWorklet → speakers | Plan 1, Tasks 1–2 | a 220 Hz test tone after a click — **checkpoint: listen** | done, merged |
| **B. Playable canvas** — specs from Rust, OSC + OUT, document → compile → engine, generic panels, patching | Plan 1, Tasks 3–7 | OSC → OUT on the canvas, knobs turn the sound — **checkpoint after Task 6**; two OSCs patched FM / PTCH — **checkpoint after Task 7** | done, merged |
| **C. Modules one by one** — each task: Rust DSP + tests, appears in the picker by itself, then listen | Plan 2 (`2026-10-07-2-modules.md`) | the 24 first-build modules | done, merged |
| **D. Organisation** — frames (G, FIX / STACK, own clock, MUTE), sidebar + WIRES, library folder, group / project pickers, factory patches, remaining gestures, real-time benchmark | Plan 3 (`2026-10-08-3-organisation.md`) | the first build complete | done, merged |
| **E. Sound pack** (milestone 2) — FILTER models, DRIVE, DELAY types, REVERB, SAMPLER, GRAINS, samples | Plan 4 (`2026-10-08-4-sound-pack.md`) | spec §7a | done, merged |
| **F. Workflow** — STACK packing and collapse, skins and the mixer, the LIBRARY tab, sample scrub | Plans 5–8 | spec revisions 20–25 | done, merged |
| **G. Sound from listening** — DRIVE, FOLD and FILTER models matched to references | Plans 9–11 | spec revisions 26–28 (DRIVE's tuning against renders waits for them) | done, merged |
| **H. Something to play at once** — the DICE patch, factory groups and projects | Plans 12–13 | spec revisions 29–31 | done, merged |
| **I. META-SEQ** — one sequencer in place of RHYTHM and STAGES | Plan 14 | spec §7b, revisions 33–34 | done, merged |
| **J. Hardware** — the Analog Four over USB MIDI (A4, A4 CLK) | Plan 15 | A4 spec revision 4 | done, merged |
| **Next** — recording and export are the first candidates | — | `docs/backlog.md` | to choose |

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
- Panel grammar with "air + quiet": HP 56, lanes 32, header 32 (1U 144 / 2U 288 / 3U 432); values appear on hover,
  edit, modulation or when not default; port labels on one line, ≤ 5 characters.
- Keys: `/` (or double-click) opens the picker, ⌘O on PROJECTS; **G** frames / unframes (⌘G, ⇧⌘G too); no M / G / P
  picker keys.
- Frames: STACK is the one managed layout (dense packing, reading order; WIRE FIX is gone); frames fit their content
  with equal margins; repeated presses change nothing.
- LPG has the VCA folded in; SCOPE has thru outputs (`THR A`, `THR B`); META-SEQ replaced RHYTHM and STAGES (old
  documents migrate on open).
- Sound pack: one SAMPLER (ONE / LOOP / SLICE; slices equal or by hits; breaks follow the clock by re-triggering
  slices) + a separate GRAINS (FILE / LIVE + FREEZE); REVERB has an Elektron-style room display.
