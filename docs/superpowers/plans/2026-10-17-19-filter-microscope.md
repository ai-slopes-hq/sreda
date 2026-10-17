# Plan 19 — the measuring bench and FILTER under the microscope Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** a native measuring bench that runs a module against a slow, exact reference. FILTER's four resonant
models are rebuilt on it, so DRV and RES work and the level holds on a sine at any cutoff.

**Architecture:** a new workspace crate `bench/` (`sreda-bench`, dev only) holds signals, Newton-solved reference
models at 8×, a frozen copy of today's FILTER, a report writer and WAV renders. The analysis helpers move into the
engine as `measure`, shared by the module tests and the bench under `cfg(any(test, feature = "bench"))`. In the
engine, SVF, LADDER, DIODE and SK become zero-delay-feedback cores with their saturators in the loop, solved by
pivotal (secant) linearisation at 2×. Their RES / DRV laws live in `filter/laws.rs`, which the references share.

**Tech Stack:** Rust (engine crate, a new bench crate), `cargo test`, the existing `Os2x` oversampler and
`dsp::bench::Bench`.

**Spec:**
- `docs/superpowers/specs/2026-10-17-filter-microscope-design.md` (the design; §n below refers to it);
- `docs/superpowers/specs/2026-10-07-canvas-ux-design.md` §7a, "FILTER models", revision 37.

## Global Constraints

- **Audio thread.** Nothing in `Filter::process` or a model's `process` may allocate, lock, log or panic.
  `engine/tests/alloc.rs` must pass. State is f64 with the 1e-20 denormal offset.
