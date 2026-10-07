# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# SREDA 2

A modular canvas for sketching rhythmic and ambient patches: an Electron app with a Rust engine (WASM, in an
AudioWorklet) and a TypeScript / SolidJS UI. It replaces `../sreda`, whose UX/UI was not good enough. Don't port UI
or UX from `../sreda`.

**Start every session with `docs/ROADMAP.md`**: where the work stands, which plan is running, the working
agreements (answer the user in Russian; native execution with listening checkpoints; spec first). Update its
Status section at the end of each task.

There is no code yet. Plan 1 Task 1 adds the build, lint and test commands (including how to run a single test) here.

## Layout

```
packages/core      TS: document, edits, undo, compile (document → plan), panel layout; specs from generated specs.json
packages/protocol  TS: plan wire format, messages, readout layout, the WASM engine loader
packages/ui        SolidJS: canvas, panels, cables, picker, audio host + worklet glue
packages/app       Electron main / preload / renderer entry (electron-vite)
engine/            Rust crate: engine, every module's spec + DSP, export-specs binary; native tests, WASM build
docs/              ROADMAP, spec, plans, backlog, prototype
```

Imports may only go `core ← protocol`, `core ← ui`, `protocol ← ui`, `ui ← app`; ESLint enforces them. TypeScript
sees Rust only through `specs.json` and the WASM exports. Keep core and protocol out of the UI's HMR / fast refresh.

## Audio thread rules

Nothing in `Engine::process`, a module's `Dsp::process`, or the worklet's `process()` may allocate, lock, await,
do I/O, log or panic. Allocate buffers on construction or when a plan is applied; `engine/tests/alloc.rs` (a
counting global allocator) guards the Rust side. Smooth parameters (knobs glide 10 ms).

The worklet glue is TypeScript running in V8, where these patterns allocate on every call:

- Keep state in class fields, never in closure `let`s, and give every numeric field a numeric initialiser.
- Inside `process()`, don't use spread, `for…of` over Maps, array literals or closures.
- Don't write a double with `cond ? x : coldCall()`. Compute both arms first, then select.
