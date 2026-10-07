# Prototype

The clickable prototype the spec was shaped on (`docs/superpowers/specs/2026-10-07-canvas-ux-design.md`).
Live: https://claude.ai/artifact/UMqXgzfCtvtFLkovmRvJgP (private to its owner).

- `Main.dc.html` — the canvas. Its `<script type="text/x-dc">` holds plain JS that the first build ports to
  TypeScript: module specs and sizes (`SPECS`, `SIZES`, `lay`), frames (`recomputeParents`, `layoutRows`,
  `stackFrame`, `landingFrame`), wire routing (`routePts`, `roundPath`, `cableGeoms`), sequencer generators
  (`euclid`, `genNotes`, `diceModule`), the picker (`pickerItems`), the library (`extractGroup`, `mergeInto`),
  the WIRES editor (`wireSection`, `wireProblems`) and factory content (`SEEDS`, `FACTORY_GROUPS`, `buildWith`).
  `Sim` is a frame-rate stand-in for the engine — silent, not a DSP reference.
- `Anatomy.dc.html`, `Sequencers.dc.html` — static boards.

The files are Design-canvas artboards (`.dc.html`: `{{holes}}`, `sc-for`, `sc-if`); they are references, not code to
ship.

`check/` — headless checks for the boards (Node): `node docs/prototype/check/holes.js <board>.dc.html` checks that
every `{{hole}}` in the template resolves (sc-for / sc-if aware); `node docs/prototype/check/main.js
docs/prototype/Main.dc.html` also drives the canvas through 32 states and gestures. They do not render the page.
