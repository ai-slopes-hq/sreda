# SREDA 2 — canvas UX/UI design

Date: 2026-10-07 · Status: approved in brainstorming, awaiting spec review

## Why

The previous attempt (`../sreda`) grew into a real DAW: tracks, clock editors, IN windows, a MIXER window,
full-page module screens. Making sound turned into managing a project. SREDA 2 is a playground for sketching
rhythmic/techno and ambient/drone patches. A session produces nothing but the playing itself; the patch is kept
only so you can come back to it.

## Goals

- From opening the app to hearing sound: one click.
- No modal windows, no inspector, no edit/play split: everything you change is on the canvas where you change it.
- Small atomic modules in the spirit of Bitwig Grid and Reaktor: few features each, many of them, complex patches
  built from simple parts.
- No global clock: anything periodic can clock anything.
- A professional look. No toy styling, no decorative animation; motion only where it carries information.

## Out of scope (first build)

Timeline, arrangement, transport, recording, export, file management, multiple canvases, MIDI and hardware
controllers, touch, polyphony, stereo cables, macro containers/groups, snippets, reverb.

## 1. Canvas

- One infinite 2D canvas, panned (drag empty space, or trackpad scroll) and zoomed (pinch / ⌘-scroll,
  25–200 %). Modules snap to a 16 px grid.
- Flat dark panels, monospace labels, no gradients, shadows or hardware imitation. UI text is English.
- Colour tokens: background `#121210`, panel `#1b1b18`, text `#e9e4d8`, muted `#8f897c`, destructive `#e5484d`;
  port roles: audio `#e9e4d8`, mod `#6cb4ee`, pitch `#9ad18b`, trigger `#f5a524`.

## 2. Modules

- A module is a compact block: name on top, inputs on the left edge, outputs on the right edge, parameters on the
  face between them.
- Every parameter is on the face as a small knob or a draggable value field. A module whose parameters do not fit
  is split into two modules; there is never a popup or side panel.
- Every knob has its own modulation input jack. With a cable in it, a thin ring around the knob sets the depth:
  a signal of ±1 at full depth sweeps the whole knob range (in knob space, taper included); depth is −100…+100 %.
- Live readouts, drawn per frame, information only:
  - a knob shows its modulated position as a thin tick next to the set position;
  - a trigger input flashes for 120 ms on each event;
  - each output shows a small level bar (held peak, 300 ms decay).

## 3. Signals

- One signal type: every cable carries a mono audio-rate stream of numbers. Any output may be cabled to any input;
  nothing is refused.
- Each port has a role. The role sets its colour and how an input reads the stream:

| Role    | Convention                                                                   |
|---------|------------------------------------------------------------------------------|
| audio   | nominal ±1                                                                   |
| mod     | ±1 (bipolar) or 0…1 (unipolar), per output, stated in the module spec        |
| pitch   | octaves: +1.0 = one octave up, added to the knob's pitch                     |
| trigger | input fires on a rising edge above 0.5 and re-arms below 0.25; outputs are 0/1, triggers 1 ms long, gates as long as they last |

- "Everything can be a clock" is just the trigger rule: a pulse OSC, an ENV end-of-cycle, a COMPARE gate, an LFO or
  a noise burst into a SEQ trigger input all step it. There is no clock module, clock type or clock domain.
- A cable takes the colour of its source port's role.

## 4. Patching gestures

- **Add, wired:** drag from any jack into empty space → a type-ahead search opens at the drop point, listing modules
  that have a port of the opposite direction; ports of the same role rank first. Enter places the module there and
  connects the dragged jack to its first port of the opposite direction, preferring the same role. Esc cancels.
- **Add, unwired:** double-click empty space → the same search, the module is placed unconnected.
- **Wire:** drag from jack to jack (either direction). An output takes any number of cables. An input takes one:
  dropping onto an occupied input replaces its cable (undoable). Summing takes a MIX.
- **Unwire / re-route:** grab a cable's input end, drop it in empty space to remove it, or on another input to move it.
- **Listen:** click any output jack → that output replaces the main output on the speakers. A thin bar at the top
  reads `LISTENING · <module> › <port>`; clicking the bar or pressing Esc returns to the main output. Clicking the
  same jack again also returns. The listened signal passes through the master stage (§6).
- **Edit:** drag a module by its name to move it; drag on empty space with Shift to box-select; ⌘D duplicates the
  selection with the cables inside it; Backspace deletes the selection (its cables go with it).
