# SREDA 2 — canvas UX/UI design

Date: 2026-10-07 · Revision 39 (§7c: the CLOCK module) · Status: approved

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
- Dark panels with thin borders, soft shadows only on floating things (§1b), no gradients or hardware imitation.
  UI text is English.
- Colours come from the active **skin** (§1a); the first build has one, DEFAULT: background `#121210`, panel
  `#1b1b18`, text `#e9e4d8`, muted `#8f897c`, destructive `#e5484d`; port roles: audio `#e9e4d8`, mod `#6cb4ee`,
  pitch `#9ad18b`, trigger `#f5a524`.
- **Colour means role, everywhere.** Jacks are drawn in their port's role colour, and the role is how an input reads
  the stream (§3). A cable between two ports of the same role is that role's colour. A cable joining two different
  roles (an LFO into an audio FM input, an envelope into a trigger input) changes colour along its length: the
  source's colour for the first ~40 %, a blend in the middle, the input's colour for the last ~40 %. Ghost cables
  (normals) use the same rule, dashed.

## 1a. Skins

A **skin** is one full set of the colour tokens below. Every colour in the UI (canvas, panels, displays, cables,
frames, sidebar, picker) comes from a token; no component keeps a colour of its own. Skins change colour only:
geometry, type (IBM Plex Mono and Sans, §1b), the panel grammar and the meaning of colour (role = colour, §1) are the same in
every skin. A document does not store a skin, and a frame's tint is stored as an index (0 neutral, 1–6 hues), so a
patch looks right in any skin.

**Choosing a skin** (revision 22): the sidebar's SETTINGS tab (§5a) lists the skins (seven since revision 38), each
row its name and a strip of swatches (`ground`, `panel`, `text` and the four role colours). Hovering a row tries the skin on the whole
app; a click chooses it; leaving the list without a click returns to the chosen one. The skin is app-wide, kept in
`<userData>/settings.json` beside the library folder, never in a document; a new install starts on DEFAULT. Candidates
were compared on one small patch: https://claude.ai/artifact/U5d9RCXf13k7nkraC3VGgq.

| Token | Used for | DEFAULT | ANNABIOSIS | KANAGAWA | TOUCH | NORD | TOKYO NIGHT | ORCA |
|---|---|---|---|---|---|---|---|---|
| `ground` | canvas background, display insets, jack centres | `#121210` | `#18211f` | `#1f1f28` | `#1c1c1c` | `#2e3440` | `#1a1b26` | `#000000` |
| `dot` | canvas grid dots | `#24231f` | `#273533` | `#2a2a37` | `#2a2a2a` | `#3b4252` | `#24283b` | `#222222` |
| `panel` | module and frame-header body, sidebar, picker, menus | `#1b1b18` | `#212d2b` | `#2a2a37` | `#333333` | `#3b4252` | `#24283b` | `#111111` |
| `panel-side` | a module's port columns | `#171715` | `#1c2725` | `#252530` | `#2d2d2d` | `#353c4a` | `#1f2231` | `#0b0b0b` |
| `raised` | hover fill, field hover, off pads, panel heads | `#2a2924` | `#283735` | `#363646` | `#444444` | `#434c5e` | `#292e42` | `#1f1f1f` |
| `line` | inner borders, dividers | `#2e2d28` | `#344543` | `#363646` | `#444444` | `#434c5e` | `#343a55` | `#262626` |
| `line-2` | panel and button borders | `#3a3933` | `#465957` | `#54546d` | `#575757` | `#4c566a` | `#414868` | `#3a3a3a` |
| `text` | values, names, active text | `#e9e4d8` | `#d4ddd7` | `#dcd7ba` | `#e0e0e0` | `#eceff4` | `#c0caf5` | `#ffffff` |
| `text-2` | frame names, ties | `#b9b3a6` | `#b3c2bc` | `#c8c093` | `#c4c4c4` | `#e5e9f0` | `#a9b1d6` | `#cccccc` |
| `muted` | secondary text, hints, selected outline | `#8f897c` | `#8fa29d` | `#a6a69c` | `#a0a0a0` | `#d8dee9` | `#737aa2` | `#9a9a9a` |
| `quiet` | quiet secondary marks (revision 35: port and knob labels moved to `label`, §1b) | `#6f6a5f` | `#6f827d` | `#727169` | `#7a7a7a` | `#8a93a5` | `#565f89` | `#777777` |
| `faint` | default-valued fields, off glyph parts | `#5d594f` | `#5c6f6b` | `#54546d` | `#5e5e5e` | `#616e88` | `#3b4261` | `#555555` |
| `heading` | module names, section heads | = `text` | `#42fea2` | = `text` | = `text` | = `text` | = `text` | = `text` |
| `on` | a pressed toggle, the current menu item, a picked row | `#e9e4d8` | `#0c7970` | `#2d4f67` | `#5a5a5a` | `#5e81ac` | `#3d59a1` | `#ffffff` |
| `on-text` | text on `on` | `#121210` | `#eafff5` | `#dcd7ba` | `#ffffff` | `#eceff4` | `#c0caf5` | `#000000` |
| `accent` | "where we are now" and focus: current step, hover outlines, guides, BPM, LISTEN flash | `#f5a524` | `#42fea2` | `#e6c384` | `#e8c547` | `#ebcb8b` | `#ff9e64` | `#ffffff` |
| `destructive` | delete, problems | `#e5484d` | `#db3323` | `#e82424` | `#e5484d` | `#bf616a` | `#db4b4b` | `#e5484d` |
| `role-audio` | audio jacks and cables | `#e9e4d8` | `#30da98` | `#7fb4ca` | `#63b35b` | `#88c0d0` | `#7dcfff` | `#ffffff` |
| `role-mod` | mod jacks and cables, modulated values | `#6cb4ee` | `#1e7fff` | `#957fb8` | `#8e5fc7` | `#b48ead` | `#bb9af7` | `#7a7a7a` |
| `role-pitch` | pitch jacks and cables | `#9ad18b` | `#fcdd14` | `#98bb6c` | `#4f8fd6` | `#a3be8c` | `#9ece6a` | `#a6a6a6` |
| `role-trigger` | trigger / gate jacks and cables | `#f5a524` | `#ff5230` | `#ff9e3b` | `#d0508f` | `#d08770` | `#f7768e` | `#d0d0d0` |

Frame tints (index 0 is neutral; fills: tint 0 at ≈ 4 %, hues at ≈ 8 %):

| Tint | DEFAULT | ANNABIOSIS | KANAGAWA | TOUCH | NORD | TOKYO NIGHT | ORCA |
|---|---|---|---|---|---|---|---|
| 0 neutral | `#8f897c` | `#8fa29d` | `#727169` | `#7a7a7a` | `#4c566a` | `#565f89` | `#5a5a5a` |
| 1 red | `#d97757` | `#d8a08b` | `#e46876` | `#d0508f` | `#bf616a` | `#f7768e` | `#6e6e6e` |
| 2 yellow | `#d8b25e` | `#d7ce82` | `#e6c384` | `#e8c547` | `#ebcb8b` | `#e0af68` | `#888888` |
| 3 green | `#8fbf80` | `#aac699` | `#98bb6c` | `#63b35b` | `#a3be8c` | `#9ece6a` | `#a2a2a2` |
| 4 teal | `#62b3a8` | `#9ad9b0` | `#7aa89f` | `#4fb3b0` | `#8fbcbb` | `#73daca` | `#bcbcbc` |
| 5 blue | `#6cb4ee` | `#8eafcf` | `#7e9cd8` | `#4f8fd6` | `#81a1c1` | `#7aa2f7` | `#d6d6d6` |
| 6 violet | `#b98ad0` | `#d89bc9` | `#957fb8` | `#8e5fc7` | `#b48ead` | `#bb9af7` | `#f0f0f0` |

- **DEFAULT** is the look the first build was designed in: warm near-black panels, a cream text colour that is
  also the audio role, amber for "now" and for triggers.
- **ANNABIOSIS** (named by the user, 2026-10-08) is a cool dark-teal look: slate-green panels, mint caps headings,
  selections filled with deep teal rather than inverted, saturated role colours. Its hues come from the palette
  below; the neutrals (`ground` … `faint`, `on-text`) were chosen to match a reference screenshot and are not part
  of the palette. Its `accent` shares a hue with `role-audio` (as DEFAULT's accent shares one with
  `role-trigger`). A static redraw of the canvas in it: https://claude.ai/artifact/419hmh888ncxtjU6PFCR2g.
