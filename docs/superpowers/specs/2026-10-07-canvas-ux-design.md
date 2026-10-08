# SREDA 2 — canvas UX/UI design

Date: 2026-10-07 · Revision 16 (the top-right button that opens the sidebar is SIDEBAR; WIRES is its tab) · Status: approved

## Why

The previous attempt (`../sreda`) grew into a real DAW: tracks, clock editors, IN windows, a MIXER window,
full-page module screens. Making sound turned into managing a project. SREDA 2 is a playground for sketching
rhythmic/techno and ambient/drone patches. A session produces nothing but the playing itself; the patch is kept
only so you can come back to it. The instrument it chases is a Serge / Buchla / Eurorack system on an open canvas.

## Goals

- From opening the app to hearing sound: one click.
- No modal windows, no inspector, no edit/play split: everything you change is on the canvas where you change it.
  The one exception is the WIRES editor (§5a), a side view of the same wires that keeps the canvas live beside it.
- Small atomic modules in the spirit of Bitwig Grid and Reaktor, with a west-coast module set: few features each,
  many of them, complex patches built from simple parts.
- No global clock: anything periodic can clock anything. Groups may share a clock, opt-in.
- A professional look. No toy styling, no decorative animation; motion only where it carries information.

## Out of scope (first build)

Timeline, arrangement, transport, recording, audio export, multiple open canvases, MIDI and hardware controllers
(next after the first build, through Web MIDI), touch, polyphony, stereo cables, group macros and collapsing, reverb. Later ideas are kept in
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
- **Sizes are quantised:** width N × HP (HP = 56 px), height 1U, 2U or 3U (144, 272 and 400 px: the header, a 6 px
  inset, the lanes, 10 px under the last lane). Each module's size is fixed in its spec (§7). Placement on the canvas
  stays free (8 px grid, magnets); the sizes make STACK pack cleanly.
