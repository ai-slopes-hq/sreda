# SREDA 2 — canvas UX/UI design

Date: 2026-10-07 · Revision 4 (module sizes, frame tools, replace, insert, cable focus) · Status: approved in brainstorming, awaiting spec review

## Why

The previous attempt (`../sreda`) grew into a real DAW: tracks, clock editors, IN windows, a MIXER window,
full-page module screens. Making sound turned into managing a project. SREDA 2 is a playground for sketching
rhythmic/techno and ambient/drone patches. A session produces nothing but the playing itself; the patch is kept
only so you can come back to it. The instrument it chases is a Serge / Buchla / Eurorack system on an open canvas.

## Goals

- From opening the app to hearing sound: one click.
- No modal windows, no inspector, no edit/play split: everything you change is on the canvas where you change it.
- Small atomic modules in the spirit of Bitwig Grid and Reaktor, with a west-coast module set: few features each,
  many of them, complex patches built from simple parts.
- No global clock: anything periodic can clock anything. Groups may share a clock, opt-in.
- A professional look. No toy styling, no decorative animation; motion only where it carries information.

## Out of scope (first build)

Timeline, arrangement, transport, recording, export, file management, multiple canvases, MIDI and hardware
controllers, touch, polyphony, stereo cables, group macros and collapsing, snippets, reverb. Later ideas are kept in
`docs/backlog.md`.

## 1. Canvas

- One infinite 2D canvas. Pan: wheel / two-finger scroll, Space+drag, middle-button drag. Zoom: ⌘-scroll / pinch,
  25–200 %. Modules snap to a 16 px grid.
- Flat dark panels, monospace labels, no gradients, shadows or hardware imitation. UI text is English.
- Colour tokens: background `#121210`, panel `#1b1b18`, text `#e9e4d8`, muted `#8f897c`, destructive `#e5484d`;
  port roles: audio `#e9e4d8`, mod `#6cb4ee`, pitch `#9ad18b`, trigger `#f5a524`.
- **Colour means role, everywhere.** Jacks are drawn in their port's role colour, and the role is how an input reads
  the stream (§3). A cable between two ports of the same role is that role's colour. A cable joining two different
  roles (an LFO into an audio FM input, an envelope into a trigger input) changes colour along its length: the
  source's colour for the first ~40 %, a blend in the middle, the input's colour for the last ~40 %. Ghost cables
  (normals) use the same rule, dashed.

## 2. Modules

- A module is a compact block: name on top, inputs on the left edge, outputs on the right edge, parameters on the
  face between them.
- **Sizes are quantised:** width N × HP (HP = 48 px: one input column, the knob columns, one output column), height
  1U, 2U or 3U (U = 112 px; 2U is exactly two 1U). Each module's size is fixed in its spec (§7) and its panel is
  designed for it. Placement on the canvas stays free (16 px grid, magnets); the sizes make STACK pack cleanly.
- Every parameter is on the face as a small knob or a value field you drag. A module whose parameters do not fit is
  split into two modules; there is never a popup or side panel.
- Every knob has its own mod jack (top-left of the knob). Its attenuverter (§3) is drawn as a ring around the knob:
  a signal of ±1 at attenuverter 1 sweeps the whole knob range in knob space, taper included.
- Live readouts, drawn per frame, information only:
  - a modulated knob shows where it is right now as a dot on its ring;
  - a trigger input flashes for 120 ms on each event (after its ratio);
  - each output shows a small level bar (held peak, 300 ms decay);
  - SCOPE draws its traces on its face.

## 3. Signals and inputs

- One signal type: every cable carries a mono audio-rate stream of numbers. Any output may be cabled to any input;
  nothing is refused.
- Each port has a role. The role sets its colour and how an input reads the stream:

| Role    | Convention |
|---------|------------|
| audio   | nominal ±1 |
| mod     | ±1 (bipolar) or 0…1 (unipolar), per output, stated in the module spec |
| pitch   | octaves: +1.0 = one octave up, added to the knob's pitch |
| trigger | input fires on a rising edge above 0.5 and re-arms below 0.25; outputs are 0/1, triggers 1 ms long, gates as long as they last |

