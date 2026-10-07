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
- `canvas.json` — the artifact's board index (positions, titles, launch board).

The files are Design-canvas artboards (`.dc.html`: `{{holes}}`, `sc-for`, `sc-if`); they are references, not code to
ship.

`check/` — headless checks for the boards (Node): `node docs/prototype/check/holes.js <board>.dc.html` checks that
every `{{hole}}` in the template resolves (sc-for / sc-if aware); `node docs/prototype/check/main.js
docs/prototype/Main.dc.html` also drives the canvas through 32 states and gestures. They do not render the page.

## Republishing the live artifact

The artifact holds these files under `project/` (`project/Main.dc.html`, …, `project/canvas.json`). To update it
from the repo, publish with the Artifact tool: `url` = the artifact above, `file_path` = the board you changed (or
`docs/prototype/canvas.json`), and `files` mapping `project/<name>` → `docs/prototype/<name>` for every changed file.
Bump `SAVE_KEY` / `LIB_KEY` in `Main.dc.html` when a change makes old saved state unusable.
