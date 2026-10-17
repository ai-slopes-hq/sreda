# SREDA 2 — modules under the microscope: the measuring bench and FILTER

Date: 2026-10-17 · Revision 1 · Status: draft, awaiting review

## Why

The owner hears FILTER misbehave on a sine (`docs/backlog.md`, "From listening (2026-10-17)"). Three symptoms:

1. **DRV does nothing.** SVF, the default model, ignores DRV (`svf.rs` takes `_drive`).
2. **RES does not sing.** SVF's resonance stops at Q ≈ 25 and never self-oscillates. The RES law (`RES_LAW`) is a
   table fitted at a 1 kHz cutoff on white noise only, so "+7 dB at 0.5" may mean something else at other cutoffs.
3. **The level jumps.** LADDER and DIODE multiply their LP output by a passband compensation of up to ×4.5 and ×7.7.
   A sine near the cutoff at high RES comes out far louder than it went in, and nothing inside the loop limits it.

Plan 11 matched FILTER to Ableton's Auto Filter by ear and by a few numbers (110 Hz sine in the passband, noise at
1 kHz). Nobody measured a sine at or above the cutoff, other cutoffs, or the models against a known-correct
implementation. LADDER and DIODE use Huovilainen's explicit-integration model, whose cutoff and resonance drift at
high frequencies.

This is the first module of the phase "every module under the microscope" (`docs/ROADMAP.md`). The phase needs a
way to measure a module against a reference, so the bench built here is meant for DRIVE, FOLD, LPG, REVERB and OSC
later.

**Success:**

- The owner hears DRV and RES work on every resonant model and on a sine at any cutoff.
- The numbers in §4 hold on 50 Hz…10 kHz cutoffs at 44.1 and 48 kHz and are pinned in `cargo test`.
- The bench report shows our models within tolerance of their Newton-solved references.

## Out of scope

- COMB and VOWEL get only a bench run for stability and level, no redesign.
- No new models, ports, knobs or outputs. No document migration: knob values keep their meaning by name, and the
  sound changes.
- Rendering references through third-party plugins (Vital, Surge XT). The references are written in code from
  published papers. Plan 11's Ableton renders (`projects/refs/filter/`) stay as character targets.
- Running the full bench in `pnpm check`.

## 1. The measuring bench (`bench/`, crate `sreda-bench`)

A new workspace member, `publish = false`. It depends on `sreda-engine` with a new feature `bench`. The feature
exposes `dsp::bench::Bench` (today `#[cfg(test)]`) and a new `dsp::measure` module, both under
`cfg(any(test, feature = "bench"))`. Nothing of the bench reaches the app or the WASM build.

### 1.1 Parts

- **`signals`** — a sine (fixed or swept), a polyBLEP saw, white noise (seeded), a unit impulse; levels in dBFS.
- **`dsp::measure`** (in the engine, shared with the module tests) — a Hann window and single-bin DFT (Goertzel):
  harmonic levels, THD, RMS, the frequency response from an impulse or a swept sine. Also two detectors:
  - **self-oscillation:** the tail's energy is at least half the head's; the ringing frequency comes from
    zero-crossings refined by the DFT peak;
  - **stability:** NaN, ±inf, or growth beyond +40 dB over the input.

  FILTER's test helpers (`measure_with`, `sine_through`, `spectrum`, `gain_db`, `fundamental_db`) move here.
- **`refs/`** — reference models, slow and exact:
  - `refs/filter/linear_svf.rs` — Cytomic's linear trapezoidal SVF from Andy Simper's paper (*Linear Trajectory
    Analysis of the SVF*, 2013). It is checked against the analytic biquad response.
  - `refs/filter/{svf, ladder, diode, sk}.rs` — the same circuits as ours (§3), with the same nonlinearities, solved
    with Newton's method to convergence (|Δ| < 1e-9, at most 50 iterations), at 8× oversampling, in f64.
  - `refs/legacy/filter/` — a frozen copy of today's FILTER (Huovilainen ladder, `RES_LAW`, output compensation),
    for the "before" renders and the baseline report.