- "Everything can be a clock" is the trigger rule: a pulse OSC, a SLOPE end-of-cycle, a COMPARE gate or a noise
  burst into a STAGES advance input all step it. There is no clock type or clock domain.
- **Stacking.** Any input takes any number of cables. Audio, mod and pitch inputs sum them. Trigger inputs merge
  them: each cable is edge-detected on its own and any rise fires the input.
- **Attenuverter on every CV input** (mod and pitch roles, and every knob's mod jack): a value next to the jack,
  −1…+1, applied after the sum. Default +1; on a knob's mod jack the default is the param's `modDepth` (0.25 for
  frequency-type knobs, else 1). Audio inputs have none.
- **Ratio on every trigger input:** a value next to the jack, ÷16 … ÷2, 1, ×2 … ×8 (stored as a signed integer:
  −N = ÷N, N = ×N, 1 = unity), applied after the merge. ÷N lets the 1st of every N events through; ×N adds N−1
  events evenly spaced over the interval between the last two incoming events (nothing extra until two events have
  arrived).
- Value fields next to jacks: drag vertically to change, double-click to reset.
- **Normals.** A module spec may pre-wire an input. A normal is live only while that input has no cables; the first
  real cable replaces it, removing the last cable brings it back. Kinds: from one of the module's own outputs, from
  an internal source (named, e.g. `noise`), or a constant value. A normal may be conditional on an option param
  (SLOPE: only with CYCLE on) or on its source output being unpatched (A×B+C). On screen a normalled input has a
  dashed ring; a normal from the module's own output is drawn as a faint dashed ghost cable; hovering a normalled
  input names its source (`IN ← NOISE (normal)`).

## 4. Patching gestures

- **Add, wired:** drag from any jack into empty space → a type-ahead search opens at the drop point, listing modules
  that have a port of the opposite direction; ports of the same role rank first; a knob's mod jack counts as an
  input of role mod. Enter places the module so the chosen port sits at the drop point and connects the dragged jack
  to its first port of the opposite direction, preferring the same role. Esc cancels. The list shows every match and scrolls (wheel, ↑/↓ keep the highlighted entry in view).
- **Add, unwired:** double-click empty space → the same search; the module is placed unconnected.
- **Wire:** drag from jack to jack (either direction). Dropping onto an occupied input adds a cable (stacking).
- **Unwire / re-route:** drag from an input that has cables to pick up its most recent cable; drop it on another
  input to move it, or in empty space to remove it.
- **Listen:** click any output jack → that output replaces the main output on the speakers. A thin bar at the top
  reads `LISTENING · <module> › <port>`; clicking the bar, pressing Esc or clicking the same jack again returns to
  the main output. Listening ends by itself when the listened module is deleted. The listened signal passes through
  the master stage (§7).
- **Select:** click selects; Shift adds. Dragging on empty canvas (also the empty inside of a frame) draws a
  selection box: it selects the modules it touches and the frames it fully encloses.
- **Edit:** drag a module anywhere on its face (not on a control) to move it; ⌘D duplicates the selection with the
  cables inside it; Backspace deletes the selection with its cables.
- **Magnets:** while a module or selection is dragged, its bounding box snaps flush to nearby modules when an edge
  comes within 10 screen px: side by side (edges touching, tops or bottoms aligned) or stacked (one under the
  other, lefts or rights aligned). A thin guide line shows each active snap. Holding ⌘ while dragging turns magnets
  off. Magnets only arrange; snapped modules do not stay linked. Inside a ROUTE frame magnets keep a 32 px gap instead
  of a flush edge.
- **Replace:** double-click a module's name → the search opens as `REPLACE <MODULE>`; Enter puts the new module in
  the same place and frame. Cables move to the new module's port with the same id, else to its next unused port of
  the same role; cables with no match are removed. Knobs with the same id keep their value (`freq` survives OSC →
  COMPLEX); attenuverters and ratios move with their port. One undo step.
- **Insert into a cable:** drag a module that has no cables over a cable; within 8 screen px the cable highlights;
  dropping splits it: source → the module's first input of the source's role (else its first input), the module's
  first output of the target's role (else its first output) → the old target. One undo step.
- **Cable focus:** hovering or selecting a module or a frame header shows its cables (a frame: all cables touching
  anything inside it) at full strength and slightly thicker, and dims every other cable to 25 %. With nothing hovered
  or selected all cables are drawn normally.
- **Randomise:** R with the pointer over a module sets each of its knobs to a random value within the knob's
  `randomRange` (default: full range; pitch and frequency knobs declare narrower, musical ranges). Options,
  attenuverters and ratios are left alone. One undo step.
- **Undo:** ⌘Z / ⇧⌘Z for every edit. One drag is one step; a wheel run on one control merges into one step until a
  0.7 s pause.
- Knobs: drag vertically (200 px = full range, Shift = ×0.1), wheel (1 % per notch, one step for stepped knobs),
  double-click resets. Options: click cycles.

## 5. Groups (frames)

- A group is a **frame**: a rectangle of its own with a translucent fill and a 28 px header strip carrying the name
  (`GROUP 1`, `GROUP 2`…; double-click to rename), the frame tools and the clock controls. Drag an edge or corner to resize (minimum 160 × 96);
  drag the header to move the frame and everything inside it; click the header to select it.
- **Membership is containment.** Every module and frame has a `parent` (a frame or none). After any drop — move,
  resize, add from search, duplicate, ⌘G — parents are recomputed: an object's parent is the innermost frame that
  contains its centre, never itself or one of its descendants. Dropping into a frame attaches; dragging out
  detaches; resizing a frame over an object attaches it. Frames nest to any depth.
- **⌘G** wraps the selection in a new frame fitted around it (16 px padding, header above), nested in the
  selection's innermost common parent. **⇧⌘G** removes the selected frame; its children move to its parent.
  **Backspace** on a selected frame deletes it and everything inside it (one undo step).
- **Clock.** The header has a **CLK in** jack (trigger role, outside the frame at the header's left end) and a
  **CLK out** jack (trigger role, inside the frame under the header). Members use the clock by being patched from
  CLK out with ordinary cables, which carry their own input ratios; CLK out may also be patched outside the frame.
- CLK in is a trigger input, so it has a ratio (÷16…×8). **A nested frame's CLK in is normalled to its parent's
  CLK out** (dashed ring, faint ghost line from the parent's CLK out), so a child inherits its parent's clock through
  its own ratio.
- What CLK out carries, highest priority first: a cable in CLK in; the frame's own clock; the parent's clock (nested
  frames only, through the ratio); nothing.
- **Own clock:** `+ CLOCK` in the header turns it on and shows BPM (20–300, drag to change; one trigger per beat),
  TAP (sets BPM from the last taps) and ✕ (turns it off). While a cable is in CLK in, the own clock is dimmed and
  does not run.
- CLK out flashes on each tick.
- **Frame tools** in the header:
  - **Tint** (a small swatch): click cycles the fill through neutral (≈ 4 % white) and six muted hues (≈ 8 %).
    Nested frames layer, so the hierarchy reads without extra lines.
  - **STACK:** packs the frame's direct children (modules, and child frames as single blocks) flush, Tetris-style:
    children are taken in reading order (rows by position, then x) and each goes to the lowest free spot across the
    frame's width; the width stays, the height fits the result. One action, one undo step.
  - **ROUTE:** a frame mode (`layout: 'route'`), toggled. Turning it on packs like STACK with 32 px channels between
    children. Cables with both ends inside the frame are then drawn orthogonally through the channels — out of the
    source into the channel on its right, up to the channel above the target, across, down the channel on the
    target's left, into the jack (into a knob's mod jack: straight down from the channel above) — with rounded
    corners and one 4 px lane per cable. Routes follow the modules live. Turning ROUTE off returns to curves and
    keeps the layout.
  - **MUTE (M):** the frame fades out over 50 ms: cables leaving the frame and OUT modules inside it go silent; clocks
    and everything inside keep running, so the voice comes back in time. Its contents are drawn at 40 %. Muting a
    frame mutes its children.

## 6. Session and seeds

- The canvas autosaves to IndexedDB 500 ms after the last edit. Opening the app resumes the last canvas.
- Audio starts on the first click anywhere (browser autoplay rule); until then a single line reads
  `CLICK TO START AUDIO`.
- **NEW** (top-right button, the only chrome besides the listen bar) replaces the canvas with a random seed patch,
  never the same seed twice in a row. Pressing NEW again re-rolls. NEW is an undo step.
- Seeds are built only from the first modules and fade in over 200 ms:
  - **Pulse:** an OSC square at 2 Hz pings an LPG on a 50 Hz sine (kick); the same clock, ×2 on the input, pings a
    second LPG on NOISE (hats); MIX → OUT.
  - **Drone:** COMPLEX (modulator → carrier FM normal, low index) → FOLD → FILTER (LP) → DELAY → OUT; UNCERTAINTY's
    smooth output on the fold amount, a slow cycling SLOPE on the cutoff.
  - **Self-clocked:** a cycling SLOPE (its own normal) advances STAGES; STAGES' voltage → QUANT → OSC pitch; STAGES'
    pulse pings an LPG on that OSC; STAGES' voltage also feeds the SLOPE's fall, so the rhythm breathes.
  - **Polymeter:** a group with its own clock at 120 BPM; CLK out → two STAGES, one at ÷3, one at ×2, each driving
    its own voice.
  - **Ratchet:** S&H (input normalled to noise), sampled on a SLOPE's EOC, sets that SLOPE's fall, so the rhythm
    drifts.

## 7. First modules

Ports are `name (role)`; normals are written `input ← source`.

Size is `HP × U`.

| Family | Module | Inputs | Knobs and options | Outputs | Normals |
|---|---|---|---|---|---|
| Sources | **OSC** | pitch (pitch), fm (audio, linear), sync (trigger) | freq, wave SIN/TRI/SAW/SQR, pw, fm index | out (audio) | — |
| | **COMPLEX** — modulator + carrier | pitch (pitch), fm (audio) | freq (carrier), ratio (modulator ÷ carrier, 0.25–8), index, timbre (fold), modulator wave SIN/TRI/SAW | out (audio), mod (audio) | fm ← internal modulator |
| | **NOISE** | — | level | white (audio), pink (audio) | — |
| | **UNCERTAINTY** — Buchla 266 style | trig (trigger) | rate, levels (2–16) | smooth (mod bi), stepped (mod bi), quant (mod bi) | trig ← internal clock at `rate` |
| Shaping | **SLOPE** — Serge DUSG / Maths | trig (trigger), in (audio, slew) | rise, fall, shape (log…lin…exp), cycle OFF/ON | out (mod uni), eor (trigger), eoc (trigger) | trig ← eoc, when cycle is ON |
| | **LPG** | in (audio), cv (mod), ping (trigger) | level, decay (vactrol-like), mode VCA/LP/BOTH | out (audio) | cv ← internal ping envelope |
| | **VCA** | in (audio) | level | out (audio) | — |
| | **FILTER** — state-variable, all outputs at once | in (audio) | cutoff, res | lp, bp, hp (audio) | — |
| | **FOLD** | in (audio) | fold, symmetry | out (audio) | — |
| Time & logic | **STAGES** — Buchla 248 style | adv (trigger), reset (trigger), addr (mod: 0…1 picks a stage) | per stage 1–8: voltage, time, pulse ON/OFF; length; mode STEP/SLOPE | cv (mod bi), pulse (trigger), eoc (trigger) | adv ← internal stage timer (advances when the stage's time is up) |
| | **COMPARE** | in (audio) | threshold | out (trigger) | — |
| | **S&H** | in (audio), trig (trigger) | — | out (mod bi) | in ← internal noise |
| | **QUANT** | in (pitch) | scale, root | out (pitch) | — |
| Mix & math | **MIX** | a, b, c, d (audio) | level a–d | out (audio) | — |
| | **ATT** — Quadratt style, 4 channels | in1–in4 (audio) | per channel: attenuverter, offset | out1–out4 (mod bi) | inN ← +1; an unpatched outN adds into out(N+1) |
| | **A×B+C** — Befaco style, 2 channels | a1, b1, c1, a2, b2, c2 (audio) | per channel: A gain, B gain (attenuverters), C offset | out1, out2 (audio) | bN ← +1; c2 ← out1, while out1 is unpatched |
| FX & out | **DELAY** | in (audio) | time, feedback, mix | out (audio) | — |
| | **SCOPE** — with thru, like a Mordax DATA | a, b (audio), trig (trigger) | time (1 ms–10 s per screen), gain a, gain b, mode A·B / XY | thruA, thruB (audio: the inputs unchanged; gains affect the display only) | — |
| | **OUT** | l, r (audio) | level | — | r ← l |

- Sizes (HP × U): OSC 6×1, COMPLEX 7×1, NOISE 3×1, UNCERTAINTY 4×1, SLOPE 6×1, LPG 5×1, VCA 3×1, FILTER 4×1,
  FOLD 4×1, STAGES 10×3, COMPARE 3×1, S&H 2×1, QUANT 4×1, MIX 4×2, ATT 6×2, A×B+C 5×2, DELAY 5×1, SCOPE 6×2, OUT 3×1.
- SCOPE syncs its sweep on a TRIG rise when TRIG is patched, else on A's rising zero crossing, else runs free.
  Its display area takes the space of 4 × 2 knob cells.
- Several OUT modules sum. After them the master stage is fixed: 5 Hz DC blocker, soft limiter, nothing non-finite
  reaches the device.

## 8. Architecture

Package boundaries: `core ← protocol ← engine`, `core ← ui`, enforced by ESLint.

- **core** — the document and its edits. The document is immutable JSON:
  `modules: { id, type, x, y, params, atts, ratios }[]` (`atts` and `ratios` keyed by input port id, mod jacks as
  `@param`), `cables: { from: [id, port], to: [id, port] }[]`,
  `groups: { id, name, x, y, w, h, parent, ratio, tint, layout: 'free' | 'route', muted, clock: { on: boolean, bpm: number } }[]`; modules also carry
  `parent` (a group id or null). A group's jacks are addressed as
  `[groupId, 'clkIn']` and `[groupId, 'clkOut']`. Edits are pure functions returning a new document; undo is a history of documents grouped per
  gesture. Module specs (ports with roles, params with ranges, tapers, `randomRange`, `modDepth`, normals) are data
  in core. `compile` (document → plan) lives in core so the UI never imports the engine; it resolves normals into
  ordinary bindings and compiles each group into a hidden clock node.
- **protocol** — UI ↔ engine messages and the SharedArrayBuffer layout for live readouts (modulated knob positions,
  trigger events, output levels, scope traces). One reader per buffer.
- **engine** — the worklet runs the plan. A muted frame's outgoing bindings and OUT modules get a 50 ms gain ramp
  (compile marks them; a mute toggle is a message, not a re-plan). Cycles are allowed: a cycle's back edge is read one sample late. The engine
  prepares every input before a module runs: sums stacked cables and applies the attenuverter (CV), or merges,
  ratios and re-emits 1 ms triggers (trigger inputs), so DSP code sees one clean buffer per input. A knob,
  attenuverter or ratio change is a message (no re-plan); a module, cable or group change sends a new plan. Removed
  modules and cables fade over 10 ms.
- **ui** — Preact + signals. Modules are DOM elements on a layer panned and zoomed by a CSS transform; cables are
  SVG; per-frame readouts are drawn imperatively in requestAnimationFrame.
- The app is served with COOP/COEP headers (SharedArrayBuffer). Chromium first.

## 9. Errors and safety

- Every module guards against NaN: it outputs 0 and resets its state.
- The master stage (§7) is always on, for the main output and the listen path alike.
- A corrupt autosave is kept under a backup key, a seed opens instead, and a one-line notice says so.

## 10. Testing

- **core:** edits (stacking, frames and parent recomputation), undo grouping, compile including cycles, normals and group clocks.
- **engine (Node):** each module's DSP is deterministic with a seeded RNG; trigger detection, merging and ratios;
  attenuverters; a DSP gives the same samples per block or per sample; a GC-count test over a minute of audio.
- **ui:** component tests (happy-dom).
- **e2e (Playwright):** drag from a jack → search → placed and wired; stack two cables on one input; click to listen
  and back; R randomises and undo restores; box-select by dragging; magnets snap flush; ⌘G frames the selection,
  own clock ticks, CLK out drives a member, a nested frame inherits its parent's clock at ÷2; dragging a module out
  of a frame detaches it; STACK packs a frame; ROUTE draws orthogonal cables; MUTE silences a frame's outgoing
  cables; replace keeps matching cables and knob values; dropping a free module on a cable inserts it; NEW re-rolls and
  undo restores; reload resumes the canvas.
