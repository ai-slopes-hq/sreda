# Backlog

Ideas kept for later. Not in the first build (`docs/superpowers/specs/2026-10-07-canvas-ux-design.md`).

## Next after the first build

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

- **FOLD sounds weak** (2026-10-09, from listening): it adds almost no level and few harmonics, and its modes
  barely differ. Rework against a reference wavefolder (Ableton's Saturator / Roar folding, Bitwig's wavefolder, a
  Buchla 259 / Serge-style folder): more gain into the fold, clearly different curves per mode, matched loudness.
- **FILTER models are not convincing** (2026-10-09, from listening): SK (MS-20), LADDER and DIODE do not sound like
  their originals and differ too little from each other (and from SVF). Compare against references (Moog ladder,
  TB-303 diode, MS-20 Sallen-Key) and re-tune drive, resonance and the self-oscillation character per model.
- **FILTER cutoff animation** (2026-10-09): the response glyph on the panel follows the live cutoff (and resonance)
  with modulation applied, schematically — the curve moves, no waveform.

- **A system mixer for every OUT** (2026-10-09): a patch may hold several OUT modules (one per group or voice), all
  summed into the master today. A mixer that sees every OUT in the project — a strip per OUT (named after its module
  or frame) with level, mute, solo and a meter, then the master — probably as a sidebar tab next to WIRES. Open:
  whether OUT's own LVL knob stays, and whether strips can be grouped per frame.

## Deep backlog

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
- **EUCLID pads** show the unmodulated LEN / HITS / ROT; touching a pad freezes that, not what plays.
- **Contour joints** (±5 px over the full height) take ~35 % of the display at LEN 16; fast strokes skip stages
  (no interpolation between moves).
- **DICE input latency:** a rAF + message round-trip; with DICE ← EOC the first step of the new cycle still plays the
  old pattern; it pauses while the window is hidden.
- **STAGES ADDR** has no hysteresis at stage boundaries; **RHYTHM** drops the accent on a TIE after a rest; dead
  `ids` in att.rs.

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
