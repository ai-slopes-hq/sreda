# Backlog

Ideas kept for later. Not in the first build (`docs/superpowers/specs/2026-10-07-canvas-ux-design.md`).

## Next after the first build

- **From the UI / UX review** (2026-10-10; heights n × 1U already done in spec revision 32):
  - STACK leaves holes by width (3 / 4 / 5 / 6 / 10 HP side by side): choose the frame width from sums of widths, or
    let a row's last module take the leftover.
  - Panels half empty because 2U is chosen for the jack count (MIX, ATT, A×B+C, SPREAD, SWITCH); NOISE keeps an empty
    IN column.
  - ~~The picker opened near the bottom of the window runs off screen~~ — done: it measures itself and stays inside.
  - A frame header holds up to 8 controls (colour, STACK, SAVE, M, BPM, TAP, ✕, ▾), repeated on every nested frame.
  - SAVE / NEW in three places (top bar, LIBRARY's SAVE AS / NEW, SAVE on every frame).
  - Without the sidebar the patch shows only stubs; the sidebar covers the canvas instead of narrowing it; two tabs
    look active at once (WIRES filled, SETTINGS outlined).
  - The hint bar is truncated; WIRES truncates normals; an empty BETWEEN GROUPS shows `+ new wire`; LPG's `PING ×2`
    runs into the next lane.

- **META-OSC** (2026-10-10, after META-SEQ): fold OSC and COMPLEX into one oscillator (COMPLEX's modulator becomes
  optional) with a low range so it also serves as an LFO (shapes, rate in Hz or synced to the frame clock). Decide
  what stays with SLOPE (cycling envelope) so the two don't overlap. Same path as META-SEQ: brainstorm, spec, plan,
  migration of saved patches.

- **Patch language + live REPL** (2026-10-10): presets stored descriptively, as text in a small patch markup
  language (modules by name with real-unit values, cables as `osc.out -> lpg.in`, frames with their clock; no
  coordinates, layout derived), and a console inside the app that evaluates it live, interpreter style: a line adds,
  re-patches or turns a knob on the running patch through the usual edit / undo path. Round trip: the current patch
  prints back as the same text. Seed: the factory builder (`packages/core/src/factory/build.ts`) already builds
  patches by type with real units. Open: textual diff vs re-evaluating the whole file, names for module instances,
  how META-SEQ steps read as text (e.g. `notes: c3 . eb3 g3`).

- **Group macros** (2026-10-07): a group's header exposes chosen knobs of its members as macro knobs. Must not bring
  back the hidden-insides / inside-vs-outside split (edit vs play) that made Reaktor-style containers kill
  creativity. Groups themselves (frame + shared clock) are in the first build.
- **Look anywhere** (2026-10-07): hover a jack or cable → a small scope of that signal. Pairs with click-to-listen.
- **Keyboard touch plates** (2026-10-07): a PLATES module turns computer keys into Buchla-style touch plates: gate +
  per-key voltage + "pressure" from hold time.
- **MUTATE** (2026-10-07): ⇧R over a module or frame nudges its knobs ±10 % from where they are (R scrambles, ⇧R
  varies).
- **Knob lock** (2026-10-07): Alt-click pins a knob so R / MUTATE leave it alone.
- **⌘D on a frame** (2026-10-07): duplicate a whole frame with its inner cables and clock (a second voice in one move).
- **Frame snapshots A/B + MORPH** (2026-10-07): store two states of a frame's knobs and morph between them from the
  header (Buchla-style preset morph).
- **Notes** (2026-10-07): Miro-like text stickies on the canvas.
- **MULT** (2026-10-07): a passive multiple as a patch point, if a hub is wanted for organising cables (outputs already
  fan out). Alt-drag tapping from a cable's middle was considered and dropped.

- **Pin matrix module** (2026-10-07): an EMS Synthi-style routing module on the canvas (4×4 pins, modulatable and
  switchable by trigger) — a creative module, separate from the wire editor.

- **Choosing a skin** (2026-10-08): spec §1a defines skins and records six skins (DEFAULT, ANNABIOSIS, KANAGAWA, TOUCH, NORD, TOKYO NIGHT). Later: move every
  colour literal in the UI into the §1a tokens (today `canvas.css` has only the role tokens; `Frame.tsx` keeps
  `TINT_FILL`), then a way to pick the skin (app-wide, not per document).

- ~~**FOLD sounds weak**~~ Done in Plan 10 (SINE / TRI / WRAP / CHEB, ×40, matched loudness).
- ~~**FILTER models are not convincing**~~ Done in Plan 11.
- **FOLD's knob reads `4.00`**: show it as `×4.0`.
- ~~**More factory presets**~~ Done in Plan 13.
- ~~**DICE for the whole project**~~ Done in Plan 12.
- ~~**DRIVE sounds poor and its modes are alike**~~ Done in Plan 9 (seven models, BIAS, matched loudness); tuning
  against Ableton renders waits for `projects/refs/drive/`.
- ~~**FILTER cutoff animation**~~ Done in Plan 11.
- ~~**A system mixer for every OUT**~~ Done in Plan 6 (the MIX tab). Sends to shared effects: dropped for now (2026-10-10).
- **Panels in rows / rails** (2026-10-07): a canvas-wide HP × U lattice with rails between rows, like a case.
  Considered and rejected for now (it drifts towards a VCV clone); module sizes are quantised to HP × U instead and
  placement stays free.
- **Category tint on panels** (2026-10-07): a barely-there tint per family (sources, shapers, logic, FX), like
  Buchla's coloured panel sections.
- **Group collapse**: collapse a group to its header. (Saving and loading groups moved into the first build.)

## From the Plan 1 review (deferred, 2026-10-07)

- ~~**Cables at 200 modules**~~ — done in Plan 3 (memoised layouts and cable geometry; a move recomputes only its
  wires).
- ~~**Plans on the audio thread**~~ — done in Plan 3 (encoded on the main thread, bytes transferred; no plan for a
  move that changes nothing structural).
- **Meters:** level bars have no hold / 300 ms decay and sample one block in six; trigger flashes last 80 ms, not 120.
- **Master after a runaway:** the DC blocker state can hold ~1e34 and pin the output near full scale for seconds once
  the runaway stops (possible with Plan 2's MIX / ATT / A×B+C); clamp the master input to about ±16.
- **Engine details:** a new slot's buffers are seeded from slot 0's; every plan clears listen (one block of the mix can
  slip through while listening); through-zero FM uses the wrong polyBLEP sign; `alloc.rs` should also cover fades,
  crossfades and trigger inputs.
- **Autosave:** an edit in the last 500 ms before quitting is lost; each save opens a new IndexedDB connection.
- **Small UI:** Shift mid-knob-drag jumps (re-base the drag); clicking one module of a multi-selection keeps the
  selection. (~~The cable gradient~~ is 40 / 20 / 40 since Plan 3.)
- **Hardening:** the app:// path check uses `startsWith(root)` without a separator; no `will-navigate` /
  `setWindowOpenHandler` guard; no production CSP; `package.json` uses `^` ranges, not exact pins; the WASM path is not
  tested at 44.1 kHz any more (add `renderDoc(…, 44100)`).

## From the Plan 2 review (deferred, 2026-10-07)

- ~~**The folder's "2× oversampling" is a no-op:** averaging ADAA over linear-interpolated midpoints equals 1× ADAA. Either
  real 2× (a half-band decimator) or drop it and fix the spec / plan text.~~ Done in Plan 4: `Os2x`, a polyphase
  half-band, under FOLD, DRIVE and FILTER's nonlinear models.
- **FOLLOW's GATE latches on for THR < 0.02** (the envelope never goes below THR − 0.02); scale the hysteresis with THR.
- **QUANT `snap` overflows** for absurd inputs (1e30 from a runaway): clamp `rel` (debug panics; release wraps).
- **SCOPE TIME below ~5 ms** does nothing (256-sample minimum sweep); spec says 1 ms.
- **LPG LP mode at g = 0** still passes the 20 Hz pole (a 50 Hz sine leaks at −8.6 dB between pings).
- **SHIFT's queue** assumes ascending due times; AMT modulated down can queue an earlier event behind a later one.
- **SHP's curve glyph** shows the base value, not the modulated one (§4 says modulation included).
- **A×B+C's c2** shows the dashed normal ring and title while out1 is patched (the normal is not live then).
- **DICE input latency:** a rAF + message round-trip; with DICE ← EOC the first step of the new cycle still plays the
  old pattern; it pauses while the window is hidden.
- Dead `ids` in att.rs. (The RHYTHM / STAGES items that stood here went with the modules in Plan 14.)

## From the Plan 3 review (deferred, 2026-10-08)

- **Parent-cycle repair loses nesting:** `validateDoc` recomputes parents with "descendants" taken from the broken
  links, so g1 ↔ g2 (g2 inside g1) repairs to g2 without a parent; null every group's parent before recomputing.
- **Frame meters:** an OUT's `master_peak` is already gated and then multiplied by the gain again (wrong during a
  glide); an outer frame's meter reads ungated buffers, so it shows a muted inner frame's audio.
- **Library paths:** `fileFor` compares `startsWith(root + sep)` lexically — a root with a trailing slash (possible via
  `SREDA_LIBRARY`) refuses everything; symlinks inside the folder are not resolved. Use `path.resolve` / `path.relative`
  (and `realpath`).
- **Two quick saves of one file** share the temporary name `${file}.${pid}.tmp`; add a counter or random suffix.
- **Silent failures:** a group file with no frame places nothing without a notice; a WIRES rewire refused by
  `RuleError` shows nothing.
- **`applyJson` uses `TextEncoder`**, which the AudioWorklet scope lacks; the worklet only calls `applyBytes` today.
- **`openProject`** resets `sidebar.picked` but not `ports` / `hover` (they are cleared when the cables change, which
  covers most cases).

## From the Plan 4 review (deferred, 2026-10-09)

- **Onsets run on the renderer's main thread:** a 10-minute stereo file is ~230 M multiply-adds, about a second of
  frozen UI on load. Move `onsets` (and the AIFF render) to a worker, or run it in chunks.
- ~~**Loaded samples stay for the session:** the registry keeps raw bytes and decoded floats, the engine keeps its copy;
  WASM memory never shrinks. Evict samples no open document names.~~ Done in Plan 7. (Audition no longer adds to this: it decodes on the
  side into slot 0.) ~~`Sample::from_planar` copied the staging buffer instead of taking it.~~ Done in Plan 6.

## From the Plan 5 review (deferred, 2026-10-09)

- **Packing:** ~~the fixed-point loop stops silently after 8 rounds (a 600-frame fuzz never needed it); skyline assumes
  child widths on the 8 px grid (a free frame of off-grid width inside a STACK frame);~~ Done in Plan 6 (the loop keeps
  the shortest pack when it runs out; the skyline snaps to the grid). `autoWidth` runs a full pack per 8 px step (once
  per click).
- **Migration:** ~~opening a document re-packs former FIX frames but does not re-fit a STACK parent around a shrunken
  child.~~ Done in Plan 6 (a free parent is never resized by packing, so it stays as it was).
- ~~**WIRES lists cables hidden inside collapsed frames;** picking one highlights nothing.~~ Done in Plan 6: they are
  dimmed with `(collapsed)`, and picking one expands the frame.
- ~~**Ghost normals** rebuild their stubs on every document change (not per hover).~~ Done in Plan 6.
- ~~**Tests to strengthen:** nested resize does not prove `also` re-packs the parent; the migration's reading-order
  assertion is weak; no test of the Canvas `wholeNormal` predicate; no block test with more than three jacks a side;
  the collapse e2e checks the master stays audible, not that it is the same collapsed and expanded.~~ Done in Plan 6.
- ~~**Code tidy:** `frames.ts` ↔ `wires.ts` import each other; `rectsOf2` duplicates `rectsOf` and a bare `{}` block
  remains in `frames.test.ts`; a filler assertion at `frames.test.ts:284`.~~ Done in Plan 6.

## From the Plan 6 review (deferred, 2026-10-09)

- **STACK fallback is not a strict fixed point:** when the re-pack loop finds a true cycle it keeps the lowest pack
  after 8 rounds; a second press can still move children (deterministic, never seen in a 600-frame fuzz).
- ~~**Stereo samples hold ~3× frames of memory:** after `split_off` the left channel keeps the staging buffer's whole
  capacity (`shrink_to_fit` off the audio thread, or with the eviction item above).~~ Done in Plan 7.
- **DEFAULT flashes at launch** before the saved skin applies (read the skin before creating the session).
- **Tint fills and the WIRES row-on text** are close `color-mix` values, not byte-identical to the old DEFAULT
  literals; the mix ratios are scattered numbers in `canvas.css`.

## From the Plan 7 review (deferred, 2026-10-09)

- **The ⌘O dialog filters on `json`, not `*.sreda.json`:** Electron's file filters match the last extension only.
- **Edits made during an in-flight save are marked saved:** `markSaved()` runs when the write resolves, whatever
  changed meanwhile.
- **The real file dialogs and the ⇧⌘I accelerator are not exercised by e2e:** e2e stands in for the dialogs with
  `SREDA_E2E_OPEN` / `SREDA_E2E_IMPORT` and sends the menu event directly.
- **Library.tsx duplicates the picker's 120 ms audition timer:** the two should share one helper.
- **LOAD with an unreadable or non-audio file** returns silently (no notice); two quick clicks on a sample display
  can open two dialogs (no in-flight guard).

## From Plan 14

- **A META-SEQ compiles in ~0.14 ms.** (Inside a feedback loop it now syncs once per block and writes its trace at
  the block end.)
- `protocol/src/bench.test.ts` 5 s threshold was marginal (flaky): the 200-module patch had QUANT re-snapping held
  pitch on every sample. QUANT now keeps its last snap; the patch renders in ~4.4 s.
- **The prototype's Main board** keeps dormant contour / pads display code (no module uses those kinds now) and draws
  META-SEQ as a plain 2U panel with a stand-in Sim; the drawer is not prototyped.
- **Drift made at a PAT switch** is not in the document until that pattern plays again (the trace carries only the
  incoming pattern); save / stop loses the last switch's drift.
- **A PAT switch on a ×N sub-step** leaves lanes misaligned (fires recomputed only on a rise; the old sub_left keeps
  firing); `next_tie` reads the TIE lane's own cursor.
- **A merged RHYTHM + STAGES ignores STAGES' ○ pulse rests** (no exact mapping in PLAYED).
- **MUTATE's write-back marks the document unsaved** every GATE cycle while MUT > 0.
- **META-SEQ drawer polish:** NOTE / ACC / VEL not dimmed past their own LEN; three paths rebuilt every rAF; 9 px
  lengths text; `playing` in SeqView never resets on audio stop; Lane hard-codes scale / root defaults; duplicated
  cells memo; the LEN marker overlaps the last cell by 6 px.
- **META-SEQ tests to add:** `pat` as a 0…1 position; the field-reset double-click guard; e2e asserting the trace, not
  just the lit tab; mod-jack drops and the autosave notice in migration; edit-wins tested only synchronously.
- **MUTATE write-back edge cases:** wrap detection by cursor sampling can alias on fast short GATE lanes; a write-back
  may write between wraps while an id is held, or overwrite a newer drift; redo after a write-back drops the drift.
- **Migration:** cable dedup reaches beyond the remapped cables; the notice is cleared by the audio-start click; a
  free-running STAGES' SLOPE runs at the default rate (STAGES t{k} dropped).

## From Plan 18

- **DICE fx:** the echo is capped at 2 s (DELAY's `time` maximum), so the drone style's long echoes are shorter than
  its beat picks suggest; a longer DELAY or a chained pair would lift it.
- **DICE electro:** its four drum roles are single parts rather than a kit; they share one DRUMS frame but cannot be
  thinned or switched as one voice.
- **DICE twists:** `feedback` always makes its own DELAY on one voice (the style's effect DELAY is built later, in
  `assemble`, out of the twist's reach); letting a twist reshape the style's chain would need `assemble` to take the
  twists. `switch` needs three gated voices, so it is rare in two-voice styles.

## From Plan 16

- **Plan 17 (decided, spec §1b):** STACK stretch to the right with a wider display; 2U displays for MIX / SPREAD /
  SWITCH / ATT; context hints and `? all shortcuts`; a short description per menu item; the save dialog; the LIMIT
  lamp (needs a pre-limiter readout); the stereo MIX meter (needs L / R peaks per OUT).
- **Keyboard:** `Segmented` has no roving tabindex / arrow keys; the LISTEN ✕ has no focus style; the LEN chip in the
  drawer is mouse-only.
- **Picker:** counts run `pickerItems` three extra times per query; replace mode shows a lone `Modules` segment; the
  frame-CLK `from` line has no e2e (portLabel is unit-tested); the listen helper in `Canvas.tsx` duplicates
  `portLabel`.
- **Sidebar:** a WIRES / LIBRARY filter matching nothing leaves a bare panel (no `No matches`); the MIX fader's range
  is a fixed 200 px of travel, not the track width; MASTER's card is ~4 px wider than the strips; a stray
  `.sr-cables .preview` rule sits in the sidebar block of `canvas.css`.
- **Frames:** `1 module` (singular) is untested; `GHEAD` (TS) and `--frame-head` (CSS) both say 32 with nothing
  keeping them in step; a collapsed frame shows no BPM pill (ruled; reconsider if tempo should show).
- **Drawer:** the two-row lane head overflows at the drawer's minimum height (160 px); the read-only Mutate field
  gets a hover border; magic offsets and a duplicated rule in `seq.css`; brittle drawer tests (header order by
  `textContent.indexOf`, 210 px read from `seq.css` by regex, a selector-rewriting helper).
- **Chrome:** `Click to start audio` stays at top 14 px (fine on a full-width canvas); the notice sits at 100 px
  even without LISTEN; tooltip casing is mixed (`save (⌘S)` vs `Undo (⌘Z)`); `.sr-hint`'s `right: 240px` is tied to
  the zoom bar's width; a narrow canvas (sidebar dragged wide) lets the bars overlap and the picker slide under the
  sidebar — no window `minWidth`.
- **Panels:** the field `editing` state clears only on `pointerup` (not `pointercancel`); `.sr-cval` overflows its
  cell by 1 px; the pill radii of `.sr-pport` / `.sr-listen` are literals.
- **Tests / tooling:** `Chrome.test` covers little of the zoom / hint / sidebar-on states and casts the session with
  `{} as never`; `scripts/screens.mjs` builds a RegExp from a tab name unescaped and leaves `SREDA_A4_PORT` without a
  comment.

## From Plan 15

- **A4 CC / NRPN parameter control** — the next step on the same event path; the tables are in the `elektron`
  repo's `maps/a4mk2.toml`.
- **Drift fallback** (spec §8.2: a fixed lookahead with SREDA's audio delayed the same) — not needed at the
  checkpoints; keep if notes drift on a heavier machine.
- **The pump's per-node clamp ignores session / ledger sends:** after an unmute, the injected Start can land after the
  A4 CLK's first ticks when A4 and A4 CLK OFS differ (sequencer phase lag until the next Start); a mute's note-off
  can cut a note re-triggered by a quick unmute. Fix: let `sendAfterScheduled` sends raise the node's `lastSent`.
- **Small MIDI-session edges:** a possible double Start within ms on an unmute during a RUN rise; the 60 ms Start
  re-check timer is not cleared on close; the pump's `lastSent` and the session's `silenced` sets never shrink
  (bounded per host); a ledger release by (channel, note) can cut the same note of another A4 sharing the track
  (won't fix: MIDI can't tell them apart).
- **A4 tests to add:** a TRK change mid-note; unpatch / repatch PITCH; the note rounds NOTE + 12·PITCH as a whole
  (spec: NOTE + round(12·PITCH); differs at exact negative half-semitones).
- `MidiDevices` is unusable after `dispose()` (one host per session today); `checkPort` runs only while the pump ticks.
