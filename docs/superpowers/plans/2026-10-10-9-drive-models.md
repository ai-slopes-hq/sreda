# DRIVE models — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** DRIVE gets seven clearly different models (SOFT, TUBE, OD, DIST, FUZZ, RECT, DIGI), a BIAS knob and matched
loudness, tuned by ear and against reference renders.

**Architecture:** `engine/src/modules/drive/` becomes a folder like FILTER: one file per model behind a `Shaper` trait
(`pre`, `curve` with its ADAA antiderivative where it has one, `post`), the shared chain in `mod.rs` (gain → bias →
2× oversampled curve → DC blocker → tone → level match → mix with a delayed dry). An offline harmonic analyser
(`engine/tests/harmonics.rs`, ignored) prints each model's first 10 harmonic levels for a 110 Hz sine and compares
with WAV references in `projects/refs/drive/` when present.

**Tech Stack:** Rust (engine), TypeScript (core migration), Vitest, cargo tests.

**Spec:** `docs/superpowers/specs/2026-10-07-canvas-ux-design.md` revision 26, §7a DRIVE.

## Global Constraints

- Russian to the user; English code / commits; commits end with
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`; `git add` explicit files.
- Audio-thread rules; `alloc.rs` zero; realtime budget unchanged (200 modules ≤ 25 % natively).
- Size 6×1; GAIN 0…36 dB (default 12), BIAS −1…1 (0), TONE 0…1 (0.5), MIX 0…1 (1); MODEL default OD.
- Level matched within ±1.5 dB RMS across models at the same GAIN (sine 110 Hz at −6 dBFS, and a drum-like burst).

## Review Focus

1. **Old documents** (MODE SAT / OD / FUZZ, GAIN in 0…24 dB as a knob position) open as SOFT / OD / FUZZ with the
   same GAIN in dB.
2. **Switching model while sound runs**: crossfade 10 ms, no step > 0.5.
3. **BIAS at ±1 with GAIN 36 dB**: finite, no DC at the output (< 0.01 mean over 1 s).

---

### Task 1: Seven models, BIAS, level match (native)

- [ ] **Step 1: Failing tests** (`drive/mod.rs`): every model on a 110 Hz sine at GAIN 18 dB has a distinct
  harmonic signature (pairwise, the 2nd–7th harmonic level vectors differ by ≥ 6 dB in at least two harmonics); SOFT's
  3rd harmonic < DIST's by ≥ 10 dB; TUBE and FUZZ with BIAS 0 still have a 2nd harmonic ≥ −30 dB (built-in
  asymmetry); RECT full-wave (BIAS 1) puts ≥ 80 % of the energy at even harmonics; DIGI's output never exceeds the
  clip level; level match ±1.5 dB across models at GAIN 0, 18 and 36 dB; Review Focus 2 and 3; aliasing: a 5 kHz sine
  at GAIN 36 dB, energy below 4 kHz excluding harmonics < −50 dB relative (oversampling + ADAA); blockwise equals per
  sample; `alloc.rs`. core `doc.test.ts`: Review Focus 1 migration.
- [ ] **Step 2:** → FAIL. **Step 3:** Implement; `pnpm specs`; fixtures.
- [ ] **Step 4:** `pnpm check && pnpm e2e`; realtime.
- [ ] **Checkpoint for the user (stop):** a saw and a drum loop through each model, BIAS swept, against Ableton.
- [ ] **Step 5:** Commit `feat: DRIVE — seven models, BIAS, matched loudness`.

### Task 2: Tune against the reference renders (native, when `projects/refs/drive/` holds them)

- [ ] `cargo test -q --release -p sreda-engine --test harmonics -- --ignored --nocapture` prints, per model and its
  reference, harmonics 1–10 in dB and the RMS level; adjust each model's curve, pre / post filters and level until
  harmonics 2–7 are within ±4 dB of its reference at the matched gain (SOFT ↔ Saturator Soft Sine, OD ↔ Pedal
  Overdrive, DIST ↔ Pedal Distortion, FUZZ ↔ Pedal Fuzz, DIGI ↔ Saturator Digital Clip; TUBE and RECT by ear).
- [ ] **Checkpoint for the user (stop):** listen again side by side.
- [ ] Commit `tune: DRIVE models against the references`; update `docs/ROADMAP.md`.