- **`runner`** — runs any `Dsp` (our FILTER whole, through `Bench`, as the engine sees it) and any reference model
  over the same grid.

### 1.2 The FILTER grid

| Axis | Values |
|---|---|
| Cutoff | 50, 200, 1 000, 5 000, 10 000 Hz |
| Sine frequency | 0.25×, 1×, 4× the cutoff |
| Sine level | −30, −6 dBFS peak |
| RES | 0, 0.5, 0.9, 0.95, 1 |
| DRV | 0, 0.5, 1 |
| Other signals | a 110 Hz saw, white noise, an impulse |
| Sample rate | 48 kHz everywhere; 44.1 kHz on the cutoff and passband checks |

### 1.3 Output

`cargo run -p sreda-bench --release -- filter`:

- writes and prints `bench/reports/filter.md`: one table per metric (§4), ours against the reference per model,
  with values outside tolerance marked `✗`;
- writes A / B renders, 2–4 s each, to `projects/bench/filter/` (git-ignored, rebuilt by the command): a sine
  sweeping the cutoff at RES 0.9; a sine at the cutoff with DRV rising 0 → 1; a saw chord through a slow cutoff
  sweep; self-oscillation played by PTCH. Each in three versions, `before` (legacy), `after` (ours) and `ref`, named
  `<model>-<case>-<version>.wav`.

The report is committed as a snapshot of the numbers. The renders are not.

### 1.4 Tests of the bench itself

Fast, in `cargo test` (so in `pnpm check`): the analysis finds the harmonics of a known synthetic signal within
0.1 dB; the linear reference matches the analytic response within 0.01 dB; each Newton reference converges on the
grid's corners.

### 1.5 Later modules

A module joins the bench with its own `refs/<module>/`, its grid and its report: `cargo run -p sreda-bench --release
-- <module>`.

## 2. Shared structure of the four resonant models

- **Core:** a zero-delay-feedback trapezoidal core (TPT / ZDF), cutoff prewarped (`g = tan(π·fc / sr)`), f64
  state with the existing 1e-20 denormal offset.
- **Rate:** 2× through the existing `Os2x` up-sampler and `Oversampled` down-samplers. SVF joins LADDER, DIODE and
  SK there, because it becomes nonlinear.
- **Nonlinearity in the loop, solved cheaply:** pivotal (secant) linearisation after Zavalishin (*The Art of VA
  Filter Design*, rev. 2.1.2, §6). Each saturator `s(v)` is replaced for one sample by its secant gain
  `s(v₀)/v₀`, with `v₀` that saturator's argument at the previous sample. The resulting linear ZDF system is solved
  in closed form, and the nonlinear outputs are then evaluated at the solved arguments. One evaluation per sample,
  no iteration.
- **DRV:** input gain 0…+20 dB (`10^(DRV)`) into the in-loop saturation. The output is brought back by the loudness
  law of §4.3.
- **Passband compensation inside the loop:** never as an output multiplier. A loud sine at the cutoff runs into the
  saturation instead of being multiplied.
- **Unchanged:** MODEL switching with a 10 ms crossfade, ports, knobs, the response glyph and its readout.

## 3. The models

### 3.1 SVF (after Vital and Surge)

Cytomic's core. Two saturators:

- a soft `tanh` on the input, driven by DRV;
- a `tanh` on the band state in the resonance loop.

`k` runs from 2 (no resonance) at RES 0 to slightly below 0 at RES 1. There the filter self-oscillates and the band
state's `tanh` holds the amplitude. At DRV 0 and small signals the model is the linear Cytomic SVF, and the bench
checks it against the analytic response.

### 3.2 LADDER (Moog)

Zavalishin's ZDF four-pole transistor ladder:

- a `tanh` at each stage's input;
- the stage bias kept for the 2nd harmonic (spec revision 28);
- bass compensation in the loop, `u = x − k·(y₄ − x)`, so the DC gain is 1 at any RES;
- `k` from 0 to slightly above 4, where it self-oscillates.