- **Panel grammar — one layout for every module, small or large** (board *Panel system* in the prototype):
  1. Under a 32 px header (the name) and a 6 px inset, the panel is cut into **lanes of 32 px**: 1U = 3 lanes,
     2U = 7, 3U = 11. Room to breathe is part of the grammar: knobs 56 × 40, jacks 11 px, 4 px inside the edges of a
     display or a button.
  2. **Three columns, always:** the IN column (1 HP) on the left, the OUT column (1 HP) on the right, the control
     area (N − 2 HP) between them, the side columns a shade darker (#171715). Ports live only in the side columns
     (knob mod jacks excepted).
  3. **One jack per lane**, top down in spec order: sound, then clocks and triggers, then CV. A jack's label and its
     value (attenuverter or ratio) share its lane; an output's level bar sits under its label. Quiet: the value
     shows only when it is not the default, or while the module is under the pointer, selected alone or being
     edited. Every port label sits on the same upper line of its lane (the value or level line under it stays
     reserved, so nothing moves when a value appears); port labels are at most 5 characters (`THR A`).
  4. **The control area, top to bottom, always in this order:** the DISPLAY (if any; the full width of the control
     area, a whole number of lanes) → KNOB ROWS (2 lanes each, knobs left to right by importance) → the MODE STRIP
     (the bottom lane).
  5. **The mode strip** holds everything that does not turn: options, with `▾` for a list and glyphs instead of words
     where they are shapes; OFF/ON options are toggles labelled with their name and lit when on; actions (DICE, TAP)
     are pushed to the right. A button is 1 HP wide; a `▾` list with words (MODE, GEN) takes 2 HP.
  6. **Displays share one look:** a #121210 inset with a thin border; light = on, amber = where we are now, dashed =
     computed, hatched = rest. A display may be edited directly, but it never replaces a knob that must be
     modulated.
  7. **Size follows content:** control columns = max(knobs per row, the display's width); height = the smallest of
     1U / 2U / 3U that holds the jacks and the control area. Large modules are the same grammar with a larger
     display, not a different design.
  8. **Type:** the module name 11 px semibold, labels 9 px in a quiet colour (#6f6a5f), values 9–10 px; no other
     sizes on a panel.
  9. **Quiet panels:** a knob's value shows only while the module is under the pointer, selected alone or being
     edited, and always on a modulated knob (in the mod colour). Labels, arcs and pointers always show, so the
     state reads at a glance and the numbers come when you reach for them.
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
- **Edit:** drag a module anywhere on its face (not on a control) to move it; ⌘D duplicates the selection's modules with
  the cables between them, 32 px right and down (frames in the selection are skipped: duplicating a frame is in the
  backlog); Backspace deletes the selection with its cables.
- **Magnets:** while a module or selection is dragged, its bounding box snaps flush to nearby modules when an edge
  comes within 10 screen px: side by side (edges touching, tops or bottoms aligned) or stacked (one under the
  other, lefts or rights aligned). A thin guide line shows each active snap. Holding ⌘ while dragging turns magnets
  off. Magnets only arrange; snapped modules do not stay linked. Inside a WIRE FIX frame magnets keep a 32 px gap instead
  of a flush edge.
- **Replace:** double-click a module's name → the search opens as `REPLACE <MODULE>`; Enter puts the new module in
  the same place and frame. Cables move to the new module's port with the same id, else to its next unused port of
  the same role; cables with no match are removed. Knobs with the same id keep their value (`freq` survives OSC →
  COMPLEX); attenuverters and ratios move with their port. One undo step.
- **Insert into a cable:** drag a module that has no cables over a cable; within 8 screen px the cable highlights;
  dropping splits it: source → the module's first input of the source's role (else its first input), the module's
  first output of the target's role (else its first output) → the old target. One undo step.
- **Wire hover:** a wire under the pointer (within 6 screen px of its drawn path, routed or curved) is drawn at full
  strength and thicker, every other wire dims to 15 %, and a tag by the pointer names both ends
  (`SLOPE › EOC  →  STAGES › ADV`). It takes precedence over cable focus.
- **Cable focus:** hovering a module or a frame header shows its cables (a frame: all cables touching anything inside
  it) at full strength and slightly thicker, and dims every other cable to 20 %. Selection does not focus: with
  nothing hovered all cables are drawn normally.
- Popups (the picker, option lists) close when the canvas pans or zooms.
- **Randomise:** R with the pointer over a module sets each of its knobs to a random value within the knob's
  `randomRange` (default: full range; pitch and frequency knobs declare narrower, musical ranges). Options,
  attenuverters and ratios are left alone. One undo step.
- **Fit:** F fits the whole patch in view, ⇧F the selection.
- **Undo:** ⌘Z / ⇧⌘Z for every edit. One drag is one step; a wheel run on one control merges into one step until a
  0.7 s pause.
- Knobs: drag vertically (200 px = full range, Shift = ×0.1), wheel (1 % per notch, one step for stepped knobs),
  double-click resets. Options with two values toggle on click. Options with three or more (SCALE, WAVE, MODE…)
  show `▾` and open a small list anchored under the cell on click — not a window: the current value is highlighted,
  a click picks, Esc or a click elsewhere closes. The wheel steps any option without opening the list.
- Options that are shapes are drawn, not named: WAVE options (OSC, COMPLEX's modulator) show the waveform as a small
  glyph; SCALE (QUANT, STAGES) shows its 12 semitones from the root as a strip (scale degrees tall, the rest
  short). The cell shows the current value's glyph; the list shows glyph and name for every value. SLOPE's SHP knob shows its rise curve (log … lin … exp, modulation included) in place
  of a number.

## 5. Groups (frames)

- A group is a **frame**: a rectangle of its own with a translucent fill and a 28 px header strip carrying the name
  (`GROUP 1`, `GROUP 2`…; double-click to rename), the frame tools and the clock controls. The frame tools (tint, STACK, FIX, SAVE, M) show while the header is hovered, and stay visible
  while FIX or M is on. Drag an edge or corner to resize (minimum 352 × 96);
  drag the header to move the frame and everything inside it; click the header to select it.
- **Membership is containment.** Every module and frame has a `parent` (a frame or none): the innermost frame that
  contains its centre, never itself or one of its descendants. It is recomputed only for what an action touched:
  a move re-parents the moved objects (dropping into a frame attaches, dragging out detaches) — a moved frame never
  captures what it lands on; a resize re-parents everything (growing a frame over an object attaches it); an added,
  duplicated or ⌘G-framed object gets its parent on creation. Frames nest to any depth.
- While a module or frame is dragged, the frame it would land in is highlighted.
- **G** (or ⌘G) wraps the selection in a new frame fitted around it (16 px padding, header above), nested in the
  selection's innermost common parent. **G** on a selection of frames only (or ⇧⌘G) removes them; their children move to their parent.
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
- The header shows a small level meter: the peak of what leaves the frame (its outgoing audio cables and OUT
  modules inside it), held and falling over 300 ms.
- **Frame tools** in the header:
  - **Tint** (a small swatch): click cycles the fill through neutral (≈ 4 % white) and six muted hues (≈ 8 %).
    Nested frames layer, so the hierarchy reads without extra lines.
  - **STACK:** packs the frame's direct children (modules, and child frames as single blocks) flush inside 16 px
    padding, in the **same rows as WIRE FIX** (children in reading order: rows by position, then x; row breaks
    chosen as WIRE FIX would, at about 1.6 × the side of a square of the children's area, at least the widest
    child), rows top-aligned. STACK turns WIRE FIX off (a routed frame needs its channels). Switching STACK ↔ FIX
    keeps every child in its row and order; pressing either again changes nothing. One action, one undo step.
  - After STACK or FIX the frame fits its content: the same margin on all four sides (16 px or 32 px).
  - **WIRE FIX** (button `FIX`): a frame mode (`layout: 'route'`), toggled, **on by default** — ⌘G frames and
    factory frames start packed in rows with routed wires (innermost frames first). A WIRE FIX frame manages its own layout: its direct children
    sit in strict rows in reading order with 32 px channels between rows, between neighbours, and as padding (the
    left padding is a trunk). Anything dropped into, moved within or taken out of it re-packs it, so the channels
    always run through. Cables between two direct children are drawn orthogonally and never cross a module. A cable to
    the next module to the right in the same row goes straight through the gap between them (one step at mid-gap if
    the jacks are at different heights). Any other cable goes out of
    the source into the channel on its right, up into the channel above its row, along the trunk to the channel
    above the target's row (same row: straight across), down the channel on the target's left into the jack (a
    knob's mod jack: straight down from the channel above) — rounded corners, one 4 px lane per cable. Turning WIRE FIX
    off returns to curves and keeps the layout.
  - **MUTE (M):** the frame fades out over 50 ms: cables leaving the frame and OUT modules inside it go silent; clocks
    and everything inside keep running, so the voice comes back in time. A cable is silenced by the innermost
    frame that holds its source but not its target, when that frame or one of its parents is muted. Its contents are drawn at 40 % (its own
    header stays as is). Muting a frame mutes its children.

## 5a. Sidebar and the WIRES editor

- **Sidebar:** a panel docked on the right, hidden by default (W or the SIDEBAR button opens and closes it; Esc closes
  it). It does not cover the canvas: the canvas, the top-right buttons, the zoom control and the hint line end at its
  edge. It opens at a fixed width (440 px) with every new window and every opened project; within a session its
  left edge can be dragged (320 px … 70 % of the window). A tab row at its top holds its functions; the first and,
  for now, only one is WIRES.
- **WIRES** — the patch seen through its wires: to understand it, set depths, rewire and find problems.

- **Sections**, each collapsible with a wire count:
  - one per frame (nested frames as indented subsections, `POLY › VOICE A`): the wires whose ends are both inside
    it, each listed under the innermost frame holding both ends;
  - **UNGROUPED**: wires between modules that are in no frame;
  - **BETWEEN GROUPS**: wires that cross a frame's border — how the parts of the patch talk to each other;
  - **PROBLEMS**: sound that reaches no OUT; a processor with its sound input empty (FILTER, LPG, FOLD, DELAY,
    FOLLOW, OUT's L — optional inputs such as SLOPE's IN are not problems); a RHYTHM with no clock. Listed dimmed as
    information: feedback loops and muted frames. Clicking a problem selects that module and frames it in view.
- **A wire row:** `SOURCE › PORT  →  DEST › PORT   value   ✕`, a role-coloured dot at each end (two colours for a
  cross-role wire). The value is the destination's attenuverter or ratio, dragged, wheeled and reset exactly as on
  the module. Modules of the same type are numbered (`SLOPE 1`, `SLOPE 2`) everywhere names are shown.
  - Clicking a port name opens a list of ports (same role first, with a filter) and moves that end of the wire —
    across the whole canvas if needed. ✕ removes the wire. `+ new wire` (under BETWEEN GROUPS) picks an output,
    then an input.
  - Normals are listed dimmed in their module's section (`STAGES › ADV  ← STAGE TIMER (normal)`): visible, not
    removable.
- **Linked to the canvas:** hovering a row highlights that wire on the canvas exactly like hovering the wire, and
  outlines both its modules in amber (hovering a wire on the canvas outlines its modules too); a row picked with a
  click or ↑ / ↓ keeps its wire lit and its modules outlined after the pointer leaves. Moving the pointer over the
  sidebar never looks for wires on the canvas underneath. In the port list —
  moving an end, or `+ new wire` — the port under the pointer (or picked with ↑ / ↓) gets an amber ring on the
  canvas and its module an amber outline; once one end is fixed, a dashed amber preview wire runs from it to that
  candidate, so you see where the wire will land before you click.
  If that candidate (or a wire row picked with ↑ / ↓) is outside the visible part of the canvas — the part not
  covered by the sidebar — and stays the candidate for 250 ms, the view glides (220 ms, ease-out) to centre its module;
  zoom is unchanged.
  Selecting a module or frame on the canvas highlights its rows and scrolls the first into view; **SELECTION**
  keeps only the wires touching the selection; the filter field matches module and port names.
- **Keys** while it is open: ↑ / ↓ move between wire rows, Backspace removes the selected wire, Enter opens the port
  list for its input end.

## 6. Session, library and factory patches

- The current canvas autosaves to IndexedDB 500 ms after the last edit. Opening the app resumes it; the very first
  launch opens the factory project *Pulse*, so there is sound after one click.
- Audio starts on the first click anywhere (browser autoplay rule); until then a single line reads
  `CLICK TO START AUDIO`.
- Top right: **SIDEBAR** (opens the sidebar, §5a; its first tab is WIRES), **SAVE** (saves the project, as ⌘S with no frame selected) and **NEW** (clears the
  canvas; an undo step). With the listen bar these are the only chrome.
- **Library = a folder on disk.** The first save or open asks for a library folder once (a folder dialog; the
  main process keeps its path in the app's settings and reads and writes it with Node `fs`, §8). Inside it:
  `groups/**/<name>.sreda-group.json` and `projects/**/<name>.sreda.json`; any subfolders made in the Finder show up
  as path prefixes. Files are the document JSON (`version`, `modules`, `cables`, `groups`); a group file holds one
  top frame with everything inside it.
- **Save:** a frame's header has a SAVE tool, and ⌘S with exactly one frame selected does the same: it saves that group — a name field appears (`acid/303 voice`: a slash
  makes subfolders); it stores the frame, everything inside it, the cables between those, its clock and tint, not
  cables from outside. ⌘S with anything else saves the project (straight away if it already has a name, else a
  name field); ⇧⌘S is save-as. The project's path shows next to SREDA at the top left, with `●` while there are
  unsaved changes. Factory entries are read-only: saving one asks for a new name.
- **One picker** for modules, groups and projects: the module search (§4) gets tabs ALL · MODULES · GROUPS ·
  PROJECTS (Tab / ⇧Tab cycle, a click picks); typing searches names and folders in the current tab; each row shows
  its folder and kind. **/** (or a double-click on empty canvas) opens it at the pointer on ALL; ⌘O opens it on
  PROJECTS in the middle of the screen. No single-letter keys for tabs (G is taken by frames). Opened from a jack, it
  offers modules and groups (no projects); in REPLACE mode, modules only.
  - A **group** lands with its frame's top-left at the drop point, with fresh ids; opened from a trigger output, the
    cable goes into the group's CLK in (from any other jack the group lands unwired).
  - A **project** replaces the canvas (one undo step) and fits it in view.
- **FACTORY** (read-only, shipped with the app, listed under `FACTORY/`): projects — the ones below — and groups —
  *303 voice* (the ACID voice without delay and out, own clock 128 BPM), *complex vco* (COMPLEX → FOLD → LPG pinged
  by a cycling SLOPE, UNCERTAINTY on the fold), *bleep-bloop* (own clock 120 BPM at ×4 → CHANCE → UNCERTAINTY
  quantised → QUANT → OSC → LPG), *vca-lpg* (two LPGs: the first in VCA mode with a SLOPE on its level, the second pinged; CLK in fires both).
- Factory projects are built only from the first modules and fade in over 200 ms:
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
  - **Acid:** a frame ACID with its own clock at 128 BPM; RHYTHM (GRID `x.x-..x.x.xx-.x.`: `-` is a TIE; accents on 12 and 15) at
    ×4 on its CLK; GATE advances STAGES (16 notes in C minor with four slides; pitch moves only on notes, as on a
    TB-303) and
    fires the filter and amp SLOPEs; ACC fires a third SLOPE stacked on the same CUTOFF mod jack; STAGES → OSC (saw)
    → FILTER (LP, high res) → LPG in VCA mode → DELAY → OUT.

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
| | **LPG** — low-pass gate and VCA in one | in (audio), cv (mod), ping (trigger) | level, decay (vactrol-like), mode VCA/LP/BOTH | out (audio) | cv ← the ping envelope while PING is patched, else 1 (so with nothing patched LPG is a plain VCA on LEVEL) |
| | **FILTER** — state-variable, all outputs at once | in (audio) | cutoff, res | lp, bp, hp (audio) | — |
| | **FOLD** | in (audio) | fold, symmetry | out (audio) | — |
| Time & logic | **STAGES** — Buchla 248 style, generative, drawn as a contour | adv (trigger), reset (trigger), addr (mod: 0…1 picks a stage), dice (trigger) | per stage 1–16 (in the contour, not as knobs): voltage, time, pulse ON/OFF, slide (80 ms into the stage); LEN 1–16; GEN 303/MOTIF/WALK/TURING/ARP/PHRASE/PEDAL; SCALE; ROOT; DICE button | cv (mod bi), pulse (trigger), eoc (trigger) | adv ← internal stage timer (advances when the stage's time is up) |
| | **RHYTHM** — 16-step rhythm sequencer, generative, drawn as pads | clk (trigger), reset (trigger), dice (trigger) | 16 steps OFF / ON / TIE, 16 accent steps; LEN 1–16, HITS 0–16, ROT 0–15, DENS 1–16; MODE EUCLID/GRID; DICE button | gate (trigger), acc (trigger), eoc (trigger) | — |
| | **CHANCE** — Bernoulli gate | trig (trigger) | P (0…1) | a, b (trigger): each event goes to A with probability P, else to B | — |
| | **SHIFT** | trig (trigger) | AMT (0…1 of the measured period), WHICH ALL/EVEN (EVEN = swing) | out (trigger) | — |
| | **COMPARE** | in (audio) | threshold | out (trigger) | — |
| | **FOLLOW** — envelope follower | in (audio) | ATK, REL, GAIN, THR | env (mod uni), gate (trigger: env above THR) | — |
| | **SWITCH** — sequential switch 4 → 1 | in1–in4 (audio), adv (trigger), reset (trigger), addr (mod) | LEN 2–4, MODE SEQ/RAND | out (audio) | — |
| | **SPREAD** — sequential switch 1 → 4 | in (audio), adv (trigger), reset (trigger), addr (mod) | LEN 2–4, MODE SEQ/RAND | out1–out4 (audio) | — |
| | **S&H** | in (audio), trig (trigger) | — | out (mod bi) | in ← internal noise |
| | **QUANT** | in (pitch) | scale, root | out (pitch) | — |
| Mix & math | **MIX** | a, b, c, d (audio) | level a–d | out (audio) | — |
| | **ATT** — Quadratt style, 4 channels | in1–in4 (audio) | per channel: attenuverter, offset | out1–out4 (mod bi) | inN ← +1; an unpatched outN adds into out(N+1) |
| | **A×B+C** — Befaco style, 2 channels | a1, b1, c1, a2, b2, c2 (audio) | per channel: A gain, B gain (attenuverters), C offset | out1, out2 (audio) | bN ← +1; c2 ← out1, while out1 is unpatched |
| FX & out | **DELAY** | in (audio) | time, feedback, mix | out (audio) | — |
| | **SCOPE** — with thru, like a Mordax DATA | a, b (audio), trig (trigger) | time (1 ms–10 s per screen), gain a, gain b, mode A·B / XY | thruA, thruB (audio: the inputs unchanged; gains affect the display only) | — |
| | **OUT** | l, r (audio) | level | — | r ← l |

- Sizes (HP × U): OSC 5×1, COMPLEX 6×1, NOISE 3×1, UNCERTAINTY 4×1, SLOPE 5×1, LPG 4×1, FILTER 4×1, FOLD 4×1,
  STAGES 10×3, RHYTHM 10×2, CHANCE 3×1, SHIFT 3×1, COMPARE 3×1, FOLLOW 6×1, SWITCH 4×2, SPREAD 4×2, S&H 2×1, QUANT 3×1,
  MIX 4×2, ATT 6×2, A×B+C 5×2, DELAY 5×1, SCOPE 6×2, OUT 3×1 (24 modules).
- Displays in lanes: STAGES' contour 8 (then LEN and ROOT, then GEN ▾ · SCALE ▾ · DICE), RHYTHM's pads 4 (then LEN,
  HITS, ROT, DENS, then MODE · DICE), SCOPE 4 (then TIME, GA, GB, then MODE).
- **STAGES panel = a contour.** A display shows the LEN stages as one line: a step's height is its note (named above
  it), a sloped joint is a slide, dots along the bottom are pulses, the current stage is amber. While ADV is
  unpatched (free-running on its own timer) step widths follow stage times; while ADV is patched (timed from
  outside) all steps are equal width. Gestures: press and drag inside the display draws notes — each step under the
  pointer takes the pointer's height, snapped to the nearest degree of SCALE from ROOT (one undo step per stroke);
  click a joint toggles the slide into the next stage; drag a joint sideways changes the stage time (free-running
  only); click a dot toggles that stage's pulse. The per-stage values are params without knobs or mod jacks; R leaves
  them alone (DICE generates them).
- **RHYTHM panel = 16 pads** in two rows of eight with an accent strip under each: click a pad cycles OFF → ON →
  TIE, click the strip toggles the accent; the current step has an amber ring. A TIE pad is drawn as the
  continuation of the pad before it (a bridge to its left, a slightly darker tone).
- **Rests and ties.** An OFF step is a rest: no GATE, so nothing downstream fires and STAGES (on ADV) keeps its note.
  A TIE step continues a sounding step: GATE simply stays high into it — no new rise, so envelopes do not retrigger
  and STAGES does not advance (the note is held, as a TB-303 tie); an accent on a TIE is ignored. A TIE after a rest
  plays like ON. In STAGES a stage with its pulse off is a rest for patches voiced from PULSE; the contour shades
  it (hatched) so rests read at a glance.
- **RHYTHM:** in EUCLID the pattern is computed live from LEN, HITS and ROT (all modulatable) and the pads show it
  dashed; touching a pad turns the current euclid pattern into a grid (MODE → GRID) and toggles that pad. Pads
  past LEN are dimmed. Each clock rise advances one step; a hit raises GATE for half the last clock interval; an
  accented hit also fires ACC (§ rests and ties for TIE).
- **DICE** (button, or a rise on the DICE input): STAGES writes a line from GEN in its SCALE and ROOT into its 16
  voltages (v = (semitone − 12) / 12, so 0…24 semitones span −1…+1), with slides for 303 / MOTIF; RHYTHM writes
  303-style gates (DENS hits, euclid-spread, random rotation), long notes (a note holds into the rest after it as
  a TIE, with the old SREDA's DENS-dependent odds) and accents (30 % of hits), and switches to GRID. The
  generators are ported from the old SREDA (`../sreda/design/mockup/reference-js/seqgen.js`, `sgDice`), with the RNG
  passed in. The button is an undo step; the input changes the patch without one.
- Action cells (DICE) are buttons on the face; they hold no value.
- SCOPE syncs its sweep on a TRIG rise when TRIG is patched, else on A's rising zero crossing, else runs free.

- Several OUT modules sum. After them the master stage is fixed: 5 Hz DC blocker, soft limiter, nothing non-finite
  reaches the device.

## 7a. Second milestone: the sound pack

Built right after the first build, with its own plan. Same panel grammar (§2); board *Sound pack* in the prototype.
Stereo outputs are two mono outputs (cables stay mono).

| Module | Size | Inputs | Knobs | Mode strip | Outputs |
|---|---|---|---|---|---|
| **FILTER** (upgrade) | 5×1 | in (audio), pitch (pitch: tracks the cutoff; COMB's tuning) | CUT, RES, DRV (gain into the nonlinear models) | MODEL ▾ SVF / LADDER / DIODE / SK / COMB / VOWEL, drawn as a response glyph | lp, bp, hp |
| **DRIVE** | 5×1 | in (audio) | GAIN (to +24 dB), TONE, MIX | MODE ▾ SAT / OD / FUZZ | out |
| **DELAY** (upgrade) | 6×1 | in (audio), clk (trigger) | TIME, FB, MIX, CHAR | TYPE ▾ DIGI / TAPE / SPRING · PING | l, r |
| **REVERB** | 6×2, display 2 lanes | in (audio) | SIZE, DECAY, DAMP, PRE, MOD, MIX | TYPE ▾ ROOM / PLATE / HALL · FREEZE | l, r |
| **SAMPLER** | 8×2 | trig (trigger), pitch (pitch), slice (mod), start (mod) | PITCH (±24 st), START, LEN, DEC, LVL, SLICES (2–64; SENS while AUTO) | MODE ▾ ONE / LOOP / SLICE · REV · AUTO · LOAD (right) | l, r, eoc (trigger) |
| **GRAINS** | 10×2 | trig (trigger), in (audio), pos (mod), pitch (pitch) | POS, SIZE (5 ms…1 s), DENS (1–200 /s), SPRAY, PITCH, DETUNE, REV %, SPREAD | SOURCE ▾ FILE / LIVE · FREEZE · LOAD (right) | l, r |

- **FILTER models.** One module, so changing MODEL never breaks cables; each model fills LP / BP / HP with its own
  responses: SVF 12 dB; LADDER 24 dB lowpass with 2-pole band and the complementary highpass; DIODE the 18 dB TB-303
  ladder; SK the MS-20's Sallen-Key pair; COMB tuned by CUT + PITCH, LP = positive feedback, BP = negative, HP = comb
  minus dry; VOWEL formants morphing A-E-I-O-U on CUT, LP = all formants, BP = the first, HP = the upper ones.
  DRV drives the nonlinear models (ADAA, 2× oversampling); NOTCH is dropped (four outputs do not fit 1U).
- **DRIVE:** SAT a soft tape-like curve, OD an asymmetric tube-like one, FUZZ a hard clip with bias; TONE a tilt EQ
  after the curve; output level compensated so GAIN changes character more than loudness; ADAA, 2× oversampling.
- **DELAY types:** DIGI clean, CHAR = bit depth and sample-rate reduction; TAPE wow and flutter, saturation and
  high-frequency loss on every repeat, CHAR = wear; SPRING a dispersive allpass chain (the chirp), CHAR = drip.
  PING alternates repeats between L and R. With CLK patched, TIME snaps to divisions of its period (1/16 … 4).
- **REVERB types:** ROOM a small FDN, HALL a large FDN with longer pre-delay and diffusion, PLATE a Dattorro plate;
  MOD slowly modulates the delay lines; FREEZE holds the tail forever (input muted, feedback 1).
- **REVERB's display — the room** (Elektron-style): a wireframe shape for TYPE (ROOM a cube, HALL a wide deep box,
  PLATE a flat slab) sized by SIZE, filling with the tail's live level and settling at DECAY; DAMP darkens the top of
  the fill (the highs going first); PRE is the dashed line from the input dot to the wall; FREEZE turns the outline
  amber and holds the level. It fills the two lanes the knobs leave free — the grammar is unchanged.
- **SAMPLER modes.** ONE: TRIG plays START…LEN with DEC as an amplitude decay (full = off); up to 4 overlapping
  voices, a new trigger never cuts the last, the oldest is stolen. LOOP: TRIG restarts; it loops START…LEN. SLICE:
  the region is cut into SLICES equal slices, or by detected hits with AUTO (SENS = threshold); each TRIG plays the
  next slice, or the one SLICE picks when patched — a break follows its clock by re-triggering, pitch independent.
  REV plays backwards. 1 ms fades at every boundary. EOC fires at the end of a play-through or slice. Its display
  shows the waveform, START / LEN markers (ONE / LOOP) or slice markers (SLICE), the playhead in amber and the file
  name; clicking the waveform or LOAD opens the picker on SAMPLES for this module.
- **GRAINS.** Grains (Hann window, up to 64 at once) spawn on TRIG rises, or at DENS per second when TRIG is
  unpatched; each reads from POS (± SPRAY), lasts SIZE, plays at PITCH (± DETUNE), reversed with probability REV %,
  panned within SPREAD. SOURCE FILE reads a library sample; LIVE records IN into an 8-second ring buffer, and FREEZE
  stops the recording so the frozen piece of the patch can be explored. The display shows the source waveform,
  POS and the live grains as amber dots; while LIVE, the region being written is shaded.
- **Samples as a system.**
  - Files live in the library folder under `samples/**`: WAV, AIFF, FLAC, MP3, OGG. A module stores the sample's
    library path; on load the UI reads the file (IPC), decodes and resamples it to the engine's rate, and hands the
    channels to the engine, which keeps them in a sample pool by id. Hit detection for AUTO runs once per load.
  - The picker gains a SAMPLES tab and key **S**; moving through samples with ↑ / ↓ auditions each one through the
    listen path.
  - An audio file dropped on the canvas is copied into `samples/` and opens a SAMPLER with it; dropped on a SAMPLER
    or GRAINS it replaces their sample.
  - A missing file shows `MISSING · <name>` on the display, outputs silence, and is listed under PROBLEMS in WIRES.
  - Saved groups and projects reference samples by path; they do not copy audio.
- **Engine additions:** a sample pool (memory sized on load, not in `process`); per-module voices and grain pools
  allocated on construction; the plan carries a module's sample id in its fixed values.

## 8. Technology and architecture

Decided 2026-10-07 for one user on one Mac.

- **Platform: Electron** (macOS). The main process owns the window, the library folder (Node `fs`, reached from the
  renderer over IPC: list, read, write), and sets COOP/COEP so the renderer is cross-origin isolated
  (SharedArrayBuffer). MIDI and controllers come later through Web MIDI, which Electron's Chromium has.
- **Languages.** **Rust** for the engine and the DSP of every module, built to **WASM** and run inside an
  AudioWorklet in the renderer; each module's spec (ports, params, ranges, tapers, `randomRange`, `modDepth`,
  normals, size, display) lives next to its DSP in Rust and is exported to `specs.json` for TypeScript.
  **TypeScript** for the document, edits, frames, undo, `compile` (document → plan) and the UI. The boundary is the
  plan (JSON) and a small set of messages. The same Rust crate builds natively for its tests, and could later run as
  a native audio engine (Rust + cpal) for lower latency and more outputs without rewriting DSP.
- **Packages:** `core` (TS: document, edits, frames, undo, compile, panel layout; specs from the generated
  `specs.json`), `protocol` (TS: plan wire format, messages, readout layout, the WASM engine loader), `ui`
  (SolidJS), `app` (Electron main and preload, renderer entry; electron-vite), `engine/` (Rust crate:
  engine, modules, specs; `export-specs` binary). Boundaries `core ← protocol`, `core ← ui`, `protocol ← ui`; the UI
  never touches engine internals, only messages.
- **The document** is immutable JSON:
  `modules: { id, type, x, y, parent, params, atts, ratios }[]` (`atts` and `ratios` keyed by input port id, mod jacks
  as `@param`), `cables: { from: [id, port], to: [id, port] }[]`,
  `groups: { id, name, x, y, w, h, parent, ratio, tint, layout: 'free' | 'route', muted, clock: { on, bpm } }[]`.
  A group's jacks are `[groupId, 'clkIn']` and `[groupId, 'clkOut']`. Edits are pure functions returning a new
  document; undo is a history of documents grouped per gesture. `compile` resolves normals into ordinary bindings,
  compiles each group into a hidden clock node, marks muted bindings, orders the graph and lays out the readouts.
- **The engine** (Rust, in the AudioWorklet): the worklet glue (a few lines of TS) receives the WASM module compiled
  on the main thread, forwards messages, calls `process` per block and copies the readouts into a SharedArrayBuffer
  the UI reads once per frame. Cycles are allowed: a cycle's back edge is read one sample late, and only the nodes of
  a cycle run per sample. The engine prepares every input before a module runs (sums stacked cables and applies the
  attenuverter, or merges, ratios and re-emits 1 ms triggers), so DSP code sees one clean buffer per input. A knob,
  attenuverter, ratio, mute or listen change is a message; a module, cable or group change sends a new plan. Removed
  modules and re-routed inputs fade over 10 ms; a mute ramps over 50 ms.
- **Sound:** the device's sample rate (44.1 / 48 / 96 kHz; every module works at any); blocks of 128; f32 buffers,
  f64 state (filters, phases, envelopes); polyBLEP oscillators; nonlinear stages (FOLD, COMPLEX's timbre, DRIVE
  later) use first-order ADAA with 2× oversampling; a tiny offset keeps filters and feedback paths out of denormals
  (WASM has no flush-to-zero); knob changes glide 10 ms.
- **UI:** SolidJS. Modules are DOM elements on a layer panned and zoomed by a CSS transform; cables are one SVG
  layer, and only the paths of wires touching moved modules are recomputed. Each new document is applied to the
  Solid store with `reconcile`, so an edit re-renders only what changed. Everything that moves every frame (flashes,
  levels, modulation dots, SCOPE, contour, pads) bypasses Solid: one `requestAnimationFrame` loop reads the readout
  buffer and writes the registered elements' styles directly. Sized for patches of 50–200 modules.

## 9. Errors and safety

- Every module guards against NaN: it outputs 0 and resets its state.
- The master stage (§7) is always on, for the main output and the listen path alike.
- A corrupt autosave is kept under a backup key, a seed opens instead, and a one-line notice says so.

## 10. Testing

- **core (Vitest):** edits (stacking, frames and parent recomputation), undo grouping, compile including cycles,
  normals and group clocks; every module spec fits its size under the panel grammar.
- **engine (cargo test, native):** each module's DSP is deterministic with a seeded RNG; trigger detection, merging
  and ratios; attenuverters; a DSP gives the same samples per block or per sample; no allocation inside `process`
  (a counting global allocator); a real-time budget benchmark.
- **end to end (Vitest + the WASM engine in Node):** TypeScript compiles factory patches and the WASM engine renders
  them; `pnpm render <name>` writes a WAV to listen to.
- **ui:** component tests (Solid testing library, happy-dom).
- **e2e (Playwright driving Electron):** drag from a jack → search → placed and wired; stack two cables on one input; click to listen
  and back; R randomises and undo restores; box-select by dragging; magnets snap flush; ⌘G frames the selection,
  own clock ticks, CLK out drives a member, a nested frame inherits its parent's clock at ÷2; dragging a module out
  of a frame detaches it; STACK packs a frame; WIRE FIX draws orthogonal cables; MUTE silences a frame's outgoing
  cables; replace keeps matching cables and knob values; dropping a free module on a cable inserts it; NEW clears and
  undo restores; reload resumes the canvas; ⌘S saves a frame as a group and the picker places it twice with fresh
  ids; ⌘S / ⌘O round-trip a project through the library folder; WIRES lists a frame's wires under it, rewires
  an end from the port list, and shows a FILTER with an empty input under PROBLEMS.
