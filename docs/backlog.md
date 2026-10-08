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

- **The folder's "2× oversampling" is a no-op:** averaging ADAA over linear-interpolated midpoints equals 1× ADAA. Either
  real 2× (a half-band decimator) or drop it and fix the spec / plan text.
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
