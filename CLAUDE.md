# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# SREDA 2

A modular canvas for sketching rhythmic and ambient patches: an Electron app with a Rust engine (WASM, in an
AudioWorklet) and a TypeScript / SolidJS UI. It replaces `../sreda`, whose UX/UI was not good enough. Don't port UI
or UX from `../sreda`.

**Start every session with `docs/ROADMAP.md`**: where the work stands, which plan is running, the working
agreements (answer the user in Russian; native execution with listening checkpoints; spec first). Update its
Status section at the end of each task.

## Commands

```
pnpm install             # if Electron is missing afterwards: node node_modules/electron/install.js
pnpm dev                 # build the WASM engine, start the app with hot reload
pnpm check               # typecheck, ESLint + clippy, cargo test, WASM build, Vitest — run before every commit
pnpm test <path>         # one Vitest file (TS); pnpm test <path> -t '<name>' for one test
cargo test -p sreda-engine <name>   # Rust tests matching <name>
pnpm specs               # after changing a module spec in Rust: regenerate packages/core/src/generated/specs.json
pnpm e2e                 # build the app, then Playwright drives Electron (e2e/)
pnpm wasm                # engine → engine/pkg/sreda_engine.wasm (tests that load WASM need it)
```

The built renderer is served from `app://sreda/` (see `packages/app/src/main/index.ts`), never `file://`, so the
page stays cross-origin isolated; COOP / COEP must appear exactly once per response.

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
