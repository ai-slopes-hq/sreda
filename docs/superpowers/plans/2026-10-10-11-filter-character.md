# FILTER character after the references — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans.

**Goal:** One resonance law and a steady passband across FILTER's models, each model's saturation matched to its
Ableton reference, and a response glyph that follows the live cutoff (spec revision 28).

**Architecture:** Per model a RES → feedback map and a passband gain compensation (fitted by measurement, tables or
closed forms); saturation stages adjusted per model (LADDER: biased stage tanh; DIODE: input-stage odd saturation
independent of RES; SK: clean forward path, a soft diode clip in the feedback with a slight asymmetry). Measurement
tests reuse the reference analysis (white noise and a 110 Hz sine). FILTER's `state()` reports the live cutoff
(log-normalised) for the glyph; resonance comes from the RES knob readout.

## Global Constraints

- Audio-thread rules; `alloc.rs` zero; realtime unchanged; slopes SVF / SK 12, DIODE ≈ 18, LADDER 24 dB/oct.
- RES peak at 1 kHz: 0.5 → +7 ± 2 dB, 0.9 → +20 ± 3 dB, every model (SVF, LADDER, DIODE, SK); self-oscillation
  only at RES ≥ 0.97. Passband (110 Hz sine RMS) within ±1 dB of RES 0 at RES 0.5 and 0.9.
- Saturation at a 110 Hz sine of 0.21 peak, cutoff 1 kHz, DRV 0: 2nd and 3rd within ±6 dB of the reference values
  in spec revision 28 (where the reference is below −100 dB, ours below −90 dB).
- COMB and VOWEL unchanged. Old documents unchanged (RES positions keep, the sound changes by design).

### Task 1 (native): resonance law, passband, saturation — tests first, then fit
### Task 2 (native): the live response glyph (readout, Panel / Option glyph redraw, e2e)
- [ ] **Checkpoint for the user (stop):** each model on a saw and on noise against Ableton, RES swept, the glyph moving
  with an LFO on CUT.