LP is the fourth pole. BP and HP are today's multimode taps of the first two stages: `BP = 2·(y₁ − y₂)` and
`HP = u − 2·y₁ + y₂`.

### 3.3 DIODE (TB-303)

Zavalishin's ZDF diode ladder: four coupled stages with a `tanh` at the input, bass compensation as LADDER's. The
coupling gives about 18 dB/oct near the cutoff. The bench measures the slope, and if it lands elsewhere the main
spec records the measured slope. BP and HP come from the first two stages, as LADDER's.

### 3.4 SK (MS-20)

The Korg35 Sallen-Key low-pass, a ZDF second-order core after Will Pirkle's application note *Virtual Analog (VA)
Korg35 Lowpass Filter* and Zavalishin, with these saturators:

- an asymmetric diode clipper in the feedback path, harder than `tanh`: the MS-20's scream and the grit that grows
  with RES;
- self-oscillation at RES 1;
- DRV into an input clip;
- the faint 2nd harmonic of revision 28 (input asymmetry) kept.

LP is the Korg35 output. BP is the second stage's input minus its output (its one-pole high-pass part),
normalised to 0 dB at its peak. HP is what the SVF identity leaves, `x − LP − d·BP`, with `d` the damping at the
current RES. The bench checks the slopes (§4.5) and the BP peak; §8 says what happens if they miss.

### 3.5 What goes

- `RES_LAW` and `print_res_tables`;
- the output compensation (`comp`) and LADDER's `half` split;
- the Huovilainen ladder;
- SVF's linear-only core.

They survive only in `bench/refs/legacy/`.

## 4. Laws and acceptance numbers

All numbers hold at cutoffs 50 Hz…10 kHz, at 48 kHz, and at 44.1 kHz where marked. "Small" is a −30 dBFS-peak
sine; "loud" is −6 dBFS.

### 4.1 RES

- **Peak.** A small sine at the cutoff peaks +7 ± 2 dB at RES 0.5 and +20 ± 3 dB at RES 0.9, against RES 0, on
  every model and every cutoff. The RES → `k` law is analytic per model (no tables).
- **Self-oscillation.** None at RES 0.95. At RES 1 every model self-oscillates, SVF included.
- **Self-oscillation as an oscillator.** With no input, after a click:
  - amplitude −6 ± 3 dBFS peak;
  - frequency within ±20 cents of CUT on 100 Hz…5 kHz;
  - PTCH +1 doubles it within ±20 cents.

### 4.2 Level

- **Passband.** A small sine at 0.25× the cutoff stays within ±1 dB of its RES 0 level at any RES (as revision 28).
  Also at 44.1 kHz.
- **Loud at the cutoff.** A loud sine at the cutoff at RES 0.9 comes out at most +6 dB over the input (≤ 0 dBFS
  peak). A small one gets the full peak of §4.1.

### 4.3 DRV

A 110 Hz sine at −12 dBFS, cutoff 1 kHz, RES 0, DRV 0 → 1 in steps of 0.25:

- the output RMS stays within ±3 dB of DRV 0 (loudness-matched);
- THD rises monotonically from the model's clean value to −20 dB or louder at DRV 1.

### 4.4 Character at DRV 0 (spec revision 28, kept)

A 110 Hz sine at −14 dBFS, cutoff 1 kHz, ±6 dB on the 2nd and 3rd harmonics:

| Model | Character |
|---|---|
| SVF | clean |
| LADDER | 2nd and 3rd near −55 / −49 dB at RES 0, cleaner as RES rises |
| DIODE | a steady 3rd near −55 dB at any RES |
| SK | clean at RES 0; the 3rd grows with RES (about −61 dB at 0.9); a faint 2nd near −75 dB |

If a new core honestly lands elsewhere, the report shows it and the owner decides at that model's checkpoint.

### 4.5 Cutoff and slope