- **KANAGAWA** (after the kanagawa.nvim "wave" palette): ink-blue night, parchment text, muted woodblock hues; calm
  and very readable.
- **TOUCH** (after TouchDesigner's network editor; hues approximate): flat grey modules on charcoal, roles coloured
  like operator families (audio = CHOP green, mod = TOP violet, pitch = SOP blue, trigger = DAT pink), yellow "now".
- **NORD** (after nordtheme.com): arctic blue-grey, frost blue audio, pastel aurora hues for the other roles.
- **TOKYO NIGHT** (after tokyonight.nvim "night"): deep navy, periwinkle text, near-neon cyan / violet / green / pink.
- **ORCA** (revision 38, after Hundred Rabbits' Orca; its `#fff` / `#777` / `#444` greys): pure black, white
  text, no hue anywhere but `destructive` (`#e5484d`, so problems still read as problems). Roles are told apart by
  brightness, stepping down by ≈ 1.5–1.75 × in contrast: audio white, trigger `#d0d0d0`, pitch `#a6a6a6`, mod
  `#7a7a7a` (the dimmest, so many mod cables stay calm; ≈ 4.4 : 1 on `panel`, so modulated values still read). `on`
  and `accent` are white, `on-text` black: a pick is an inverted block, as Orca's cursor. Frame tints are a grey
  ladder (the index keeps its meaning; the hue names do not apply).
- Where a source palette has no value for a token (`panel-side`, `quiet`, `faint`, `on` …) it was chosen to fit.

The ANNABIOSIS palette: seven hues, each a pastel and five steps from bright to dark (swatch ground `#c5c6b8`).

| Hue | pastel | 1 | 2 | 3 | 4 | 5 |
|---|---|---|---|---|---|---|
| mint | `#9ad9b0` | `#42fea2` | `#30da98` | `#21b68b` | `#15937b` | `#0c7970` |
| magenta | `#d89bc9` | `#fe42eb` | `#da30c1` | `#b6219b` | `#931578` | `#780c5e` |
| green | `#aac699` | `#74c45a` | `#53a841` | `#378d2d` | `#1f711c` | `#115e14` |
| blue | `#8eafcf` | `#1e7fff` | `#1562db` | `#0f49b7` | `#093393` | `#05237a` |
| yellow | `#d7ce82` | `#fcdd14` | `#d8ba0e` | `#b5990a` | `#927906` | `#786203` |
| red | `#d8a08b` | `#ff5230` | `#db3323` | `#b71918` | `#930f18` | `#7a0919` |
| violet | `#c6bccd` | `#c9a6fa` | `#b583fc` | `#a260ff` | `#8f40ff` | `#7730dd` |

## 1b. Visual style (revision 35)

The UI's look after the redesign of 2026-10-16 (designer's handoff; boards *Redesign — whole screen*, *before /
after*, *sidebar tabs*, *six skins + new tokens*, *frames, hints, META-SEQ editor* in `docs/prototype/`). The panel
grammar (§2: 56 px HP, n × 144 px U, 32 px lanes) does not change; colour still means role; skins still change colour
only. Where a board and this section disagree, this section wins (the boards were drawn from the older prototype:
they show RHYTHM / STAGES, four patterns and a mark beside the wordmark, none of which exist).

**Rules.**
- **Two faces.** IBM Plex Mono for names, port and knob labels, values and keys; IBM Plex Sans for words:
  descriptions, buttons, tabs, menus, hints, dialogs. Both ship with the app (400 / 500 / 600 each, `@fontsource`
  packages at fixed versions, served from `app://`); no face is fetched at run time.
- **Case.** Module, frame and port names stay uppercase mono (`LPG 1`, `DRUMS`, `PTCH`). Chrome copy is sentence case
  in Sans (`Sidebar`, `Save group`, `Filter by module or port`).
- **Depth.** Borders still separate panels. Floating things (menus, picker, sidebar, dialogs, the top bar, cable
  tags, the LISTEN pill) also get a soft shadow; modules a faint one. No gradients, no hardware imitation.
- **Corners** from the radius scale below (2–14 px).
- **Readable labels.** Port and knob labels use `label`: ≥ 5 : 1 on `panel` and ≥ 4.5 : 1 on `popover` in every skin
  (measured: ≈ 5.1 and ≈ 4.6); `muted` ≥ 4.5 : 1 on both; `faint` keeps its role for values at their default.
- **Icons.** Chrome has a small set of inline stroke icons (search, close, save, new, dice, sidebar, zoom, fit, undo,
  speaker, check, chevron, import, drag grip). Panels stay icon-free (glyphs as before). No icon font, no emoji. No
  mark beside the wordmark: `SREDA` alone.

**New tokens.** Each skin keeps its 28 colours (§1a) and gains `popover` (the surface of floating windows: `panel`
mixed 4 % toward `text`), `label` and `shadow`; three existing values change:

| Skin | `popover` | `label` (on `panel`) | `shadow` | changed |
|---|---|---|---|---|
| DEFAULT | `#232320` | `#908b80` (5.1 : 1) | `rgba(0,0,0,.55)` | — |
| ANNABIOSIS | `#283432` | `#8e9e99` (5.1 : 1) | `rgba(4,10,9,.6)` | — |
| KANAGAWA | `#31313c` | `#9f9c8b` (5.1 : 1) | `rgba(8,8,14,.6)` | `faint` `#54546d` → `#676678` (it equalled `line-2`) |
| TOUCH | `#3a3a3a` | `#a5a5a5` (5.1 : 1) | `rgba(0,0,0,.5)` | `muted` `#a0a0a0` → `#a3a3a3` (4.35 : 1 on `popover`) |
| NORD | `#424958` | `#b3bac6` (5.2 : 1) | `rgba(22,26,34,.5)` | `muted` `#d8dee9` → `#bac0cc` (hints competed with values) |
| TOKYO NIGHT | `#2a2e42` | `#8c96c0` (5.0 : 1) | `rgba(6,7,14,.6)` | `muted` `#737aa2` → `#8c94bd` (failed on `panel`) |
| ORCA (revision 38) | `#1b1b1b` | `#8c8c8c` (5.6 : 1) | `rgba(0,0,0,.6)` | — |

**Scales** (CSS custom properties, built from tokens so they follow the skin):
- Radii: `radius-1` 2 px (level bars, meters), `radius-2` 6 px (fields, options, frame buttons, value chips, displays),
  `radius-3` 8 px (module panels, menu and list rows), `radius-4` 10 px (frames, menus, the top bar, zoom),
  `radius-5` 12 px (sidebar, picker), `radius-6` 14 px (dialogs, the META-SEQ drawer).
- Shadows: `shadow-1` `0 4px 14px` of `shadow` at 55 % (modules); `shadow-2` `0 14px 36px shadow` (menus, picker,
  sidebar, top bar, tags); `shadow-3` `0 24px 60px shadow` (dialogs; upward for the drawer); `ring` `0 0 0 3px` of
  `text` at 9 % (a selected module, an open option, a focused field).
- Sizes: a jack is 14 px with a 2 px ring, its centre 15 px in from the panel edge (was 11 px / 13 px); patched =
  the role colour with a 5 px `ground` centre. A knob (56 × 44, centre 28 / 22): a 3 px track (r 14) in `line`, a 3 px arc in `text`, a body circle
  (r 9.5, `raised` with a `line-2` edge), a 1.8 px pointer to r 7, the mod ring (r 18) in `role-mod` at 55 %. Port and knob labels 9.5 px mono 500 in `label`;
  values 10 px. Chrome text 12–13 px Sans. The frame header is 32 px (was 28). Top-bar buttons 32 px in a 40 px bar.
  List rows (WIRES, LIBRARY, picker) 28–48 px. An option (`BOTH ▾`) is 24 px tall.

**Components.**
- **Module** (`radius-3`, `shadow-1`): selected = border `muted` + `ring`; the head divider in `line`. A value shown
  under a label sits in a small chip on hover / edit (`radius-2`).
- **A side with no ports has no column** (refines §2.2): the panel is 1 HP narrower — NOISE 2 × 1, OUT 2 × 1, A4 and
  A4 CLK 3 × 2. Free modules keep their left edge; STACK frames re-pack on open.
- **Menus** (an option's list): `popover`, border `line-2`, `radius-4`, `shadow-2`, 34 px rows; the picked item =
  `raised` fill and a check, not inverted. (A short description per item comes in Plan 17.)
- **Picker** (`popover`, `radius-5`, `shadow-2`): a 46 px search field with an icon and `esc`; opened from a jack, a
  line `● from SLOPE › EOR   trigger` and every item showing, as a pill in the role colour, the port it will patch
  into; tabs All · Modules · Groups as one segmented control with counts; 48 px two-line rows (mono name, Sans
  description), the picked one with a role-coloured left edge; a footer with keys (`↑ ↓ move · ↵ add · tab switch tab`).
- **Cable tag** on `popover` with a role dot and `shadow-2`. **LISTEN** is a pill at the top centre: speaker icon,
  `Listening to OSC › OUT`, ✕ to stop.
- **Top bar.** Top left a bar with the wordmark and the project — its name (`techno`, `Untitled patch` when unnamed)
  and `● unsaved` while there are unsaved changes; the full path in its tooltip. Top right one grouped bar
  (`radius-4`, `shadow-2`): Dice · New | Save `⌘S` | Sidebar, 32 px Sans buttons with icons and key hints.
- **Zoom**, bottom right: a small grouped bar `− 100 % +` and fit.
- **Hint bar**, bottom left: Sans text with key caps (`/ add module · W wires · G frame · F fit · R randomise`) and
  (the context hints and `? all shortcuts` come in Plan 17; until then the hint bar shows the five general hints).
- **Sidebar** (§5a): floats 16 px from the window's edges, `popover`, `radius-5`, `shadow-2`; the tabs Wires · Mix ·
  Library · Settings as one segmented control (one active look), ✕ on the right; a footer line per tab.
  - Wires: a filter field with an icon; chips `All 9` / `Selection`; section heads with counts; 34 px rows with full
    names at both ends, the value as a chip, ✕ on hover; `+ New wire` as a dashed row; **Normals** a section of its
    own, each normal on two lines (the normal, then what it does); no problems = one line `✓ No problems`; empty
    sections hide; footer `9 wires · 8 modules`.
  - Mix: each OUT a flat card — name (`OUT from MIX`), M / S (30 × 28), a horizontal fader (the OUT's LVL), a
    meter with a dB scale (−48 … 0; one bar, stereo in Plan 17); MASTER pinned to the bottom; footer `after the
    limiter`; while there is at most one OUT a note: `One strip per OUT module. Add another OUT to give a voice its own
    strip, mute and solo.`
  - Library: one filter for all sections; 28 px rows; the open project marked `● open`; a group row shows
    `drag to canvas` and a grip on hover; a long section shows its first eight rows and `Show all 17`; SAMPLES has
    Import and an empty state. No Save as / New (§6).
  - Settings: each skin a row with a 76 × 44 preview tile (ground, panel, text, four roles), its name and a line
    (`Warm graphite`, `Deep green, neon roles`, `Ink-blue night`, `Neutral grey`, `Cool slate`, `Indigo night`);
    the chosen one bordered with a check; hovering another reads `Previewing — click to keep`.
- **Frames** (§5): `radius-4`; the 32 px header holds `⌄` / `›` (collapse) left of the name, then the level meter.
  At rest only state shows: `NN BPM` as an accent-outlined pill when the frame has its own clock, a lit `M` (in
  `accent`) when muted. Hovering the header or selecting the frame adds the tools as 22 px Sans buttons (`radius-2`):
  tint, Stack, Save group, M, `+ Clock` or Tap and ✕. Stack is the default, so it does not show at rest.
- **Collapsed frame** (§5): a tinted card — header with `›`, one jack per crossing port, a `N modules` line.
- **Save** becomes a dialog (Plan 17; until then the name field takes the new look) (`radius-6`, `shadow-3`): `Save project` / `Save group`, a labelled name field, the
  module and wire count, Cancel / Save `↵`.
- **META-SEQ drawer** (§7b; drawn after the board but with the spec's contents): `popover`, top corners `radius-6`,
  `shadow-3` upward, a grip; the header holds the module's name, pattern tabs A–H as a segmented control (the edited
  one selected, the playing one ringed in `accent`, `editing A · playing B`), Copy / Paste, Scale ▾, Root, Gen ▾,
  Dice, Mutate, undo and ✕. Lane heads 210 px: name, LEN, RATE, STEP / PLAYED (NOTE), lock, ⚄. Step cells 4 px apart,
  `radius` 4 px, the current step ringed in `accent`, a marker at each lane's LEN; CHNC shows its percentage.
- **Displays**: `radius-2`; otherwise unchanged.

## 2. Modules

- A module is a compact block: name on top, inputs on the left edge, outputs on the right edge, parameters on the
  face between them.
- **Sizes are quantised:** width N × HP (HP = 56 px), height 1U, 2U or 3U, **exactly n × 144 px** (144, 288 and
  432 px: two 1U stacked are as tall as one 2U, three as one 3U; revision 32 — they were 272 and 400, and STACK
  showed a 16 / 32 px step beside every 2U / 3U module). The header, a 6 px inset, as many whole lanes as fit, at
  least 10 px under the last lane (2U keeps 26 px). A document opened from before re-packs its STACK frames. Each module's size is fixed in its spec (§7). Placement on the canvas
  stays free (8 px grid, magnets); the sizes make STACK pack cleanly.
- **Panel grammar — one layout for every module, small or large** (board *Panel system* in the prototype):
  1. Under a 32 px header (the name) and a 6 px inset, the panel is cut into **lanes of 32 px**: 1U = 3 lanes,
     2U = 7, 3U = 12 (as many as fit in n × 144). Room to breathe is part of the grammar: knobs 56 × 40, jacks 14 px (revision 35; were 11), 4 px inside the edges of a
     display or a button.
  2. **Three columns** (revision 35: a side with no ports has none, §1b): the IN column (1 HP) on the left, the OUT column (1 HP) on the right, the control
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
  8. **Type:** the module name 11 px semibold mono, labels 9.5 px mono 500 in `label` (revision 35; were 9 px in
     `quiet`), values 10 px; no other
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
  off. Magnets only arrange; snapped modules do not stay linked.
- **Replace:** double-click a module's name → the search opens as `REPLACE <MODULE>`; Enter puts the new module in
  the same place and frame. Cables move to the new module's port with the same id, else to its next unused port of
  the same role; cables with no match are removed. Knobs with the same id keep their value (`freq` survives OSC →
  COMPLEX); attenuverters and ratios move with their port. One undo step.
- **Insert into a cable:** drag a module that has no cables over a cable; within 8 screen px the cable highlights;
  dropping splits it: source → the module's first input of the source's role (else its first input), the module's
  first output of the target's role (else its first output) → the old target. One undo step.
- **Cables are drawn behind.** By default a cable shows only its two ends: a stub of about 14 px in the cable's
  colour leaving each jack and going behind the panel, so a patched jack reads as patched and the canvas stays clear.
  A cable is drawn whole (curved, full strength):
  - **all of them** while the sidebar is open on WIRES;
  - **a module's or a frame's cables** while it is hovered or selected (a frame: every cable touching anything
    inside it);
  - **the cable under the pointer** — hovering a stub (or, where the cable is drawn whole, its path within 6 screen
    px) draws it whole, thicker, with a tag by the pointer naming both ends (`SLOPE › EOC  →  STAGES › ADV`);
  - **a cable being dragged**, and the cable a dragged module would be inserted into.
  Ghost cables (normals) follow the same rule. Stubs are drawn for every cable, also while the cable is whole.
  Insert-into-a-cable finds a cable by its path whether it is drawn whole or not, and draws the candidate whole.
- Popups (the picker, option lists) close when the canvas pans or zooms.
- **Randomise:** R with the pointer over a module sets each of its knobs to a random value within the knob's
  `randomRange` (default: full range; pitch and frequency knobs declare narrower, musical ranges). Options,
  attenuverters and ratios are left alone. One undo step.
- **Fit:** F fits the whole patch in view, ⇧F the selection.
- **Collapse:** C collapses / expands the selected frames, ⇧C all of them (§5).
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

- A group is a **frame**: a rectangle of its own with a translucent fill and a 32 px header strip (revision 35; was 28) carrying the name
  (`GROUP 1`, `GROUP 2`…; double-click to rename), the frame tools and the clock controls. At rest the header shows only state (revision 35, §1b): the
  name, the level meter, the BPM of its own clock, a lit M while muted; the tools (tint, Stack, Save group, M, the
  clock's + Clock / Tap / ✕) show while the header is hovered or the frame is selected. Drag an edge or corner to resize (minimum 352 × 96); a STACK frame re-packs its
  children to the new width as you drag (see below);
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
- **Frame tools** in the header (tint, Stack, Save group, M, collapse):
  - **Tint** (a small swatch): click cycles the fill through neutral (≈ 4 % white) and six muted hues (≈ 8 %).
    Nested frames layer, so the hierarchy reads without extra lines.
  - **STACK:** a frame mode (`layout: 'stack'`), toggled, **on by default** — ⌘G frames and factory frames start
    stacked. It packs the frame's direct children (modules, and child frames as single blocks) **densely** inside
    16 px padding, with no gaps: in reading order (rows by position, then x), each child goes to the highest free
    place it fits in, the leftmost of equal ones (skyline packing), so 1U modules fill the room beside and under taller
    ones. A STACK frame manages its own layout: anything dropped into, moved within or taken out of it re-packs it
    (where a module is dropped sets its place in the reading order). Turning STACK off leaves a free frame and keeps
    the layout.
  - **The packing width** is the frame's inner width. Turning STACK on in a free frame chooses it: the smallest area
    at about 1.6 : 1, at least the widest child. Dragging the right edge or the bottom-right corner of a STACK frame
    changes the width (never below the widest child) and re-packs live; the height always follows the content.
    Pressing STACK on a stacked frame turns it off. Each is one undo step.
  - After a pack the frame fits its content: 16 px on all four sides.
  - **WIRE FIX is gone** (it routed cables in channels; with cables drawn behind, §4, it is not needed). Documents
    with `layout: 'route'` frames open them as STACK frames (same order, packed densely).
  - **MUTE (M):** the frame fades out over 50 ms: cables leaving the frame and OUT modules inside it go silent; clocks
    and everything inside keep running, so the voice comes back in time. A cable is silenced by the innermost
    frame that holds its source but not its target, when that frame or one of its parents is muted. Its contents are drawn at 40 % (its own
    header stays as is). Muting a frame mutes its children.
- **Collapse** (the big picture): **C** collapses or expands the selected frames, **⇧C** collapses all frames (or
  expands all, when every frame is collapsed); the header's `⌄` / `›` left of the name (always visible; revision 35, were `▾` / `▸` at the right) does the same for one frame. A collapsed frame
  is a block at the frame's top-left: its header (name, level meter, CLK in / out, M, `▸`), then one jack per port
  inside it that has a cable crossing its edge — inputs on the left, outputs on the right, labelled `MODULE › PORT`;
  several cables from one port share its jack. Cables inside are hidden; cables crossing the edge end on the block's
  jacks, and a new cable can be dragged from them (it is that port). A port with no cable out is not on the block:
  expand to patch it. Neighbours do not move (the frame's room stays free); expanding brings the frame back as it
  was. A collapsed parent hides its children; the block lists every crossing port of everything inside it. Collapsing
  changes only the view (the sound is the same), is saved in the document (`collapsed`) and is one undo step. The
  block can be moved (its frame moves with it), selected, deleted, muted and saved like the frame.

## 5a. Sidebar and the WIRES editor

- **Sidebar:** a panel floating 16 px from the window's right, top and bottom edges (revision 35, §1b), hidden by default (W or the SIDEBAR button opens and closes it; Esc closes
  it). It does not cover the canvas: the canvas, the top-right buttons, the zoom control and the hint line end at its
  edge. It opens at a fixed width (440 px) with every new window and every opened project; within a session its
  left edge can be dragged (320 px … 70 % of the window). A tab row at its top holds its functions: **WIRES**,
  **MIX**, **LIBRARY** and **SETTINGS**. W opens the sidebar on WIRES, **M** on MIX (either key again, while that tab shows,
  closes it); the sidebar remembers the last tab within a session.
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

- **MIX** — the project's mixer: a strip per OUT, then the master.
  - **Strips** in reading order of their OUT modules. A strip is named after the frame its OUT sits in when that
    frame holds only this OUT (`DRUMS`), else after the module (`OUT 2`). Each strip: the name (a click selects the
    OUT and frames it in view), a vertical fader, a level meter (the strip's peak after fader, mute and solo, held and
    falling over 300 ms), **M** (mute) and **S** (solo).
  - **The fader is the OUT's LVL knob:** moving either moves both (one value, one undo step per drag). Mute and solo
    are hidden options of the OUT module (`mute`, `solo`: OFF / ON), saved with the document; each click is one undo
    step and a message (no new plan). While any strip is soloed only soloed strips sound; mute wins over solo. An OUT
    inside a muted frame is silent and its strip is drawn dimmed.
  - **Master:** the last strip, a fader for the whole project (the document's `master`, 0…1, default 1, before the
    master stage's DC blocker and limiter, gliding 10 ms) and a meter after the limiter. Listening (§4) and sample
    audition (§7a) go through the master stage but not through the strips.
  - Later (backlog): recording and export.
- **LIBRARY** — the library folder (§6) in three sections, each with a filter field and folders as path prefixes:
  - **PROJECTS** (factory first, then the library's): a click opens the project (replaces the canvas, one undo step,
    fits it in view); saving lives in the top bar only (revision 35; its header held SAVE AS and
    NEW). This is the one place library projects are listed
    (the picker has no PROJECTS tab).
  - **GROUPS**: drag a row onto the canvas to place the group at the drop point, or click it to place it at the
    middle of the view (fresh ids, as from the picker).
  - **SAMPLES**: hovering a row auditions it (120 ms after the pointer settles; leaving stops it); dragging a row onto empty canvas places
    a SAMPLER with it, onto a SAMPLER or GRAINS sets its sample; the header's IMPORT does File › Import Samples….
- **SETTINGS** — app-wide settings: for now the skin (§1a).

## 6. Session, library and factory patches

- The current canvas autosaves to IndexedDB 500 ms after the last edit. Opening the app resumes it; the very first
  launch opens the factory project *Pulse*, so there is sound after one click.
- Audio starts on the first click anywhere (browser autoplay rule); until then a single line reads
  `Click to start audio` (sentence case since revision 35).
- Top right (revision 35: one grouped bar in the order Dice · New | Save | Sidebar, sentence case, §1b): **SIDEBAR** (opens the sidebar, §5a; its first tab is WIRES), **SAVE** (saves the project, as ⌘S with no
  frame selected), **NEW** (clears the canvas; an undo step) and **DICE** (a random
  playable patch, below; revision 30: beside NEW, not in its place). With the listen bar these are the only chrome.
- **DICE** replaces the canvas with a new random patch (one undo step, fit in view, the speakers fade in) and the
  project becomes unnamed. Revision 36: each throw picks one of **eleven styles** at random (equal odds) and builds a
  patch in that style from a shared library of **parts**, then adds **0–3 twists**. The style names the outer frame
  (`ACID`, `WEST COAST`) and the notice reads `Dice: acid`. The same seed gives the same patch.
  - **A style** sets the character: a BPM range, the scales and root, which roles play (each with a chance), the parts
    a role may use (weighted), the effect chains it may end in, and its twist pool. Bass and lines share the style's
    scale and root.

    | Style | BPM | Roles (parts a role may use) | Effects |
    |---|---|---|---|
    | techno | 125–138 | drums (kick on the beat, hats, clap or rim), bass (pulse, reese or FM), sometimes a stab | DELAY → REVERB (room) |
    | acid | 120–140 | acid line (DIODE / LADDER, high RES, slides and accents, cutoff envelope, often DRIVE), sparse drums | DELAY or none |
    | dub | 110–125 | sub bass, rare stabs, sparse drums | long DELAY (TAPE / SPRING, high feedback) → REVERB |
    | electro | 115–130 | broken kick / snare, FM bass, tonal toms, zaps | DELAY (DIGI) |
    | IDM / glitch | 90–170 | perc on ÷3 / ×3 lanes, CHANCE, SHIFT, S&H on pitch and cutoff, short blips | short DELAY (DIGI) → REVERB |
    | minimal polymeter | 118–126 | 3–4 short perc voices on lane lengths 5 / 7 / 9 / 16, a sub pulse | REVERB (room) |
    | Berlin school | 90–120 | an ARP / MOTIF sequence through a swept filter, a pad, sometimes a bass | DELAY (3/16) → REVERB (hall) |
    | west coast | 70–110 | COMPLEX + FOLD + LPG bongos, random voltages (UNCERTAINTY, S&H), SWITCH / SPREAD between voices | REVERB (plate) |
    | industrial | 100–140 | noise and metal hits (COMB, FOLD, DRIVE to the edge), a distorted pulse | DRIVE → REVERB (room) |
    | drone | 40–70 | 1–2 drones (COMPLEX / FOLD, slow cycling SLOPEs), sometimes GRAINS | DELAY → REVERB (hall) |
    | ambient bells | 40–80 | bells or a pad (FM / sine / COMB), CHANCE-thinned, a drone sometimes | long DELAY → REVERB (plate / hall) |

  - **Parts**, by role, each with its own randomness: drums — kick (sine with a pitch envelope, FM click, noise thump),
    hats (white noise through an LPG, FOLD metal, COMB pings), snare / clap (band-passed noise, clap bursts), perc
    (pinged LPG bongos on OSC or COMPLEX, a self-oscillating FILTER ping, FM toms); bass — pulse (saw / square →
    filter), reese (two detuned saws), FM (COMPLEX), sub (sine), acid; lines — pluck, arp, bells, stab, pad,
    west-coast melody; textures — drone, noise wash, grain cloud, chaotic bells, S&H blips.
  - **Twists** (sound design over any style): FM from one voice's oscillator into another's; S&H on a voice's pitch
    or cutoff; SWITCH / SPREAD routing a gate or a voice between two destinations; DELAY feedback raised and filtered;
    GRAINS on LIVE fed by a voice, back into the mix; polymeter (other LEN / RATE on some lanes); a DRIVE or FOLD
    inserted after a voice; CHANCE thinning a gate.
  - Voices sit in named STACK frames (`DRUMS`, `BASS`, `ACID`, `BELLS`…) inside the clock frame; they mix (two MIXes
    in a row past four voices) into the style's effects and one OUT. Every part's output stays in a known range and
    the mix sets levels by role. Values are chosen inside safe ranges: every throw sounds (no PROBLEMS, a level between
    −40 and −3 dBFS on the master over its first seconds) and never clips hard. Tests throw 500 seeds (valid, no
    PROBLEMS, every style, part and twist comes up) and render four throws per style.
- **Library = a folder on disk.** The first save or open asks for a library folder once (a folder dialog; the
  main process keeps its path in the app's settings and reads and writes it with Node `fs`, §8). Inside it:
  `groups/**/<name>.sreda-group.json` and `projects/**/<name>.sreda.json`; any subfolders made in the Finder show up
  as path prefixes. Files are the document JSON (`version`, `modules`, `cables`, `groups`); a group file holds one
  top frame with everything inside it.
- **Save:** a frame's header has a Save group tool, and ⌘S with exactly one frame selected does the same: it saves that group — a name field appears (a dialog since revision 35, §1b) (`acid/303 voice`: a slash
  makes subfolders); it stores the frame, everything inside it, the cables between those, its clock and tint, not
  cables from outside. ⌘S with anything else saves the project (straight away if it already has a name, else a
  name field); ⇧⌘S is save-as. The project's name shows next to SREDA at the top left (its path in the tooltip, revision 35), with `● unsaved` while there are
  unsaved changes. Factory entries are read-only: saving one asks for a new name.
- **One picker** for modules and groups: the module search (§4) gets tabs ALL · MODULES · GROUPS (Tab / ⇧Tab cycle, a click picks); typing searches names and folders in the current tab; each row shows its folder
  and kind. **/** (or a double-click on empty canvas) opens it at the pointer on ALL. No single-letter keys for tabs
  (G is taken by frames). Opened from a jack, it offers modules and groups; in REPLACE mode, modules only. Projects
  are opened from LIBRARY › PROJECTS (§5a) or with ⌘O.
- **⌘O** opens the system file dialog for a project file (`*.sreda.json`) anywhere on disk. The project opens
  (replacing the canvas, one undo step) and its path shows next to SREDA; ⌘S saves back to that same file, even
  outside the library; ⇧⌘S saves a copy into the library. A file that cannot be read or is not a SREDA document shows
  `<NAME> COULD NOT BE OPENED` and the current project stays.
- **File › Import Samples…** (⇧⌘I, also IMPORT in LIBRARY › SAMPLES) opens the system file dialog for audio files
  (several at once); they are copied into `samples/` under free names. If a SAMPLER or GRAINS is selected, the first
  file becomes its sample (one undo step); otherwise the sidebar opens on LIBRARY › SAMPLES showing them.
  - A **group** lands with its frame's top-left at the drop point, with fresh ids; opened from a trigger output, the
    cable goes into the group's CLK in (from any other jack the group lands unwired).
  - A **project** replaces the canvas (one undo step) and fits it in view.
- **FACTORY** (read-only, shipped with the app, listed under `FACTORY/`): projects — the ones below — and groups —
  *303 voice* (the ACID voice without delay and out, own clock 128 BPM), *complex vco* (COMPLEX → FOLD → LPG pinged
  by a cycling SLOPE, UNCERTAINTY on the fold), *bleep-bloop* (own clock 120 BPM at ×4 → CHANCE → UNCERTAINTY
  quantised → QUANT → OSC → LPG), *vca-lpg* (two LPGs: the first in VCA mode with a SLOPE on its level, the second pinged; CLK in fires both).
- **More factory presets** (revision 31), all built from the current modules, each frame with its own clock so it
  plays when dropped in (patch CLK IN to follow the patch's clock):
  - groups — drums: *kick* (a sine with a pitch envelope and a soft DRIVE), *snare* (a tone and band-passed noise),
    *hats* (closed and open), *clap* (band-passed noise through a short DIGI delay), *noisy techno drums* (kick, hats
    and a folded percussion through DIST); bass and lead: *fm bass* (COMPLEX, an envelope on the index), *reese* (two
    detuned saws through a LADDER, the cutoff breathing), *pluck* (a saw through an LPG in LP mode); ambient:
    *chaotic bells* (CHANCE and UNCERTAINTY into quantised sine bells, a big PLATE), *pad* (two detuned oscillators, slow
    filter and envelope, HALL), *drone* (COMPLEX → FOLD → LADDER → TAPE delay), *grain cloud* (GRAINS on LIVE over a slow
    bell), *frozen space* (a slow source into a 30 s HALL);
  - projects: *techno* (noisy techno drums, fm bass, hats at 130 BPM), *ambient bells* (chaotic bells over a drone),
    *dub* (kick, snare and a chord stab through a long SPRING / TAPE delay and a reverb at 75 BPM), *generative*
    (chance-driven quantised voices, a grain cloud, slow modulation).
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

> RHYTHM and STAGES below are replaced by META-SEQ (§7b, revision 33); they stay described here as the source of
> its migration.

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
| | **FOLD** | in (audio) | fold, symmetry, level; MODEL (revision 27, §7a) | out (audio) | — |
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

- Sizes (HP × U; revision 35: NOISE 2×1, OUT 2×1, a side with no ports has no column): OSC 5×1, COMPLEX 6×1, NOISE 3×1, UNCERTAINTY 4×1, SLOPE 5×1, LPG 4×1, FILTER 4×1, FOLD 5×1 (revision 27),
  STAGES 10×3, RHYTHM 10×2, CHANCE 3×1, SHIFT 3×1, COMPARE 3×1, FOLLOW 6×1, SWITCH 4×2, SPREAD 4×2, S&H 2×1, QUANT 3×1,
  MIX 4×2, ATT 6×2, A×B+C 5×2, DELAY 5×1, SCOPE 6×2, OUT 3×1 (24 modules).
- Displays in lanes: STAGES' contour 9 (revision 32; then LEN and ROOT, then GEN ▾ · SCALE ▾ · DICE), RHYTHM's pads 4 (then LEN,
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

- Several OUT modules sum, each after its MIX strip (LVL, mute, solo, §5a). Then the master fader (the document's
  `master`), then the fixed master stage: 5 Hz DC blocker, soft limiter, nothing non-finite reaches the device.

## 7a. Second milestone: the sound pack

Built right after the first build, with its own plan. Same panel grammar (§2); board *Sound pack* in the prototype.
Stereo outputs are two mono outputs (cables stay mono).

| Module | Size | Inputs | Knobs | Mode strip | Outputs |
|---|---|---|---|---|---|
| **FILTER** (upgrade) | 5×1 | in (audio), pitch (pitch: tracks the cutoff; COMB's tuning) | CUT, RES, DRV (gain into each resonant model's saturation; revision 37) | MODEL ▾ SVF / LADDER / DIODE / SK / COMB / VOWEL, drawn as a response glyph | lp, bp, hp |
| **DRIVE** | 6×1 | in (audio) | GAIN (to +36 dB), BIAS, TONE, MIX | MODEL ▾ SOFT / TUBE / OD / DIST / FUZZ / RECT / DIGI | out |
| **DELAY** (upgrade) | 6×1 | in (audio), clk (trigger) | TIME, FB, MIX, CHAR | TYPE ▾ DIGI / TAPE / SPRING · PING | l, r |
| **REVERB** | 6×2, display 2 lanes | in (audio) | SIZE, DECAY, DAMP, PRE, MOD, MIX | TYPE ▾ ROOM / PLATE / HALL · FREEZE | l, r |
| **SAMPLER** | 8×2 | trig (trigger), pitch (pitch), slice (mod), start (mod) | PITCH (±24 st), START, LEN, DEC, LVL, SLICES (2–64; SENS while AUTO) | MODE ▾ ONE / LOOP / SLICE · REV · AUTO · LOAD (right) | l, r, eoc (trigger) |
| **GRAINS** | 10×2 | trig (trigger), in (audio), pos (mod), pitch (pitch) | POS, SIZE (5 ms…1 s), DENS (1–200 /s), SPRAY, PITCH, DETUNE, REV %, SPREAD | SOURCE ▾ FILE / LIVE · FREEZE · LOAD (right) | l, r |

- **FILTER models.** One module, so changing MODEL never breaks cables; each model fills LP / BP / HP with its own
  responses: SVF 12 dB; LADDER 24 dB lowpass with 2-pole band and the complementary highpass; DIODE the 18 dB TB-303
  ladder; SK the MS-20's Sallen-Key pair; COMB tuned by CUT + PITCH, LP = positive feedback, BP = negative, HP = comb
  minus dry; VOWEL formants morphing A-E-I-O-U on CUT, LP = all formants, BP = the first, HP = the upper ones.
  DRV drives the nonlinear models (2× oversampling); NOTCH is dropped (four outputs do not fit 1U).
  - **Revision 28, after listening against Ableton's Auto Filter (SVF, PRD, DFM, MS2 renders in
    `projects/refs/filter/`):** RES means the same on every model — a +7 dB peak at RES 0.5 and about +20 dB at 0.9
    (measured at 1 kHz on white noise), self-oscillation only at the very end of the knob; the passband holds its level
    within ±1 dB at any RES (no model loses 10–15 dB as RES rises). Slopes stay those of the originals: SVF and SK
    12 dB/oct, DIODE about 18, LADDER 24. Each model's saturation follows its reference (a 110 Hz sine at −14 dBFS
    peak, within ±6 dB on the 2nd and 3rd harmonics): SVF clean; LADDER asymmetric — 2nd and 3rd near −55 / −49 dB
    at RES 0, cleaner as RES rises; DIODE a steady 3rd near −55 dB at any RES; SK clean at RES 0, its clipping in the
    feedback path so the 3rd grows with RES (to about −61 dB at 0.9) with a faint 2nd near −75 dB.
  - **The response glyph moves:** it draws the live cutoff (knob, modulation and PTCH) and resonance, schematically,
    from a readout of the engine.
  - **Revision 37, measured against references** (`docs/superpowers/specs/2026-10-17-filter-microscope-design.md`):
    SVF, LADDER, DIODE and SK are zero-delay-feedback cores with their saturation inside the resonance loop (SVF after
    Cytomic / Vital, LADDER and DIODE after Zavalishin, SK the Korg35), all at 2×. SVF is no longer linear: DRV drives
    it like the others. Every one of the four self-oscillates at RES 1 (none at 0.95), at −6 ± 3 dBFS and within
    ±20 cents of CUT, so PTCH plays it. Revision 28's RES meaning (+7 dB at 0.5, about +20 at 0.9) and passband
    (±1 dB) now hold at every cutoff from 50 Hz to 10 kHz, not only at 1 kHz; the passband is kept inside the loop,
    never by an output multiplier, so a loud sine at the cutoff runs into the saturation (at most +6 dB over the
    input) while a quiet one gets the full peak. DRV is 0…+20 dB into the saturation, loudness-matched within ±3 dB,
    its THD rising steadily to −20 dB or more. Revision 28's harmonic targets at DRV 0 stay.
- **DRIVE** (revision 26, after listening: the three old modes sounded alike). Seven models with distinct
  characters, references Ableton's Saturator, Pedal and Roar:
  - **SOFT** — a soft sine curve: warm, rounded, almost no grit (Saturator Soft Sine).
  - **TUBE** — an asymmetric triode-like curve: even harmonics, soft compression, a slight sag on loud passages.
  - **OD** — a pedal overdrive: a mid-boosting pre-emphasis before a soft diode clip, de-emphasis after; mid-forward
    (Pedal Overdrive).
  - **DIST** — high gain into a hard op-amp clip, dense and compressed (Pedal Distortion).
  - **FUZZ** — a heavily biased transistor fuzz: squared-off, with the quiet tail gating and sputtering (Pedal Fuzz).
  - **RECT** — rectification: BIAS blends half-wave (0) to full-wave (1), an octave up and metallic.
  - **DIGI** — a hard digital clip: flat, harsh, no softening.
  - **BIAS** (−1…1) shifts the signal into the curve: asymmetry and even harmonics (RECT: the half / full blend); its
    DC is removed after the curve. **GAIN** 0…36 dB into the curve. **TONE** a tilt after the curve (each model voices
    its own range: OD and DIST a mid-focused tone stack, the others a tilt around 800 Hz). **MIX** dry / wet, the dry
    path delayed to match.
  - The output level is matched across models and gains (within ±1.5 dB RMS on a sine and on drums at the same GAIN),
    so changing model changes character, not loudness. ADAA where the curve allows, 2× oversampling always.
  - Old documents: MODE SAT / OD / FUZZ open as SOFT / OD / FUZZ.
  - Models are tuned by ear and against reference renders of those devices (a 110 Hz sine and a drum loop),
    comparing harmonic levels.
- **FOLD** (revision 27, after listening: it added little level and few harmonics). Four models, references Serge,
  Buchla 259 and Ableton Roar's folders:
  - **SINE** — a sine folder (sin of the driven signal): smooth, vocal folds (Serge-like).
  - **TRI** — a triangle folder: straight segments with corners, brighter and more glassy (Buchla 259-like).
  - **WRAP** — wrap-around: the signal leaves one edge and comes back at the other; hard and spiky.
  - **CHEB** — Chebyshev polynomials: FOLD brings in harmonics 2…16 one after another, clean and organ-like.
  - **FOLD** drives the signal into the folder from ×1 to ×40 (+32 dB, exponential); at FOLD 0 the signal passes
    dry and the folder fades in over the first quarter. **SYM** (−1…1) offsets it: asymmetric folds, even harmonics;
    the DC is removed after. **LEVEL** −12…+12 dB after the folder.
  - The output level is matched across models and FOLD (±1.5 dB RMS on a −6 dBFS sine), so FOLD adds harmonics,
    not a drop or a jump in loudness. ADAA (SINE, TRI, WRAP) and 2× oversampling.
  - Old documents: FOLD keeps its drive (old ×(1 + 8·FOLD)) and opens as SINE at LEVEL 0 dB.
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
  name; LOAD — and a click on the display while it is empty (`NO SAMPLE · CLICK TO LOAD`) — opens the system file
  dialog for an audio file; the file is copied into `samples/` (asking for the library folder first if none is chosen)
  and becomes this module's sample (one undo step). GRAINS' display and LOAD do the same.
  - **A loaded display is a cursor and a scrub** (revision 25). SAMPLER in ONE / LOOP: a click on the waveform moves
    START there (one undo step); pressing and dragging scrubs — the file plays at the point under the pointer, its
    speed and direction following the pointer (1 ms fades in and out, the position gliding over 10 ms so a jerky
    pointer stays smooth; a pointer at rest fades to silence, like a stopped record — the scrub voice has its own 25 Hz
    high-pass), heard through the module's own outputs at LVL; START follows and stays where the pointer
    is released (the whole gesture one undo step). The scrub is a voice of its own beside the triggered ones; while it
    sounds TRIG still plays. In SLICE a click plays the slice under the pointer (START unchanged) and a drag scrubs
    the whole file. GRAINS: a click or drag moves POS (one undo step per gesture); the grain cloud follows the pointer;
    in LIVE positions are relative to the write head, as the knob.
- **GRAINS.** Grains (Hann window, up to 64 at once) spawn on TRIG rises, or at DENS per second when TRIG is
  unpatched; each reads from POS (± SPRAY), lasts SIZE, plays at PITCH (± DETUNE), reversed with probability REV %,
  panned within SPREAD. SOURCE FILE reads a library sample; LIVE records IN into an 8-second ring buffer, and FREEZE
  stops the recording so the frozen piece of the patch can be explored. The display shows the source waveform,
  POS and the live grains as amber dots; while LIVE, the region being written is shaded.
- **Samples as a system.**
  - Files live in the library folder under `samples/**`: WAV, AIFF, FLAC, MP3, OGG. A module stores the sample's
    library path; on load the UI reads the file (IPC), decodes and resamples it to the engine's rate, and hands the
    channels to the engine, which keeps them in a sample pool by id. Hit detection for AUTO runs once per load.
  - Samples already in the library are browsed and auditioned in the sidebar's LIBRARY › SAMPLES (§5a); the picker
    has no SAMPLES tab and S is not bound (revision 24).
  - An audio file dropped on the canvas is copied into `samples/` and opens a SAMPLER with it; dropped on a SAMPLER
    or GRAINS it replaces their sample.
  - A missing file shows `MISSING · <name>` on the display, outputs silence, and is listed under PROBLEMS in WIRES.
  - Saved groups and projects reference samples by path; they do not copy audio.
- **Sample analysis off the main thread** (revision 23): parsing AIFF, finding hits and computing the display peaks
  run in a Web Worker (the channels are transferred, not copied); decoding and resampling stay with the browser's
  own asynchronous decoder. Loading a 10-minute file never freezes the UI.
- **Unused samples are unloaded** (revision 23): a sample the shown document has not named for 30 s is dropped from
  the registry (bytes, audio, peaks) and from the engine's pool (an `unsample` message; freed while handling the
  message, never in `process`). Asked for again (an undo, an opened project), it is read from disk again: a short
  silence, then sound.
- **Engine additions:** a sample pool (memory sized on load, not in `process`); per-module voices and grain pools
  allocated on construction; the plan carries a module's sample id in its fixed values.

**How the sound pack was built** (Plan 4; revision 19):

- **A module's sample** is `ModuleDoc.sample?: string`, a path under the library's `samples/`; documents store paths,
  never audio. Replacing a SAMPLER by GRAINS (or back) keeps it.
- **Sample ids** are session-local integers handed out by the UI's sample registry, from 1 (0 is the audition's slot).
  The plan carries a module's id, or −1 for none or MISSING, in its hidden `sample` fixed value; the engine keeps
  samples by id and a module reads the pool every block, so a sample that arrives after the plan just starts sounding.
- **Loading:** each path is read once per session, decoded at the audio device's rate (again if the device's rate
  differs from the one it was decoded at); a MISSING or refused sample is tried again when it is asked for again.
  Refused with a notice `<FILE> — <reason>`: no audio, longer than 10 minutes, cannot be decoded. File names that the
  library cannot read back (a segment over 100 characters, a `\`) are not listed; dropped files are shortened.
- **DELAY's output `out` is now `l`** (with `r` beside it); old documents' cables move to `l` when opened.
- **Hits for AUTO** are found once per load (a rise in short-time energy, a strength 0…1 each) and sent with the
  sample; SENS (the SLICES knob while AUTO) keeps the hits at least `1 − SENS` strong.
- **Audition** (hovering a row in LIBRARY › SAMPLES) decodes the file on the side into slot 0 and plays it once in
  place of the speakers' mix, through the master stage; it keeps nothing; leaving the row stops it.
- **Readouts:** REVERB's state is its tail level (0…1); SAMPLER's is the newest voice's position (0…1, −1 silent);
  GRAINS has a trace: the write head (0…1, −1 for FILE), 64 grain positions (−1 idle), 512 column peaks of the live
  buffer.
- **2× oversampling** is a polyphase half-band (63 taps, Kaiser β 8, 31 samples of latency) under FOLD, DRIVE and
  FILTER's nonlinear models, with first-order ADAA.

## 7b. META-SEQ: one sequencer in place of RHYTHM and STAGES (revision 33)

Almost every patch paired them the same way (RHYTHM › GATE → STAGES › ADV, 10×2 + 10×3 HP, two DICE), so they
become one sequencer module: a small panel on the canvas, the depth in an editor docked under the canvas, in the
manner of software sequencers (Bitwig Stepic, Hypnus, Riffer, Elektron) since SREDA stays in the computer.
RHYTHM and STAGES (§7) leave the picker and the engine; §7 keeps them only as the source of the migration below.

**The module.** META-SEQ, 6 × 2U, one voice.

| | ports |
|---|---|
| in | **CLK** (trigger with its ×N / ÷N ratio; unpatched it is a problem `no clock`, as RHYTHM's was) · **RST** (trigger: every lane goes to its step 1 on the next clock) · **DICE** (trigger); PAT, TRNS, MUT and DENS are modulated through their knobs' mod jacks |
| out | **CV** (pitch: the note plus TRNS) · **GATE** (trigger) · **ACC** (trigger, with the hit) · **VEL** (mod 0…1, held until the next hit) · **EOC** (trigger, when the GATE lane wraps) |

- Panel: a 4-lane overview display, then the knobs PAT (A…H), TRNS (±24 semitones, the result snapped to SCALE from
  ROOT), MUT, DENS, then the
  mode strip GEN ▾ · DICE. The display is read-only: the playing pattern's NOTE contour, the GATE steps with the
  current one ringed amber, thin ACC and VEL strips, the lane lengths. A click on the display or a double-click on the
  module opens the editor.
- **Lanes**, six per pattern, each with its own **LEN** 1–16, **RATE** (÷4 ÷3 ÷2 ×1 ×2 ×3 ×4, steps per clock) and
  **lock**:
  - **GATE** — the step plays or rests.
  - **TIE** — the step continues the one before: GATE stays high (no new rise, envelopes do not retrigger). With GATE
    on as well it is a **slide**: the step plays its note (NOTE in PLAYED advances) and CV glides to it in 80 ms (the
    303 slide; there is no separate SLIDE lane). With GATE off it is a **hold**: the note sounding goes on (NOTE in
    PLAYED does not advance; in STEP a differing note glides). GATE off and TIE off is a rest. A TIE after a rest plays like a hit; an accent on a TIE
    is ignored.
  - **NOTE** — a scale degree from ROOT in SCALE (24 semitones, as STAGES' voltages). Its own mode **STEP / PLAYED**
    (default PLAYED): PLAYED advances on a hit that sounds and on a slide (not on a rest, a hold or a hit CHNC
    dropped), so a
    7-note phrase is heard whole over any rhythm; STEP advances on its own steps like every other lane.
  - **ACC** — the hit also fires ACC. **VEL** — 0…1 on VEL with the hit. **CHNC** — the odds the hit sounds.
- **DENS** scales every CHNC: at 0.5 the lane plays as drawn, below it thins, above it fills (a step's odds become
  `clamp(chnc · 2 · DENS)`). Rests stay rests.
- **Time.** Each lane steps at its RATE against the clock; ×N lanes subdivide the last clock interval (as an input's
  ×N ratio does). A hit holds GATE for half a GATE-lane step.
- **Patterns.** Eight (A–H), each a whole set of lanes with their LEN, RATE, locks and STEP / PLAYED. PAT (knob + CV)
  picks the playing one; the change waits until the GATE lane wraps, so it never cuts a bar. Another META-SEQ's CV
  into PAT is a sequencer of sequences; that is how long songs are built (there is no chain list).

**The editor (bottom drawer).** Docked under the canvas at the window's full width, about 300 px high by default,
its top edge dragged; the canvas above it shrinks rather than being covered, and scrolls so the module stays in
view. It shows one META-SEQ: opened by a double-click on the module or a click on its display, switched by a click
on another META-SEQ, closed by Esc or ✕.

- Header: the module's name, pattern tabs **A–H** (the playing one lit, the edited one selected; any pattern may be
  edited while another plays), COPY / PASTE pattern, SCALE ▾, ROOT, GEN ▾, DICE, MUTATE.
- One row per lane; on its left: name, LEN, RATE, STEP / PLAYED (NOTE), 🔒, ⚄ (DICE this lane).
- **One step grid for all lanes**, a step ≈ 1/16 of the width, in clock time: a ÷2 lane's steps are twice as wide,
  a ×2 lane's half. A lane shorter than the window repeats as a faint **ghost** to the end, so it shows where NOTE (7)
  meets GATE (16) and where accents line up; only the bright first cycle is edited. Each lane's cursor moves live
  from the engine's readout.
- Gestures: NOTE — press and drag draws notes snapped to the scale (one undo step per stroke), note names under the
  lane; GATE / TIE / ACC — a click toggles, a drag paints the same value; VEL / CHNC — press and drag draws bars, a
  double-click restores the default; LEN — drag the lane's end marker, or the wheel over LEN; RATE and STEP / PLAYED —
  a click opens the list. ⌘Z as everywhere; each action is one undo step.

**Generation.**

- **GEN ▾** styles: 303, MOTIF, WALK, TURING, ARP, PHRASE, PEDAL (STAGES' note generators with their slides as TIE,
  and RHYTHM's 303-style gates, long notes and accents) and **EUCLID** (gates by Euclid with random HITS and ROT,
  notes as PEDAL). EUCLID is no longer a live mode.
- **DICE** (button, or a rise on DICE) writes the edited pattern's unlocked lanes in the GEN style and leaves LEN and
  RATE alone (the style fills, you shape the polymeter). The button is one undo step; the input changes the patch
  without one.
- **⚄ on a lane** writes that lane alone, in the same style and consistent with the others (ACC only on hits, TIE
  only after a hit, NOTE in the scale).
- **MUTATE** (MUT knob + CV, 0…1; Turing-machine drift, revised while planning: the engine mutates by fixed rules
  rather than from a bank of generated variants, which needed new plumbing for no audible gain): when an unlocked lane
  wraps, each of its steps within LEN changes with odds MUT²: GATE swaps with another step of the lane (the density
  stays), NOTE takes another note already in the lane (or the next scale degree up or down when it holds one note),
  TIE and ACC toggle, VEL and CHNC move by up to ±0.25. Nothing allocates on the audio thread. Mutated steps sound at
  once and reach the document through the readout once per GATE cycle as one batch, without an undo step (as from the
  DICE input).

**Storage.** Every lane step and lane setting is a hidden param of the module (8 patterns × 6 lanes × 16 steps plus
LEN, RATE, lock and STEP / PLAYED per lane, about 800): undo, saving, DICE writes and migration work as for STAGES'
hidden params; R leaves them alone. The engine holds all eight patterns, so PAT switches without a message. If the
200-module benchmark shows a cost, the engine may pack them differently; the document does not change.

**Migration** (when a document is opened):

- A RHYTHM whose GATE feeds a STAGES' ADV merges with it into one META-SEQ in the STAGES' place: STAGES' stages →
  the NOTE lane (PLAYED); RHYTHM's pads → GATE and TIE (OFF / ON / TIE), accents → ACC; each module's LEN → its lanes'
  LEN; an EUCLID pattern is written out as steps. Cables move: CLK, RST, DICE from RHYTHM; CV, GATE, ACC; EOC from
  RHYTHM. Revision 34 (as built): stage k sounds on RHYTHM's k-th hit, so a slide on stage k lands on TIE at RHYTHM's
  k-th gate hit (not on step k); the merged gates come from RHYTHM only — STAGES' ○ pulse rests are not carried.
- A RHYTHM alone → META-SEQ with GATE, TIE and ACC; NOTE holds ROOT; a RHYTHM in EUCLID mode gets GEN EUCLID (revision
  34).
- A STAGES line with any note off its SCALE / ROOT opens with SCALE CHR: STAGES never quantised its notes, META-SEQ does
  (revision 34).
- A STAGES alone → META-SEQ with NOTE on STEP and GATE from its pulses. A free-running STAGES (ADV unpatched) gets a cable from
  its frame's CLK out, or outside a frame from a cycling SLOPE placed beside it; the opening notice says the timing may
  differ.
- A 6×2 META-SEQ fits where either stood; STACK frames re-pack on open (revision 32).
- Factory projects and groups and the DICE patch generator are rebuilt on META-SEQ; each is still tested to sound.

**Built in five audible slices:** (1) the engine module and its panel, playing where RHYTHM + STAGES played; (2) the
editor; (3) patterns and PAT; (4) DICE, ⚄ and MUTATE; (5) migration, factory content, and RHYTHM / STAGES removed.

**Tests.** Engine: polymeter (NOTE 7 × GATE 16 repeats after 112 clocks), RATE ×2 / ÷2, PLAYED vs STEP, TIE holds
GATE and glides on a new note, CHNC and DENS by seed, PAT switches only on the GATE wrap, MUTATE from the bank, no
allocation in `process`, the 200-module benchmark with META-SEQ. Core: the three migrations on old-format documents,
generators and ⚄, DICE leaves locked lanes, LEN and RATE alone, the factory sounds and nothing overlaps. UI: the
ghost grid geometry, lane gestures and undo. e2e: a double-click opens the editor, a note drawn, ⌘Z, a pattern
switched, the canvas shrinks above the editor.

## 7c. CLOCK: a tempo without a frame (revision 39)

A frame's own clock (§5) needs a frame around the modules it drives. **CLOCK** is the same clock as a module, placed
anywhere and patched like any trigger source. It adds no global clock (the rule in Goals stands): it is one more
periodic source. Frame clocks, factory patches and DICE are unchanged.

| Family | Module | Inputs | Knobs and options | Outputs | Normals |
|---|---|---|---|---|---|
| Time & logic | **CLOCK** | clk (trigger) | BPM (20–300, linear, default 120, with its mod jack); TAP button | clk (trigger) | — |

- **Size 3 × 1** (one HP each for IN, the control area and OUT): BPM's knob in the two-lane knob row, TAP alone in the
  mode strip. Its document type is `clk` (`clock` is the frame's hidden node, §8). R throws BPM within 80–160.
- **What CLK out carries**, as a frame's CLK out (§5): while a cable is in CLK in, that input after its ratio
  (÷16…×8), and the own clock does not run, so CLOCK is also a divider / multiplier of another clock; otherwise one
  1 ms pulse per beat at BPM. The first beat comes at once when the module enters the patch (added, pasted, a
  document opened) and when CLK in is unpatched.
- **BPM is modulated** like any knob (§2: the mod jack, its attenuverter at the param's `modDepth`); the beat follows
  the modulated value from sample to sample (a phase that runs at BPM / 60 per second), so a modulated tempo bends
  without a jump or a lost beat. The knob's value shows by the quiet-panel rule (§2.9); on a modulated BPM it shows
  always, in the mod colour.
- **TAP** sets BPM from the last taps exactly as a frame's Tap (up to four taps within 2.5 s, at least two;
  20–300). A run of taps on one module is one undo step.
- CLK out flashes on each beat, and CLK in on each event, as every trigger port does (§2).

**Tests.** Engine: 120 BPM gives 20 beats in 10 s and the first at sample 0; a cable in CLK in replaces the own clock
and its ratio applies; a BPM modulated from 60 to 240 speeds the beats with no beat lost or doubled at the change; no
allocation in `process`. Core / UI: CLOCK is in the picker and its spec fits 3 × 1 under the panel grammar; TAP sets
BPM and a run of taps is one undo step.

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
  `groups: { id, name, x, y, w, h, parent, ratio, tint, layout: 'free' | 'stack', muted, collapsed, clock: { on, bpm } }[]`,
  `master` (0…1, default 1).
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
  of a frame detaches it; STACK packs a frame; cables show as stubs and whole on hover / in WIRES; MUTE silences a frame's outgoing
  cables; replace keeps matching cables and knob values; dropping a free module on a cable inserts it; NEW clears and
  undo restores; reload resumes the canvas; ⌘S saves a frame as a group and the picker places it twice with fresh
  ids; ⌘S / ⌘O round-trip a project through the library folder; WIRES lists a frame's wires under it, rewires
  an end from the port list, and shows a FILTER with an empty input under PROBLEMS.
