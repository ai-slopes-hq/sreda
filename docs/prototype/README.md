# Prototype

The clickable prototype the spec was shaped on (`docs/superpowers/specs/2026-10-07-canvas-ux-design.md`).
Live: https://claude.ai/artifact/UMqXgzfCtvtFLkovmRvJgP (private to its owner).

- `Main.dc.html` — the canvas. Its `<script type="text/x-dc">` holds plain JS that the first build ports to
  TypeScript: module specs and sizes (`SPECS`, `SIZES`, `lay`), frames (`recomputeParents`, `layoutRows`,
  `stackFrame`, `landingFrame`), wire routing (`routePts`, `roundPath`, `cableGeoms`), sequencer generators
  (`euclid`, `genNotes`, `diceModule`), the picker (`pickerItems`), the library (`extractGroup`, `mergeInto`),
  the WIRES editor (`wireSection`, `wireProblems`) and factory content (`SEEDS`, `FACTORY_GROUPS`, `buildWith`).
  `Sim` is a frame-rate stand-in for the engine — silent, not a DSP reference.
- `Panels.dc.html` (the panel grammar), `SoundPack.dc.html` (milestone 2), `Density.dc.html` (the four density
  variants; "air + quiet" was chosen) — static boards drawn with the same layout function.
- `Anatomy.dc.html`, `Sequencers.dc.html` — older static boards (old units), kept as history.
- `Redesign*.dc.html` — the redesign of 2026-10-16 (spec §1b, revision 35), by the designer: `RedesignScene` (the
  whole screen), `RedesignCloseups` (before / after: module and menu, picker, toolbar and save), `RedesignSidebar` (the
  four tabs), `RedesignSkins` (the new style in all six skins, the new tokens), `RedesignFrames` (frame headers, the
  collapsed block, context hints, the META-SEQ editor). They were drawn from the older prototype, so they still show
  RHYTHM / STAGES and four patterns; where they disagree with spec §1b, the spec wins.
- `canvas.json` — the artifact's board index (positions, titles, launch board).

The files are Design-canvas artboards (`.dc.html`: `{{holes}}`, `sc-for`, `sc-if`); they are references, not code to
ship.

`check/render.js <board>.dc.html <out>.html` renders a static board to plain HTML (renderVals() into its holes,
sc-for / sc-if expanded) so it can be opened or screenshotted; the interactive Main board needs the Design canvas.

`check/` — headless checks for the boards (Node): `node docs/prototype/check/holes.js <board>.dc.html` checks that
every `{{hole}}` in the template resolves (sc-for / sc-if aware); `node docs/prototype/check/main.js
docs/prototype/Main.dc.html` also drives the canvas through 32 states and gestures. They do not render the page.

## Republishing the live artifact

The artifact holds these files under `project/` (`project/Main.dc.html`, …, `project/canvas.json`). A published path
may not contain the word `prototype`, so copy the changed boards to `<scratch>/proto/project/<name>` and publish with
the Artifact tool: `url` = the artifact above, `root` = `<scratch>/proto`, `file_path` = the copied board (it is
served at its path under `root`; more boards go in `files` as `project/<name>` → `project/<name>`).
The live artifact's `Main.dc.html` and `Panels.dc.html` are older than the repository's (not republished since Plan
14); republish them before relying on the live copy.

Bump `SAVE_KEY` / `LIB_KEY` in `Main.dc.html` when a change makes old saved state unusable.