- **Rate.** SVF, LADDER, DIODE and SK run at 2× through `Os2x` / `Oversampled`. COMB and VOWEL stay at 1×.
- **Interface.** Ports, knobs (CUT 20…20 000 Hz, RES 0…1, DRV 0…1), MODEL indices (SVF 0 · LADDER 1 · DIODE 2 · SK 3 ·
  COMB 4 · VOWEL 5), the 10 ms model crossfade and `state()` (the glyph's cutoff) do not change. `pnpm specs` must
  produce no diff.
- **Isolation.** The bench never reaches the app or WASM: `sreda-bench` is `publish = false`, and the engine's
  `bench` feature is off by default.
- **Renders** go to `projects/bench/filter/` (git-ignored). The report `bench/reports/filter.md` is committed.
- **Commits.** `pnpm check` passes before every commit. Commits end with
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Code, docs and commits are in English.
- **Status.** At the end of every task, update `docs/ROADMAP.md`'s Status and commit it with the task.
- **Checkpoints.** Stop after Tasks 2, 3, 4, 5 and 6, each a listening checkpoint: give the owner the render paths
  and the report's summary, and wait.

## Review Focus

- **Cutoff at the top.** CUT 20 kHz is clamped to 0.49·sr, so the 2× core sees about 0.245 of its rate. With RES 1
  and DRV 1 it must stay finite and bounded. Pinned in Task 3 (`the_top_cutoff_at_full_resonance_stays_bounded`,
  run for each model as it lands).
- **The device runs at 96 kHz.** Self-oscillation must still sit on CUT. Pinned in Task 3
  (`self_oscillation_tracks_cut_at_96k`, per model).
- **RES pulled down from 1.** The ringing must die away; the pivot state must not latch the oscillation. Pinned in
  Task 3 (`lowering_res_releases_the_oscillation`, per model).
- **RES modulated at audio rate near the top** (an LFO or audio on RES's mod jack) must stay finite. Pinned in Task 3
  (`audio_rate_res_stays_finite`, per model).
- **A hot input** (+12 dBFS, e.g. after DRIVE): finite, and the output peak at most +12 dBFS. Pinned in Task 3
  (`a_hot_input_stays_bounded`, per model).

---

### Task 1: `measure`, the bench crate and the FILTER tests on it

Behaviour does not change in this task: it is plumbing plus a test move.

**Files:**
- Create: `engine/src/measure.rs`, `bench/Cargo.toml`, `bench/src/main.rs`, `bench/src/lib.rs`,
  `bench/src/signals.rs`, `bench/src/wav.rs`
- Modify: `Cargo.toml` (workspace members), `engine/Cargo.toml` (feature `bench`), `engine/src/lib.rs`,
  `engine/src/dsp.rs` (the `bench` module's cfg)
- Move: the tests of `engine/src/modules/filter/mod.rs` to `engine/src/modules/filter/tests.rs`
  (`#[cfg(test)] mod tests;`)

**Interfaces:**
- Produces, in `sreda_engine::measure` (`cfg(any(test, feature = "bench"))`), with amplitudes linear and peak:
  - `pub fn amp_at(s: &[f32], hz: f64, sr: f64) -> f64` — Hann-windowed single-bin DFT, scaled so a sine of peak
    `a` reads `a`;
  - `pub fn harmonics(s: &[f32], f0: f64, sr: f64, n: usize) -> Vec<f64>` — amplitudes of f0…n·f0;
  - `pub fn thd_db(s: &[f32], f0: f64, sr: f64) -> f64` — harmonics 2…10 (below 0.45·sr) over the fundamental;
  - `pub fn rms_db(s: &[f32]) -> f64`, `pub fn peak(s: &[f32]) -> f64`, `pub fn db(x: f64) -> f64`;
  - `pub fn welch(s: &[f32], freqs: &[f64], sr: f64) -> Vec<f64>` — today's `spectrum`;
  - `pub fn ringing(s: &[f32], sr: f64) -> Option<f64>` — `Some(Hz)` when the last quarter's energy is at least
    half the first quarter's; the frequency comes from zero crossings, refined by the `amp_at` maximum within
    ±50 cents;
  - `pub fn bounded(s: &[f32], limit: f64) -> bool` — all finite and `|x| ≤ limit`.
- Produces `sreda_engine::dsp::bench::Bench` under `cfg(any(test, feature = "bench"))`.
- Produces, in `sreda_bench::signals`:
  - `sine(hz, dbfs, sr, len)`, `saw(hz, dbfs, sr, len)` (polyBLEP), `noise(dbfs_rms, seed, len)` (`dsp::Rng`) and
    `impulse(amp, len)`, each returning `Vec<f32>`;
  - `fn amp(dbfs: f64) -> f64`.
- Produces `sreda_bench::wav::write(path: &Path, sr: u32, ch: &[&[f32]]) -> io::Result<()>`: 24-bit, today's
  `render_for_the_references` byte layout, with channels interleaved.

- [ ] **Step 1: Write the failing tests for `measure`** in `engine/src/measure.rs`:
  `amp_at_reads_a_sines_peak` (a 0.3-peak 1 kHz sine at 48 k reads 0.3 ± 0.1 dB); `thd_of_a_known_mix` (a sine plus
  its 3rd at 1 % reads −40 ± 0.2 dB); `ringing_finds_a_steady_tone_and_not_a_decay` (a 440 Hz sine → `Some` within
  ±1 cent; an exponentially decaying one (τ 10 ms) → `None`); `bounded_catches_nan`.
- [ ] **Step 2: Run** `cargo test -p sreda-engine measure` and expect FAIL (no module).
- [ ] **Step 3: Implement `measure.rs`** and add `pub mod measure;` with the cfg to `lib.rs`. Add the `bench = []`
  feature, widen `dsp::bench`'s cfg, and create the crate with `signals`, `wav`, a `main.rs` that prints usage for
  no argument and `unknown subject: <x>` for anything else. Add a signals test,
  `signals_have_their_levels` (a −6 dBFS sine peaks at 0.501; −20 dBFS-RMS noise reads −20 ± 0.2 dB RMS).
- [ ] **Step 4: Move the FILTER tests** into `filter/tests.rs` and rebuild `measure_with`, `sine_through`,
  `gain_db`, `fundamental_db` and `spectrum` on `measure`. Every existing assertion and number stays the same.
  Delete `render_for_the_references`, which the bench replaces in Task 2.
- [ ] **Step 5: Run** `pnpm check` and expect PASS, with the same FILTER test names passing as before (minus the
  deleted render).
- [ ] **Step 6: Commit** `refactor: measure helpers shared by tests and the new bench crate (Plan 19, Task 1)`.

### Task 2: the baseline — legacy FILTER, the linear reference, the report, the renders · Checkpoint 1

**Files:**
- Create:
  - `bench/src/refs/mod.rs` and `bench/src/refs/legacy/filter/` (copies of today's `mod.rs`, `svf.rs`,
    `ladder.rs`, `sk.rs`, `comb.rs`, `vowel.rs`, without tests, using `sreda_engine::{dsp, shaping, spec}`);
  - `bench/src/refs/filter/mod.rs`, `bench/src/refs/filter/linear_svf.rs`;
  - `bench/src/subject.rs`, `bench/src/filter.rs` (grid, metrics, renders), `bench/src/report.rs`;
  - `bench/reports/filter.md` (generated, committed).

**Interfaces:**
- Produces, in `sreda_bench::subject`:
  ```rust
  pub trait Subject {
      fn label(&self) -> String;                 // "ours SVF", "legacy LADDER", "ref SVF"
      /// LP, BP, HP for `input` at the given knobs; PTCH per sample if `pitch` is Some
      fn render(&mut self, input: &[f32], pitch: Option<&[f32]>, k: Knobs, sr: f64) -> [Vec<f32>; 3];
  }
  #[derive(Clone, Copy)] pub struct Knobs { pub cut: f64, pub res: f64, pub drv: f64, pub model: usize }
  pub struct Engine;  // any engine Dsp through Bench: Engine::filter(), Engine::legacy_filter()
  ```
  A fresh instance runs per `render`.
- Produces, in `sreda_bench::filter`:
  - `pub struct Row { metric: &'static str, model: usize, case: String, ours: f64, legacy: f64, reference:
    Option<f64>, target: Target }`;
  - `pub enum Target { Within(f64, f64), AtMost(f64), AtLeast(f64), Flag }`;
  - `pub fn grid(models: &[usize]) -> Vec<Row>`;
  - `pub fn renders(dir: &Path)`.
- Produces `sreda_bench::report::markdown(rows: &[Row]) -> String`: one table per metric, with `✗` on values
  outside `target` and on `|ours − reference|` over the §4.7 tolerance.
- Produces `refs::filter::linear_svf::LinearSvf` (Simper's linear SVF at the knob's `k`), which implements `Subject`.
  Its `k` comes from the same law as ours (`laws::svf_k`, Task 3); until Task 3 it takes today's
  `2 − 1.96·res_law` value, copied into the legacy module.

- [ ] **Step 1: Write the failing tests** in `bench/src/refs/filter/linear_svf.rs`:
  - `linear_svf_matches_the_analytic_response`: at 1 kHz cutoff and k ∈ {2, 0.45, 0.1}, LP, BP and HP at 20
    log-spaced frequencies match the analytic bilinear-transformed SVF, `|H_LP| = g²(1+z⁻¹)²/…`, within 0.01 dB;
  - in `bench/src/filter.rs`, `legacy_equals_todays_filter`: the legacy copy and the engine's FILTER produce
    bit-identical output on 20 blocks of the `blockwise_equals_per_sample` input for every model. This holds now and
    is deleted in Task 3, when the engine changes.
- [ ] **Step 2: Run** `cargo test -p sreda-bench` and expect FAIL.
- [ ] **Step 3: Implement** the legacy copy, `LinearSvf`, `Subject` and `Engine`.
- [ ] **Step 4: Implement the grid and the metrics** (§1.2, §4). The grid runs at 48 k unless noted. Each metric
  produces rows for the given models:

  | Metric | Measured as |
  |---|---|
  | `peak` | the §4.1 peak over passband, per cutoff × RES (−30 dBFS sine) |
  | `selfosc` | RES 1, an impulse of 0.01 then silence for 2 s; the last 0.5 s gives `peak` (dBFS) and `ringing` frequency (cents from CUT), per cutoff 100 Hz…5 kHz |
  | `passband` | the LP level change from RES 0 at 0.25× cutoff, per cutoff × RES, at 48 k and 44.1 k |
  | `loud` | a −6 dBFS sine at the cutoff, RES 0.9: output peak over input peak (dB) |
  | `drv` | a 110 Hz −12 dBFS sine, cutoff 1 k, RES 0, DRV 0…1 by 0.25: RMS change (dB) and THD (dB) |
  | `character` | today's `sine_through` harmonics 2 and 3 at RES 0, 0.5 and 0.9 |
  | `split` | the LP / HP crossing over CUT, per cutoff, at 48 k and 44.1 k |
  | `slope` | the LP level drop from 2× to 4× cutoff (dB/oct) |
  | `stable` | §4.6: a pass / fail flag |

  `reference` is filled where a reference exists. In this task that is `LinearSvf` on SVF's `peak`, `passband`,
  `split` and `slope`.
- [ ] **Step 5: Implement `renders`** (§1.3). Each case is rendered for legacy, ours and the reference where one
  exists; the files are named `<model>-<case>-<before|after|ref>.wav`.

  | Case | Signal | Knobs |
  |---|---|---|
  | `sweep` | a −12 dBFS 220 Hz sine, 4 s | CUT swept 100 Hz → 8 kHz exponentially by PTCH, RES 0.9 |
  | `drive` | a −12 dBFS sine at CUT 400 Hz, 4 s | RES 0.5, DRV ramped 0 → 1 |
  | `chord` | three saws (110, 165, 220 Hz) at −18 dBFS each, 4 s | a slow CUT sweep, RES 0.7 |
  | `selfosc` | an impulse | RES 1, PTCH stepping a minor pentatonic over 2 octaves, 0.5 s per note |
- [ ] **Step 6: Wire `main.rs`.** `cargo run -p sreda-bench --release -- filter` runs the grid for every model, writes
  `bench/reports/filter.md` (header: date, commit, "ours = engine at HEAD"), prints it, and writes the renders. Run
  it, and expect the report to show the baseline symptoms:
  - SVF `drv` with no change at any DRV;
  - every `selfosc` on SVF failing;
  - `loud` far over +6 dB on LADDER and DIODE.

  If a symptom does not show, stop and report it: that is a finding.
- [ ] **Step 7: Run** `pnpm check` and expect PASS. **Commit** the code and `bench/reports/filter.md` as
  `feat: the measuring bench with today's FILTER as the baseline (Plan 19, Task 2)`.
- [ ] **Step 8: Checkpoint 1.** Give the owner the `*-before.wav` paths and the report's ✗ rows. Wait.

### Task 3: SVF — the nonlinear Cytomic core · Checkpoint 2

**Files:**
- Create:
  - `engine/src/modules/filter/laws.rs` (`pub mod laws;`);
  - `bench/src/refs/filter/newton.rs`, `bench/src/refs/filter/os8.rs`, `bench/src/refs/filter/svf.rs`.
- Modify:
  - `engine/src/modules/filter/svf.rs` and `engine/src/modules/filter/mod.rs` (SVF joins the oversampled models, and
    `res_law` applies only to the models not yet rebuilt);
  - `engine/src/modules/filter/tests.rs`;
  - `bench/src/filter.rs` (`reference` for SVF);
  - `bench/src/refs/filter/linear_svf.rs` (to `laws::svf_k`).
- Delete: `legacy_equals_todays_filter`.

**Interfaces:**
- Produces, in `filter::laws` (pub, pure):
  - `pub fn drive_gain(drv: f64) -> f64`, which is `10^drv` (§2);
  - `pub fn secant(y: f64, v: f64, slope0: f64) -> f64`, which is `y / v`, or `slope0` when `|v| < 1e-9`;
  - `pub fn sat(v: f64, level: f64) -> f64`, which is `level · tanh(v / level)`;
  - `pub fn svf_k(res: f64) -> f64` and the SVF constants (`SVF_LEVEL` and the output `SVF_DRV_COMP` exponent).
- Produces, in `refs::filter::newton`: `pub fn solve<const N: usize>(guess: [f64; N], f: impl Fn(&[f64; N]) -> [f64;
  N]) -> Result<[f64; N], f64>`. It takes Newton steps with a central-difference Jacobian (h = 1e-7) and Gaussian
  elimination; the tolerance is `|Δ| < 1e-9` within 50 iterations, and `Err` carries the last residual.
- Produces, in `refs::filter::os8`: `pub struct Os8` with `up(&[f32]) -> Vec<f64>` and `down(&[f64]) -> Vec<f32>`:
  a windowed-sinc FIR with 255 taps, Kaiser β 10, cutoff 0.45 of the base rate, with its latency removed.
- Produces `refs::filter::svf::NewtonSvf: Subject`, the same circuit solved implicitly at 8×.
- Produces, in `filter/tests.rs`, the acceptance helpers every model task reuses (Tasks 4–6 add their model to
  `REBUILT`):
  - `fn peak_over_passband(m: usize, cut: f64, res: f64, sr: f64) -> f64`;
  - `fn self_osc(m: usize, cut: f64, sr: f64) -> Option<(f64, f64)>` returning (dBFS, cents from CUT);
  - `fn passband_change(m: usize, cut: f64, res: f64, sr: f64) -> f64`;
  - `fn loud_gain(m: usize, cut: f64) -> f64`;
  - `fn drv_curve(m: usize) -> [(f64, f64); 5]` returning (RMS change dB, THD dB);
  - `const REBUILT: &[usize]`.

The SVF step at the 2× rate. `x` is the input sample, `ic1` and `ic2` are the states, `p` is last sample's band
value:

```text
G = drive_gain(drv);  u = sat(G·x, SVF_LEVEL)
r = 2 − svf_k(res)                      // the resonance part of the damping
a = secant(sat(p, SVF_LEVEL), p, 1)     // the band saturator's secant gain
k_eff = 2 − r·a
v1 = (g·(u − ic2) + ic1) / (1 + g·(g + k_eff))
v2 = ic2 + g·v1
hp = u − (2·v1 − r·sat(v1, SVF_LEVEL)) − v2
ic1 = 2·v1 − ic1;  ic2 = 2·v2 − ic2;  p = v1
LP = v2 · G^(−SVF_DRV_COMP),  BP = v1 · (same),  HP = hp · (same)
```

The damping is `2·v1 − r·sat(v1)`. For small signals it is exactly `k·v1`, the linear Cytomic SVF. For large ones
the linear `2·v1` wins, which bounds the self-oscillation.

`svf_k` starts as `2·e^(−3·res) − 0.15·res^16`. That gives k ≈ 0.447 at 0.5 (+7 dB), ≈ 0.106 at 0.9 (≈ +19.5 dB),
> 0 at 0.95 and ≈ −0.05 at 1. Tune it only if the tests demand. `SVF_LEVEL` sets the self-oscillation amplitude
(tune to −6 dBFS). `SVF_DRV_COMP` sets the DRV loudness (tune for ±3 dB).

`NewtonSvf` solves the same two stage equations for `(v1, v2)`, with the true `sat` in place of the secant, per 8×
sample, and the same `u`.

- [ ] **Step 1: Write the failing tests** in `filter/tests.rs`, each looping over `REBUILT` (now `[SVF]`):
  - `res_peaks_alike_at_every_cutoff`: `peak_over_passband` at cutoffs 200, 1 000 and 5 000 Hz is 7 ± 2 at RES 0.5
    and 20 ± 3 at RES 0.9;
  - `every_rebuilt_model_self_oscillates_at_res_1_only`: `self_osc` is `None` at RES 0.95. At 1 it is `Some`, with
    the level −6 ± 3 dBFS and the pitch within ±20 cents, at 100, 1 000 and 5 000 Hz;
  - `ptch_plays_the_self_oscillation`: PTCH +1 at CUT 500 Hz → 1 000 Hz ± 20 cents;
  - `the_passband_holds_at_every_cutoff`: `|passband_change| ≤ 1` at 200, 1 000 and 5 000 Hz, at RES 0.5 and 0.9,
    at 48 k and 44.1 k;
  - `a_loud_sine_at_the_cutoff_runs_into_saturation`: `loud_gain ≤ 6` dB at 200, 1 000 and 5 000 Hz;
  - `drv_is_loudness_matched_and_dirties`: every RMS change within ±3 dB, THD strictly rising, and THD at DRV 1
    ≥ −20 dB;
  - `lp_and_hp_split_at_the_cutoff_up_to_10k`: at 200, 1 000, 5 000 and 10 000 Hz, at 48 k and 44.1 k, the
    crossing is within ±5 % of CUT. It replaces the 1 kHz-only split test for the rebuilt models.
  - `audio_rate_cut_at_full_resonance_stays_finite`: PTCH is a 1 kHz sine of ±2 octaves, RES 1, on noise and on a
    saw, `bounded(…, 4.0)`.
  - `self_oscillation_holds_for_a_minute`: 60 s at RES 1 and 1 kHz; the RMS of the last second is within 1 dB of
    the second second's.
  - the five Review Focus tests, each for every model in `REBUILT`:
    - `the_top_cutoff_at_full_resonance_stays_bounded`: CUT 20 kHz, RES 1, DRV 1, a −6 dBFS saw for 2 s,
      `bounded(…, 4.0)` (+12 dBFS);
    - `self_oscillation_tracks_cut_at_96k`: at 1 kHz, ±20 cents;
    - `lowering_res_releases_the_oscillation`: 1 s at RES 1, then RES 0.5; after 0.5 s the level is below −60 dBFS;
    - `audio_rate_res_stays_finite`: RES driven by a 500 Hz sine 0.9 ± 0.1 per sample, on noise, `bounded(…, 4.0)`;
    - `a_hot_input_stays_bounded`: a +12 dBFS saw at RES 0.9 and DRV 1, `bounded(…, 4.0)`.
  - Rewrite `the_svf_is_the_cytomic_core_at_the_res_law` as `at_drv_0_and_small_signals_the_svf_is_linear_cytomic`.
    At −60 dBFS input, the LP output matches `LinearSvf` at `svf_k(0.7)` within 0.05 dB on `amp_at` at 5 frequencies.
    This is not bit-exact, because of the 2× path.
  - Keep `each_model_saturates_like_its_reference` (SVF clean).
- [ ] **Step 2: Run** `cargo test -p sreda-engine filter` and expect the new tests to FAIL on SVF.
- [ ] **Step 3: Implement `laws.rs` and the SVF** as above. In `mod.rs`:
  - SVF moves into `Oversampled<Svf>`, and `oversampled()` includes it;
  - `run` applies `res_law` and `comp` only to `matches!(model, LADDER | DIODE | SK)`;
  - rebuilt models take the knob's RES and DRV as they are.
- [ ] **Step 4: Run** `cargo test -p sreda-engine filter` and expect PASS. Tune only the three SVF constants.
- [ ] **Step 5: Implement `newton.rs`, `os8.rs` and `NewtonSvf`**, with these tests:
  - `newton_solves_a_known_system`: a 2×2 nonlinear system with a known root;
  - `os8_round_trip_is_transparent`: a 1 kHz sine up and down within 0.01 dB, with no latency;
  - `newton_svf_converges_on_the_grid_corners`: CUT 50 Hz and 10 kHz, RES 1, DRV 1, a −6 dBFS saw.
- [ ] **Step 6: Run the bench** (`cargo run -p sreda-bench --release -- filter`). Every SVF row must be within target
  and within the §4.7 tolerance of `ref`. If ours misses the reference (§4.7), replace the single secant step with 2–3
  Newton iterations on `v1` in `svf.rs`, re-run, and note it in the commit.
- [ ] **Step 7: Run** `pnpm check` and expect PASS, including the DICE and factory render tests in Vitest. If a
  render leaves −40…−3 dBFS, report it; do not tune DICE in this task. **Commit** the code, the report and the ROADMAP
  Status as `feat: FILTER SVF — nonlinear Cytomic core with DRV and self-oscillation (Plan 19, Task 3)`.
- [ ] **Step 8: Checkpoint 2.** Give the owner the `svf-*-{before,after,ref}.wav` paths and the SVF rows. Wait.

### Task 4: LADDER — the ZDF transistor ladder · Checkpoint 3

**Files:**
- Modify: `engine/src/modules/filter/ladder.rs` (LADDER only; DIODE keeps `Ladder<3>` until Task 5, so move today's
  generic code to `ladder_legacy.rs`, used only by DIODE), `filter/mod.rs`, `filter/laws.rs`, `filter/tests.rs`
  (`REBUILT` gains LADDER).
- Create: `bench/src/refs/filter/ladder.rs` (`NewtonLadder: Subject`).

**Interfaces:**
- Consumes `laws::{drive_gain, secant, sat}`, `newton::solve`, `Os8`, and the Task 3 test helpers.
- Produces `laws::ladder_k(res: f64) -> f64` (0 → slightly above 4), and `LADDER_BIAS` (keep 0.016),
  `LADDER_LEVEL`, `LADDER_DRV_COMP`.

The LADDER step at 2×. Stage `n` (1…4) has state `s[n]`. The stage curve is
`f(y) = sat(y + LADDER_BIAS, LADDER_LEVEL) − sat(LADDER_BIAS, LADDER_LEVEL)`, `a[n] = secant(f(p[n]), p[n], f′(0))`
with `p` last sample's stage outputs, and `a[0]` the same for the input `u`:

```text
G = drive_gain(drv);  x' = G·x;  k = ladder_k(res)
stage n: y[n] = (g·a[n−1]·y[n−1] + s[n]) / (1 + g·a[n])   =  A[n]·y[n−1] + B[n]
fold: y4 = P·u + Q                                         (P = ΠA, Q from the B's)
u = (1 + k)·x' − k·y4      (bass compensation: DC gain 1 at any k)
y4 = (P·(1 + k)·x' + Q) / (1 + k·P);  u from it; then y1…y4 forward
v[n] = g·(f(y[n−1]) − f(y[n])) with the true f;  s[n] = y[n] + v[n]  (y[0] = u)
LP = y4,  BP = 2·(y1 − y2),  HP = u − 2·y1 + y2,  all · G^(−LADDER_DRV_COMP)
```

`ladder_k` starts with the SVF law's shape, `K·(1 − e^(−a·res))/(1 − e^(−a)) + b·res^16`. Fit `K`, `a` and `b` so
that the peak tests hold, there is no ringing at 0.95, and it rings at 1. `NewtonLadder` solves the four stage
equations implicitly for `y1…y4` with the true `f`.

- [ ] **Step 1: Add LADDER to `REBUILT`.** Run `cargo test -p sreda-engine filter` and expect the shared tests to
  FAIL for LADDER. Remove LADDER from the old `res_means_the_same_on_every_model` list.
- [ ] **Step 2: Implement the core and its laws.** Run, expect PASS, and tune only the LADDER constants.
  `each_model_saturates_like_its_reference` must still hold for LADDER (2nd / 3rd ≈ −55 / −49 at RES 0, ±6 dB). If
  the new core honestly lands outside that, keep the test failing, stop, and report to the owner with the numbers.
- [ ] **Step 3: Implement `NewtonLadder`** with `newton_ladder_converges_on_the_grid_corners`. Run the bench. The
  LADDER rows must be within target and tolerance; on a miss, use Newton iterations on `y4` in `ladder.rs` (§4.7).
- [ ] **Step 4: Run** `pnpm check` and expect PASS. **Commit** with the report and the Status as
  `feat: FILTER LADDER — ZDF transistor ladder, bass compensation in the loop (Plan 19, Task 4)`.
- [ ] **Step 5: Checkpoint 3.** Give the owner the LADDER renders and rows. Wait.

### Task 5: DIODE — the ZDF diode ladder · Checkpoint 4

**Files:**
- Modify: `engine/src/modules/filter/diode.rs` (new; DIODE leaves `Ladder<3>`), `filter/mod.rs`, `filter/laws.rs`,
  `filter/tests.rs` (`REBUILT` gains DIODE, and the slope test says DIODE's measured slope).
- Delete: `ladder_legacy.rs`.
- Create: `bench/src/refs/filter/diode.rs`.

**Interfaces:**
- Produces `laws::diode_k(res)`, `DIODE_LEVEL`, `DIODE_DRV_COMP`, `DIODE_TUNE` (the pole scale that puts the
  resonance on CUT).

The core is Zavalishin's ZDF diode ladder (*The Art of VA Filter Design*, rev. 2.1.2, §5.10): four coupled
one-poles, the first coupled to the second with weight 1 and the rest with ½. The linear 4×4 system is solved per
sample in closed form, as in the book. A `sat(·, DIODE_LEVEL)` sits on the input after the feedback sum, with its
secant from the last sample, and bass compensation is as LADDER's. Today's input asymmetry (`4e-4·x²`, DFM's faint
2nd) stays. LP is stage 4, and BP / HP are the first two stages' taps, as LADDER's. `NewtonDiode` solves the same
system implicitly.

- [ ] **Step 1: Add DIODE to `REBUILT`, run, and expect FAIL.** In `each_model_has_its_slope`, DIODE expects
  18 ± 3 dB/oct.
- [ ] **Step 2: Implement it, run, and expect PASS.** If the slope lands outside 18 ± 3 dB/oct, set the test to the
  measured value ± 2 and record the number for Task 7's spec line. Do not bend the core to it.
- [ ] **Step 3: Implement `NewtonDiode`** with its convergence test. Run the bench; the DIODE rows must be within
  target and tolerance.
- [ ] **Step 4: Run** `pnpm check` and expect PASS. **Commit** with the report and the Status as
  `feat: FILTER DIODE — ZDF diode ladder (Plan 19, Task 5)`.
- [ ] **Step 5: Checkpoint 4.** Wait.

### Task 6: SK — the Korg35 · Checkpoint 5

**Files:**
- Modify: `engine/src/modules/filter/sk.rs`, `filter/mod.rs` (`res_law`, `RES_LAW`, `comp`, LADDER's `half` and the
  `matches!` gate all go: no model uses them now), `filter/laws.rs`, `filter/tests.rs` (`REBUILT` = all four; delete
  `res_means_the_same_on_every_model`, `print_res_tables` and `measure_with`'s `raw` path).
- Create: `bench/src/refs/filter/sk.rs`.

**Interfaces:**
- Produces:
  - `laws::sk_k(res)` (the Korg35 `K`: 0 → just past 2);
  - `pub fn diode_clip(v: f64) -> f64` (asymmetric: `tanh(1.2·v)/1.2` for v ≥ 0, `tanh(0.8·v)/0.8` below; keep
    unless the character test asks otherwise);
  - `SK_LEVEL`, `SK_DRV_COMP`.

The core is the Korg35 low-pass after Will Pirkle's application note *Virtual Analog (VA) Korg35 Lowpass Filter*:
LPF1 → LPF2, with an HPF in the feedback scaled by K. It is solved in ZDF form as in the note, with `diode_clip` in
the feedback path linearised by its secant. Around it:
- DRV goes into an input `sat`;
- the faint input asymmetry (`EVEN`, 0.0016) is kept;
- RES³ still blends the input clip (today's grit growing with RES).

The outputs:
- LP is LPF2;
- BP is LPF2's input minus LPF2's output, normalised to 0 dB at its peak;
- HP is `x − LP − d·BP`, with `d` the damping at the current K.

`NewtonSk` solves the same loop implicitly.

- [ ] **Step 1: Add SK to `REBUILT`, run, and expect FAIL.** Also run `each_model_has_its_slope` (SK 12 dB/oct) and
  `each_band_pass_peaks_near_the_cutoff` for SK.
- [ ] **Step 2: Implement it, run, and expect PASS.** **Fallback (§8):** if the BP / HP taps cannot meet 12 dB/oct
  and the BP peak within ±10 %, build SK instead as the SVF core of Task 3 with `diode_clip` as its band saturator
  plus today's input grit. In that case `NewtonSk` models that, and the Korg35 reference stays only for LP, in the
  report. Say so in the commit.
- [ ] **Step 3: Implement `NewtonSk`** with its convergence test, and run the bench.
- [ ] **Step 4: Run** `pnpm check` and expect PASS. **Commit** with the report and the Status as
  `feat: FILTER SK — Korg35 core; the RES tables go (Plan 19, Task 6)`.
- [ ] **Step 5: Checkpoint 5.** Wait.

### Task 7: tails — COMB / VOWEL on the bench, budget, documents

**Files:**
- Modify: `bench/src/filter.rs` (COMB and VOWEL in the `stable`, `loud` and `passband` metrics; no reference),
  `docs/superpowers/specs/2026-10-07-canvas-ux-design.md` (revision 37's slope for DIODE if Task 5 measured another),
  `docs/backlog.md`, `docs/ROADMAP.md`.

- [ ] **Step 1: Run the bench for all six models.** COMB and VOWEL must pass `stable`. If their `loud` exceeds
  +6 dB or their `passband` jumps, add the finding to `docs/backlog.md` ("From Plan 19"); do not redesign them.
- [ ] **Step 2: Check the budget.** `cargo test --release -p sreda-engine --test realtime -- --ignored`: the 200-module
  patch must be at or below 26 % of real time. Record the number. Over budget, profile FILTER first: the SVF's 2×
  and any Newton iterations added in Tasks 3–6.
- [ ] **Step 3: Update the documents.**
  - Close the backlog's "From listening" FILTER entry with a pointer to this plan.
  - Correct the spec's DIODE slope if Task 5 measured another.
  - ROADMAP Status: Plan 19 done, with the numbers (realtime %, models within tolerance), and **Next:** the next
    module under the microscope, the owner's choice.
- [ ] **Step 4: Run** `pnpm check` and expect PASS. **Commit**
  `docs: Plan 19 done — FILTER under the microscope (Plan 19, Task 7)`.
- [ ] **Step 5: Final review.** Run `/code-review` on the branch, fix what it confirms, and run `pnpm check` again.