- **Randomise:** R with the pointer over a module sets each of its knobs to a random value within the knob's
  `randomRange` (defaults to its full range; pitch and frequency knobs declare narrower, musical ranges). One undo
  step.
- **Undo:** ⌘Z / ⇧⌘Z for every edit. One knob drag is one step; a wheel run on one knob merges into one step until
  a 0.7 s pause.

## 5. Session and seeds

- The canvas autosaves to IndexedDB 500 ms after the last edit. Opening the app resumes the last canvas.
- Audio starts on the first click anywhere (browser autoplay rule); until then a single line reads
  `CLICK TO START AUDIO`.
- **NEW** (top-right button, the only chrome besides the listen bar) replaces the canvas with a random seed patch,
  never the same seed twice in a row. Pressing NEW again re-rolls. NEW is an undo step.
- Seeds are built only from the first atoms and fade in over 200 ms:
  - **Pulse:** a slow square OSC triggers an ENV on a sine OSC's pitch and a VCA (a kick); NOISE through a short ENV
    and VCA (hats).
  - **Polymeter:** two square OSCs at a 3:4 frequency ratio each step a SEQ; both voices go into one FILTER.
  - **Self-clocked:** an ENV in loop mode, its end-of-cycle steps a SEQ; no oscillator clock.
  - **Drone:** two detuned saw OSCs into a FILTER, slow LFOs on the cutoff and on one OSC's pitch input (detune), into a DELAY.
  - **Ratchet:** S&H samples NOISE to set an ENV's decay, so the rhythm drifts.

## 6. First atoms

| Group        | Modules |
|--------------|---------|
| Sources      | OSC (sine / saw / square + pulse width; pitch, FM, sync inputs), LFO, NOISE, CONST |
| Shaping      | ENV (attack / decay, loop switch; end-of-rise and end-of-cycle trigger outputs), VCA, FILTER (state-variable LP / BP / HP) |
| Logic & time | SEQ (8 steps; trigger in; value, gate, end-of-cycle outputs), DIV (÷N on triggers), COMPARE (signal in, gate out), S&H, QUANT (scale) |
| Math & mix   | MIX (4 inputs), MATH (scale, offset, invert) |
| FX & out     | DELAY, OUT (L / R inputs, level) |

Several OUT modules sum. After them the master stage is fixed: 5 Hz DC blocker, soft limiter, nothing non-finite
reaches the device.

## 7. Architecture

Package boundaries: `core ← protocol ← engine`, `core ← ui`, enforced by ESLint.

- **core** — the document and its edits. The document is immutable JSON:
  `modules: { id, type, x, y, params }[]`, `cables: { from: [moduleId, port], to: [moduleId, port] }[]`.
  Edits are pure functions returning a new document; undo is a history of documents grouped per gesture. Module
  specs (ports with roles, params with ranges, tapers and `randomRange`) are data in core.
- **protocol** — UI ↔ engine messages and the SharedArrayBuffer layout for live readouts (knob modulated positions,
  trigger events, output levels). One reader per buffer.
- **engine** — the graph is compiled into a run order on the UI thread; the worklet runs the plan. Cycles are
  allowed: a cycle's back edge is read one sample late. A knob change is a param message (no re-plan); a module or
  cable change sends a new plan. Removed modules and cables fade over 10 ms.
- **ui** — Preact + signals. Modules are DOM elements on a layer panned and zoomed by a CSS transform; cables are
  drawn on one SVG layer; per-frame readouts are drawn imperatively in requestAnimationFrame.
- The app is served with COOP/COEP headers (SharedArrayBuffer). Chromium first.

## 8. Errors and safety

- Every module guards against NaN: it outputs 0 and resets its state.
- The master stage (§6) is always on, for the main output and the listen path alike.
- A corrupt autosave is kept under a backup key, a seed opens instead, and a one-line notice says so.

## 9. Testing

- **core:** edits, undo grouping, graph compile including cycles.
- **engine (Node):** each module's DSP is deterministic with a seeded RNG; trigger detection (threshold and
  hysteresis); a DSP gives the same samples per block or per sample; a GC-count test over a minute of audio.
- **ui:** component tests (happy-dom).
- **e2e (Playwright):** drag from a jack → search → placed and wired; click to listen and back; R randomises and
  undo restores; NEW re-rolls and undo restores; reload resumes the canvas.