- LP and HP split at the cutoff within ±5 % up to 10 kHz, at 48 and 44.1 kHz.
- PTCH +1 doubles the cutoff.
- Slopes: SVF and SK 12 dB/oct, DIODE about 18, LADDER 24.
- Each BP peaks within ±10 % of the cutoff.

### 4.6 Stability

All of these stay finite: no NaN, no unbounded growth.

- Audio-rate modulation of CUT (a 1 kHz sine on PTCH, ±2 octaves) at RES 1 on noise and on a saw.
- DRV 1 with RES 1 on a loud saw.
- Switching MODEL at RES 1, which also stays smooth.
- 60 s of self-oscillation, which keeps its amplitude within 1 dB.

### 4.7 Ours against the reference (bench report only)

| Metric | Tolerance |
|---|---|
| Small-signal response | ±0.5 dB up to 10 kHz |
| Harmonics | ±3 dB, down to −60 dB |
| Self-oscillation amplitude | ±1.5 dB |
| Self-oscillation frequency | ±10 cents |

Where pivotal linearisation misses beyond tolerance (most likely LADDER at high DRV and RES), that model's core
switches to 2–3 Newton iterations per sample on that path.

### 4.8 Budget

- The 200-module patch (`engine/tests/realtime.rs`) stays at or below 26 % of real time natively (23.2 % today).
- `engine/tests/alloc.rs` passes.
- The DICE style renders stay within −40…−3 dBFS.
- The factory groups and projects still sound (their tests pass).

## 5. Tests

- **In `cargo test` (`pnpm check`):**
  - per model, the numbers of §4.1–4.6, at three cutoffs (200 Hz, 1 kHz, 5 kHz), with short buffers;
  - the existing FILTER tests rewritten on `dsp::measure`;
  - the bench's own tests (§1.4).
- **Not in `pnpm check`:** the full grid against the Newton references, run as `cargo run -p sreda-bench --release
  -- filter`.

## 6. Order of work and listening checkpoints

Each step ends with a report and renders. The owner listens at each checkpoint before the next step.

1. **The bench and the baseline.**
   - Build: the crate, signals, `dsp::measure`, the linear reference, `refs/legacy/`.
   - Output: `filter.md` for **today's** FILTER and the `before` renders.
   - **Checkpoint 1:** the owner hears `before`; the report shows the three symptoms as numbers.
2. **SVF.**
   - Build: the core, its Newton reference, the tests.
   - Output: the report and the `before / after / ref` renders.
   - **Checkpoint 2.**
3. **LADDER**, the same. **Checkpoint 3.**
4. **DIODE**, the same. **Checkpoint 4.**
5. **SK**, the same. **Checkpoint 5.**
6. **Tails.**
   - COMB and VOWEL on the bench (stability, level).
   - The DICE, factory and budget checks.
   - Remove the old code.
   - The final review (`/code-review`).

## 7. Documents

- The main spec gets **revision 37**: the "FILTER models" block replaces revision 28's numbers with §4's laws and
  the new behaviour:
  - SVF nonlinear with DRV;
  - every resonant model self-oscillates;
  - the peak runs into saturation;
  - the laws hold at every cutoff.
- `docs/backlog.md`: the "From listening" FILTER entry is closed when step 5 lands.
- `docs/ROADMAP.md`: Status updated after each step.

## 8. Risks

- **Existing patches sound different:** factory groups and projects, DICE, the owner's projects. SVF gets warmer,
  and LADDER and DIODE change level at high RES. This is intended. The checks in §4.8 catch only breakage, not taste.
- **Pivotal linearisation may miss the reference** on some corner. That corner then moves to Newton iterations (§4.7)
  at a CPU cost within §4.8's budget.
- **The Korg35 BP / HP taps are the least certain part.** If they cannot meet §4.5, SK falls back to the SVF core
  with the diode clipper in its loop (today's SK structure, ZDF-solved). The Korg35 reference then stays only for
  its LP.
