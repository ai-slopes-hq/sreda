//! META-SEQ: one sequencer in place of RHYTHM and STAGES (spec §7b). Eight patterns (A–H), each six polymetric
//! lanes — NOTE, GATE, TIE, ACC, VEL, CHNC — with their own LEN, RATE and lock; NOTE plays PLAYED or STEP.

use std::sync::OnceLock;

use crate::dsp::{Ctx, Dsp, Io, TRACE_LEN};
use crate::spec::{choice, knob, port, Display, ModuleSpec, Param, Role, Unit};

const PATTERNS: usize = 8;
const LANES: usize = 6;
const STEPS: usize = 16;
/// per lane: its steps, LEN, RATE, lock
const LANE_PARAMS: usize = STEPS + 3;
/// per pattern: its lanes, then STEP / PLAYED
const PATTERN_PARAMS: usize = LANES * LANE_PARAMS + 1;
const PATTERN_IDS: [&str; PATTERNS] = ["a", "b", "c", "d", "e", "f", "g", "h"];
const LANE_IDS: [&str; LANES] = ["n", "g", "t", "a", "v", "c"];
const LANE_LABELS: [&str; LANES] = ["NOTE", "GATE", "TIE", "ACC", "VEL", "CHNC"];
const STEP_LABELS: [&str; STEPS] = [
    "1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12", "13", "14", "15", "16",
];
const RATES: [&str; 7] = ["÷4", "÷3", "÷2", "×1", "×2", "×3", "×4"];
/// RATE index of ×1
const X1: usize = 3;

/// Lanes, in this order everywhere (fixed layout, trace, UI rows).
const N: usize = 0;
const G: usize = 1;
const T: usize = 2;
const A: usize = 3;
const V: usize = 4;
const C: usize = 5;

/// Scales in semitones from the root: CHR MAJ MIN DOR PHR PMIN PMAJ WHL (as `generators.ts`).
pub const SCALES: [&[i32]; 8] = [
    &[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
    &[0, 2, 4, 5, 7, 9, 11],
    &[0, 2, 3, 5, 7, 8, 10],
    &[0, 2, 3, 5, 7, 9, 10],
    &[0, 1, 3, 5, 7, 8, 10],
    &[0, 3, 5, 7, 10],
    &[0, 2, 4, 7, 9],
    &[0, 2, 4, 6, 8, 10],
];

/// The nearest pitch to `semi` in scale `scale` from `root` (all in semitones); the lower one on a tie.
pub fn snap(semi: i32, scale: usize, root: i32) -> i32 {
    let degrees = SCALES[scale.min(SCALES.len() - 1)];
    let octave = (semi - root).div_euclid(12);
    let mut best = semi;
    let mut best_dist = i32::MAX;
    for o in octave - 1..=octave + 1 {
        for d in degrees {
            let c = root + 12 * o + d;
            let dist = (c - semi).abs();
            if dist < best_dist || (dist == best_dist && c < best) {
                best = c;
                best_dist = dist;
            }
        }
    }
    best
}

/// The first fixed index of lane `l` of pattern `p` (its steps, then LEN, RATE, lock).
const fn lane_at(p: usize, l: usize) -> usize {
    p * PATTERN_PARAMS + l * LANE_PARAMS
}

/// Every pattern param id (`an1` … `hclock`, `anmode` …), in spec order — the fixed index is the position.
fn pattern_ids() -> &'static [String] {
    static IDS: OnceLock<Vec<String>> = OnceLock::new();
    IDS.get_or_init(|| {
        let mut ids = Vec::with_capacity(PATTERNS * PATTERN_PARAMS);
        for p in PATTERN_IDS {
            for l in LANE_IDS {
                for k in 1..=STEPS {
                    ids.push(format!("{p}{l}{k}"));
                }
                for s in ["len", "rate", "lock"] {
                    ids.push(format!("{p}{l}{s}"));
                }
            }
            ids.push(format!("{p}nmode"));
        }
        ids
    })
}

pub fn spec() -> ModuleSpec {
    let ids = pattern_ids();
    let mut params: Vec<Param> = Vec::with_capacity(ids.len() + 10);
    for p in 0..PATTERNS {
        for (l, lane_label) in LANE_LABELS.iter().enumerate() {
            let at = lane_at(p, l);
            for k in 0..STEPS {
                let id = ids[at + k].as_str();
                let label = STEP_LABELS[k];
                params.push(match l {
                    N => knob(id, label, 0.0, 24.0, 12.0).step(1.0).hidden().into(),
                    G => {
                        let on = p == 0 && k % 4 == 0;
                        choice(id, label, &["·", "●"], u32::from(on))
                            .hidden()
                            .into()
                    }
                    T | A => choice(id, label, &["·", "●"], 0).hidden().into(),
                    _ => knob(id, label, 0.0, 1.0, 1.0).hidden().into(),
                });
            }
            params.push(
                knob(ids[at + STEPS].as_str(), "LEN", 1.0, 16.0, 16.0)
                    .step(1.0)
                    .hidden()
                    .into(),
            );
            params.push(
                choice(ids[at + STEPS + 1].as_str(), "RATE", &RATES, X1 as u32)
                    .hidden()
                    .into(),
            );
            params.push(
                choice(ids[at + STEPS + 2].as_str(), lane_label, &["·", "L"], 0)
                    .hidden()
                    .into(),
            );
        }
        params.push(
            choice(
                ids[lane_at(p, LANES)].as_str(),
                "NOTE",
                &["PLAYED", "STEP"],
                0,
            )
            .hidden()
            .into(),
        );
    }
    params.push(
        choice(
            "scale",
            "SCALE",
            &["CHR", "MAJ", "MIN", "DOR", "PHR", "PMIN", "PMAJ", "WHL"],
            2,
        )
        .glyph("scale")
        .hidden()
        .into(),
    );
    params.push(
        knob("root", "ROOT", 0.0, 11.0, 0.0)
            .step(1.0)
            .unit(Unit::Note)
            .hidden()
            .into(),
    );
    params.push(
        choice("edit", "EDIT", &["A", "B", "C", "D", "E", "F", "G", "H"], 0)
            .hidden()
            .into(),
    );
    params.push(
        knob("pat", "PAT", 0.0, 7.0, 0.0)
            .step(1.0)
            .unit(Unit::Pattern)
            .into(),
    );
    params.push(knob("trns", "TRNS", -24.0, 24.0, 0.0).step(1.0).into());
    params.push(knob("mut", "MUT", 0.0, 1.0, 0.0).into());
    params.push(knob("dens", "DENS", 0.0, 1.0, 0.5).into());
    params.push(
        choice(
            "gen",
            "GEN",
            &[
                "303", "MOTIF", "WALK", "TURING", "ARP", "PHRASE", "PEDAL", "EUCLID",
            ],
            0,
        )
        .into(),
    );
    params.push(Param::Action {
        id: "dice",
        label: "DICE",
    });
    ModuleSpec {
        type_: "metaseq",
        internal: false,
        label: "META-SEQ",
        desc: "six polymetric lanes, eight patterns: note, gate, tie, accent, velocity, chance · generative",
        size: (6, 2),
        inputs: vec![
            port("clk", "CLK", Role::Trigger),
            port("reset", "RST", Role::Trigger),
            port("dice", "DICE", Role::Trigger),
        ],
        outputs: vec![
            port("cv", "CV", Role::Pitch),
            port("gate", "GATE", Role::Trigger),
            port("acc", "ACC", Role::Trigger),
            port("vel", "VEL", Role::Mod),
            port("eoc", "EOC", Role::Trigger),
        ],
        params,
        normals: vec![],
        display: Some(Display {
            lanes: 4,
            kind: "metaseq",
        }),
    }
}

// inputs, knobs, outputs; fixed = the patterns, then SCALE, ROOT, EDIT, GEN
const CLK: usize = 0;
const RESET: usize = 1;
const PAT: usize = 0;
const TRNS: usize = 1;
const DENS: usize = 3;
const SCALE: usize = PATTERNS * PATTERN_PARAMS;
const ROOT: usize = SCALE + 1;
const OUT_CV: usize = 0;
const OUT_GATE: usize = 1;
const OUT_ACC: usize = 2;
const OUT_VEL: usize = 3;
const OUT_EOC: usize = 4;
const SLIDE_S: f64 = 0.08;
/// trace: [0] pattern, [1..7] cursors, [7] mutation generation, [8..104] live steps
const TR_CURSORS: usize = 1;
const TR_GEN: usize = 7;
const TR_LIVE: usize = 8;

pub struct MetaSeq {
    sample_rate: f64,
    pulse: u64,
    now: u64,
    /// the last measured clock interval, in samples
    interval: u64,
    last_clk: Option<u64>,
    clk_high: bool,
    reset_high: bool,
    /// a clock has come since the start or the last RST (PAT was read)
    started: bool,
    /// the playing pattern
    pat: usize,
    /// per lane: the current step, 0-based; None before its first step (or after RST / a pattern switch)
    cursor: [Option<usize>; LANES],
    /// per ÷N lane: clocks counted since the start, modulo 12
    div: [u32; LANES],
    /// per ×N lane: subdivisions still to fire before the next clock, when the next one is, their spacing
    sub_left: [u32; LANES],
    sub_next: [u64; LANES],
    sub_gap: [u64; LANES],
    gate_until: u64,
    /// the sample a new note started while the gate was still high: low for that sample, so the rise is seen
    gap: Option<u64>,
    acc_until: u64,
    eoc_until: u64,
    vel: f32,
    /// CV in volts: where it is, where it glides from and to, samples into the glide (∞ when not gliding)
    cv: f64,
    slide_from: f64,
    target: f64,
    slide_pos: f64,
    /// lane mutations so far (Task 7)
    generation: u32,
    /// the playing pattern's steps as they sound, and the fixed values last seen (an edit wins)
    live: [[f32; STEPS]; LANES],
    seen: [[f32; STEPS]; LANES],
    trace: [f32; TRACE_LEN],
}

impl MetaSeq {
    pub fn new(sample_rate: f64) -> Self {
        MetaSeq {
            sample_rate,
            pulse: ((0.001 * sample_rate).round() as u64).max(1),
            now: 0,
            interval: (0.125 * sample_rate) as u64,
            last_clk: None,
            clk_high: false,
            reset_high: false,
            started: false,
            pat: 0,
            cursor: [None; LANES],
            div: [0; LANES],
            sub_left: [0; LANES],
            sub_next: [0; LANES],
            sub_gap: [1; LANES],
            gate_until: 0,
            gap: None,
            acc_until: 0,
            eoc_until: 0,
            vel: 0.0,
            cv: 0.0,
            slide_from: 0.0,
            target: 0.0,
            slide_pos: f64::INFINITY,
            generation: 0,
            live: [[0.0; STEPS]; LANES],
            // NaN differs from everything: the first block copies the playing pattern in
            seen: [[f32::NAN; STEPS]; LANES],
            trace: [0.0; TRACE_LEN],
        }
    }

    fn len(&self, io: &Io, l: usize) -> usize {
        (io.fixed[lane_at(self.pat, l) + STEPS].round().max(1.0) as usize).min(STEPS)
    }

    /// RATE index: 0–2 ÷4 ÷3 ÷2, 3 ×1, 4–6 ×2 ×3 ×4
    fn rate(&self, io: &Io, l: usize) -> usize {
        (io.fixed[lane_at(self.pat, l) + STEPS + 1].max(0.0) as usize).min(RATES.len() - 1)
    }

    fn played(&self, io: &Io) -> bool {
        io.fixed[lane_at(self.pat, LANES)] < 0.5
    }

    /// Copy the playing pattern's steps into `live` and `seen`.
    fn load(&mut self, io: &Io) {
        for l in 0..LANES {
            let at = lane_at(self.pat, l);
            for k in 0..STEPS {
                let v = io.fixed[at + k] as f32;
                self.live[l][k] = v;
                self.seen[l][k] = v;
            }
        }
    }

    /// Steps edited in the document since the last look replace their live values.
    fn sync(&mut self, io: &Io) {
        for l in 0..LANES {
            let at = lane_at(self.pat, l);
            for k in 0..STEPS {
                let v = io.fixed[at + k] as f32;
                if v.to_bits() != self.seen[l][k].to_bits() {
                    self.seen[l][k] = v;
                    self.live[l][k] = v;
                }
            }
        }
    }

    /// Does lane `l` step on this clock? ÷N counts clocks; ×N schedules its subdivisions from the interval.
    fn clock_fires(&mut self, l: usize, rate: usize) -> bool {
        if rate < X1 {
            let n = (X1 + 1 - rate) as u32;
            let fires = self.div[l].is_multiple_of(n);
            self.div[l] = (self.div[l] + 1) % 12;
            fires
        } else {
            let n = (rate - X1 + 1) as u64;
            // a new clock drops whatever subdivisions were left: never late
            self.sub_left[l] = (n - 1) as u32;
            self.sub_gap[l] = (self.interval / n).max(1);
            self.sub_next[l] = self.now + self.sub_gap[l];
            true
        }
    }

    /// The step after `c` in a lane of `len` steps (step 1 when past LEN, or before the first).
    fn next(c: Option<usize>, len: usize) -> usize {
        match c {
            Some(s) if s + 1 < len => s + 1,
            _ => 0,
        }
    }

    fn value(&self, l: usize) -> f32 {
        self.live[l][self.cursor[l].unwrap_or(0)]
    }

    /// The NOTE lane's current note plus TRNS, snapped to SCALE from ROOT, in volts (12 semitones = 0 V).
    fn note_volts(&self, io: &Io, i: usize) -> f64 {
        let note = self.value(N).round() as i32 + io.par[TRNS][i].round() as i32;
        let scale = io.fixed[SCALE].max(0.0) as usize;
        let root = io.fixed[ROOT].round() as i32;
        (snap(note, scale, root) - 12) as f64 / 12.0
    }

    /// A GATE-lane step event: a hit, a tie, or a rest.
    fn gate_event(&mut self, io: &Io, ctx: &mut Ctx, i: usize) {
        let played = self.played(io);
        let rate = self.rate(io, G);
        let step = if rate < X1 {
            self.interval * (X1 + 1 - rate) as u64
        } else {
            self.interval / (rate - X1 + 1) as u64
        };
        let tie = self.value(T) >= 0.5;
        let next_tie = self.live[T][Self::next(self.cursor[T], self.len(io, T))] >= 0.5;
        // before a TIE the gate stays up until it (capped at four steps in case the clock stops); else half a step
        let hold = if next_tie { 4 * step } else { step / 2 }.max(1);
        let sounding = self.now < self.gate_until;
        if tie && sounding {
            self.gate_until = self.now + hold;
            if !played {
                let to = self.note_volts(io, i);
                if to != self.target {
                    self.slide_from = self.cv;
                    self.target = to;
                    self.slide_pos = 0.0;
                }
            }
            return;
        }
        let hit = if tie {
            // a TIE after a rest plays like a hit
            true
        } else if self.value(G) >= 0.5 {
            let odds = (self.value(C) as f64 * 2.0 * io.par[DENS][i] as f64).clamp(0.0, 1.0);
            odds >= 1.0 || (odds > 0.0 && ctx.rng.next_f64() < odds)
        } else {
            false
        };
        if !hit {
            // a rest: whatever was held ends here
            self.gate_until = self.gate_until.min(self.now);
            return;
        }
        if self.now < self.gate_until {
            self.gap = Some(self.now);
        }
        self.gate_until = self.now + hold;
        if played {
            self.cursor[N] = Some(Self::next(self.cursor[N], self.len(io, N)));
        }
        self.target = self.note_volts(io, i);
        self.slide_pos = f64::INFINITY;
        self.vel = self.value(V);
        if !tie && self.value(A) >= 0.5 {
            self.acc_until = self.now + self.pulse;
        }
    }

    fn write_trace(&mut self) {
        self.trace[0] = self.pat as f32;
        for l in 0..LANES {
            self.trace[TR_CURSORS + l] = self.cursor[l].map_or(-1.0, |c| c as f32);
            self.trace[TR_LIVE + l * STEPS..TR_LIVE + (l + 1) * STEPS]
                .copy_from_slice(&self.live[l]);
        }
        self.trace[TR_GEN] = self.generation as f32;
    }
}

impl Dsp for MetaSeq {
    fn process(&mut self, io: &mut Io, ctx: &mut Ctx, from: usize, to: usize) {
        self.sync(io);
        let slide_len = SLIDE_S * self.sample_rate;
        for i in from..to {
            let reset = io.inp[RESET][i] > 0.5;
            if reset && !self.reset_high {
                self.cursor = [None; LANES];
                self.div = [0; LANES];
                self.sub_left = [0; LANES];
                self.started = false;
            }
            self.reset_high = reset;
            let clk = io.inp[CLK][i] > 0.5;
            let rise = clk && !self.clk_high;
            self.clk_high = clk;
            if rise {
                if let Some(last) = self.last_clk {
                    self.interval = (self.now - last).max(2);
                }
                self.last_clk = Some(self.now);
            }
            let want = (io.par[PAT][i].round().max(0.0) as usize).min(PATTERNS - 1);
            if rise && !self.started {
                // PAT is read at the first clock (after the start or RST)
                self.started = true;
                self.pat = want;
                self.load(io);
            }
            let played = self.played(io);
            let mut fires = [false; LANES];
            for (l, f) in fires.iter_mut().enumerate() {
                let rate = self.rate(io, l);
                *f = if rise {
                    self.clock_fires(l, rate)
                } else if self.sub_left[l] > 0 && self.now >= self.sub_next[l] {
                    self.sub_left[l] -= 1;
                    self.sub_next[l] += self.sub_gap[l];
                    true
                } else {
                    false
                };
            }
            // NOTE in PLAYED ignores its RATE: it moves on hits
            fires[N] &= !played;
            if fires.iter().any(|f| *f) {
                if fires[G]
                    && self.cursor[G].is_some()
                    && Self::next(self.cursor[G], self.len(io, G)) == 0
                {
                    self.eoc_until = self.now + self.pulse;
                    if want != self.pat {
                        // PAT waits for the GATE lane's wrap; then every lane starts over
                        self.pat = want;
                        self.load(io);
                        self.cursor = [None; LANES];
                        let played = self.played(io);
                        for (l, f) in fires.iter_mut().enumerate() {
                            self.div[l] = 0;
                            if rise {
                                let rate = self.rate(io, l);
                                *f = self.clock_fires(l, rate);
                            }
                        }
                        fires[N] &= !played;
                    }
                }
                for (l, f) in fires.iter().enumerate() {
                    if *f {
                        self.cursor[l] = Some(Self::next(self.cursor[l], self.len(io, l)));
                    }
                }
                if fires[G] {
                    self.gate_event(io, ctx, i);
                }
            }
            self.cv = if self.slide_pos < slide_len {
                self.slide_pos += 1.0;
                self.slide_from
                    + (self.target - self.slide_from) * (self.slide_pos / slide_len).min(1.0)
            } else {
                self.target
            };
            let gate_on = self.now < self.gate_until && self.gap != Some(self.now);
            io.out[OUT_CV][i] = self.cv as f32;
            io.out[OUT_GATE][i] = if gate_on { 1.0 } else { 0.0 };
            io.out[OUT_ACC][i] = if self.now < self.acc_until { 1.0 } else { 0.0 };
            io.out[OUT_VEL][i] = self.vel;
            io.out[OUT_EOC][i] = if self.now < self.eoc_until { 1.0 } else { 0.0 };
            self.now += 1;
        }
        self.write_trace();
    }

    fn reset(&mut self) {
        let sr = self.sample_rate;
        *self = MetaSeq::new(sr);
    }

    fn state(&self) -> f32 {
        self.cursor[G].map_or(0.0, |c| c as f32)
    }

    fn trace(&self) -> Option<&[f32]> {
        Some(&self.trace)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::dsp::bench::Bench;
    use crate::dsp::{BLOCK, TRACE_LEN};
    use crate::spec::Param;

    const CV: usize = 0;
    const GATE: usize = 1;
    const ACC: usize = 2;
    const VEL: usize = 3;
    const EOC: usize = 4;
    const SR: f64 = 48_000.0;
    /// a clock every 1200 samples (40 per second)
    const TICK: usize = 1200;
    /// PAT, TRNS, MUT, DENS
    const PAR: [f64; 4] = [0.0, 0.0, 0.0, 0.5];

    /// Every fixed value at its spec default, in spec order.
    fn defaults() -> Vec<f64> {
        spec()
            .params
            .iter()
            .filter_map(|p| match p {
                Param::Knob(k) if k.hidden => Some(k.def),
                Param::Option(c) => Some(c.def as f64),
                _ => None,
            })
            .collect()
    }
    fn steps(f: &mut [f64], p: usize, l: usize, v: &[f64]) {
        for (k, x) in v.iter().enumerate() {
            f[lane_at(p, l) + k] = *x;
        }
    }
    fn pads(s: &str) -> Vec<f64> {
        s.chars()
            .map(|c| if c == 'x' { 1.0 } else { 0.0 })
            .collect()
    }
    fn set_len(f: &mut [f64], p: usize, l: usize, len: usize) {
        f[lane_at(p, l) + STEPS] = len as f64;
    }
    fn set_rate(f: &mut [f64], p: usize, l: usize, rate: usize) {
        f[lane_at(p, l) + STEPS + 1] = rate as f64;
    }
    fn set_step_mode(f: &mut [f64], p: usize) {
        f[p * PATTERN_PARAMS + LANES * LANE_PARAMS] = 1.0;
    }
    /// Pattern `p` with GATE `gate` (LEN = its length), every other lane at its default.
    fn with_gate(p: usize, gate: &str) -> Vec<f64> {
        let mut f = defaults();
        steps(&mut f, p, G, &pads(gate));
        set_len(&mut f, p, G, gate.len());
        f
    }
    fn rises(s: &[f32]) -> Vec<usize> {
        (0..s.len())
            .filter(|&i| s[i] > 0.5 && (i == 0 || s[i - 1] <= 0.5))
            .collect()
    }
    fn clock(n: usize, end: usize) -> f32 {
        if n < end && n % TICK < 48 {
            1.0
        } else {
            0.0
        }
    }
    fn bench(par: [f64; 4], f: &[f64]) -> Bench {
        let mut b = Bench::new(SR, 3, &par, f, 5);
        b.connected_in = vec![true, true, false];
        b
    }
    /// Runs `ticks` clocks (and a tick of tail); `extra(n, inp, i)` may drive RST.
    fn play(
        par: [f64; 4],
        f: &[f64],
        ticks: usize,
        mut extra: impl FnMut(usize, &mut [[f32; BLOCK]], usize),
    ) -> (Vec<Vec<f32>>, MetaSeq) {
        let mut b = bench(par, f);
        let mut m = MetaSeq::new(SR);
        let o = b.run(
            &mut m,
            ((ticks + 1) * TICK).div_ceil(BLOCK),
            |blk, i, inp| {
                let n = blk * BLOCK + i;
                inp[0][i] = clock(n, ticks * TICK);
                inp[1][i] = 0.0;
                extra(n, inp, i);
            },
        );
        (o, m)
    }
    /// The CV just before clock `k + 1`: what clock `k` left playing.
    fn held(o: &[Vec<f32>], k: usize) -> f32 {
        o[CV][(k + 1) * TICK - 10]
    }

    #[test]
    fn polymeter_note_7_over_gate_16_repeats_after_112_clocks() {
        let mut f = with_gate(0, "xxxxxxxxxxxxxxxx");
        set_step_mode(&mut f, 0);
        steps(&mut f, 0, N, &[12.0, 14.0, 15.0, 17.0, 19.0, 20.0, 22.0]);
        set_len(&mut f, 0, N, 7);
        let (o, _) = play(PAR, &f, 336, |_, _, _| {});
        // per clock: the note it played and whether the GATE lane wrapped there (EOC; not at the start)
        let seq: Vec<(f32, bool)> = (0..336)
            .map(|k| {
                let eoc = o[EOC][k * TICK..(k + 1) * TICK].iter().any(|x| *x > 0.5);
                (held(&o, k), eoc)
            })
            .collect();
        let (cycle, again) = (&seq[112..224], &seq[224..]);
        assert_eq!(cycle, again, "repeats after 112 clocks");
        assert_eq!(seq[1..112], seq[113..224], "from the start too");
        for d in (1..112).filter(|d| 112 % d == 0) {
            assert!(
                (d..112).any(|k| cycle[k] != cycle[k - d]),
                "a shorter period {d}"
            );
        }
        assert_eq!(rises(&o[GATE]).len(), 336, "every step a hit");
    }

    #[test]
    fn rate_x2_steps_twice_per_clock_and_div2_once_per_two() {
        let mut f = with_gate(0, "xxxxxxxxxxxxxxxx");
        set_rate(&mut f, 0, G, 4);
        let (o, _) = play(PAR, &f, 11, |_, _, _| {});
        // once the interval is known: a step at the clock and one half way
        let r: Vec<usize> = rises(&o[GATE])
            .into_iter()
            .filter(|n| (2 * TICK..10 * TICK).contains(n))
            .collect();
        assert_eq!(r.len(), 16, "{r:?}");
        assert!(r.iter().all(|n| n % (TICK / 2) == 0), "{r:?}");

        set_rate(&mut f, 0, G, 2);
        let (o, _) = play(PAR, &f, 8, |_, _, _| {});
        let r: Vec<usize> = rises(&o[GATE]).iter().map(|n| n / TICK).collect();
        assert_eq!(r, [0, 2, 4, 6]);
    }

    #[test]
    fn played_waits_on_rests_step_does_not() {
        let notes: Vec<f64> = [0.0, 2.0, 4.0, 5.0].iter().map(|s| s + 12.0).collect();
        let mut f = with_gate(0, "x.x.");
        steps(&mut f, 0, N, &notes);
        set_len(&mut f, 0, N, 4);
        f[SCALE] = 0.0; // CHR: the notes as drawn
        let at_hits = |o: &[Vec<f32>]| -> Vec<f32> {
            [0, 2, 4, 6].iter().map(|&k| held(o, k) * 12.0).collect()
        };
        let (o, _) = play(PAR, &f, 8, |_, _, _| {});
        assert_eq!(at_hits(&o), [0.0, 2.0, 4.0, 5.0], "PLAYED");
        set_step_mode(&mut f, 0);
        let (o, _) = play(PAR, &f, 8, |_, _, _| {});
        assert_eq!(at_hits(&o), [0.0, 4.0, 0.0, 4.0], "STEP");
    }

    #[test]
    fn a_tie_holds_the_gate_and_glides_to_a_new_note() {
        let mut f = with_gate(0, "x.");
        set_step_mode(&mut f, 0);
        steps(&mut f, 0, N, &[12.0, 24.0]);
        set_len(&mut f, 0, N, 2);
        steps(&mut f, 0, T, &pads(".x"));
        set_len(&mut f, 0, T, 2);
        f[SCALE] = 0.0;
        // two clocks, then on past the glide (80 ms is 3840 samples)
        let mut b = bench(PAR, &f);
        let o = b.run(
            &mut MetaSeq::new(SR),
            8000usize.div_ceil(BLOCK),
            |blk, i, inp| {
                inp[0][i] = clock(blk * BLOCK + i, 2 * TICK);
            },
        );
        assert_eq!(rises(&o[GATE]), [0], "one rise: the tie holds");
        assert!(o[GATE][TICK - 1] > 0.5 && o[GATE][TICK + 1] > 0.5);
        let mid = o[CV][TICK + 1920];
        assert!(mid > 0.4 && mid < 0.6, "half way at 40 ms: {mid}");
        assert!(o[CV][TICK + 10] < 0.1, "a glide, not a jump");
        assert_eq!(o[CV][TICK + 4000], 1.0, "arrived");
        assert_eq!(rises(&o[ACC]).len(), 0);
    }

    #[test]
    fn chance_and_dens_by_seed() {
        let mut f = with_gate(0, "xxxxxxxxxxxxxxxx");
        steps(&mut f, 0, C, &[0.5; STEPS]);
        let hits = |dens: f64| {
            let (o, _) = play([0.0, 0.0, 0.0, dens], &f, 1000, |_, _, _| {});
            rises(&o[GATE]).len()
        };
        let half = hits(0.5);
        assert!((450..=550).contains(&half), "{half} of 1000");
        assert_eq!(hits(0.0), 0, "DENS 0: none");
        assert_eq!(hits(1.0), 1000, "DENS 1: all");
    }

    #[test]
    fn pat_switches_only_on_the_gate_wrap() {
        // pattern a plays 0 V, pattern b 1 V; both GATE all on over 4 steps
        let mut f = with_gate(0, "xxxx");
        steps(&mut f, 1, G, &pads("xxxx"));
        set_len(&mut f, 1, G, 4);
        steps(&mut f, 1, N, &[24.0; STEPS]);
        f[SCALE] = 0.0;
        let mut b = bench(PAR, &f);
        let mut m = MetaSeq::new(SR);
        let first = (5 * TICK + 300).div_ceil(BLOCK);
        let a = b.run(&mut m, first, |blk, i, inp| {
            inp[0][i] = clock(blk * BLOCK + i, usize::MAX);
        });
        // PAT moves to B during the second cycle (clocks 4–7)
        b.par[0] = [1.0; BLOCK];
        let rest = b.run(
            &mut m,
            (10 * TICK).div_ceil(BLOCK) - first,
            |blk, i, inp| {
                inp[0][i] = clock((blk + first) * BLOCK + i, usize::MAX);
            },
        );
        let o: Vec<f32> = a[CV].iter().chain(rest[CV].iter()).copied().collect();
        let cv: Vec<f32> = (0..9).map(|k| o[(k + 1) * TICK - 10]).collect();
        assert_eq!(cv, [0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 1.0]);
    }

    #[test]
    fn trns_snaps_to_the_scale() {
        // MIN from C: C D E♭ F G A♭ B♭
        assert_eq!(snap(14, 2, 0), 14, "in the scale");
        assert_eq!(snap(13, 2, 0), 12, "a tie between 12 and 14 goes down");
        assert_eq!(
            snap(16, 2, 0),
            15,
            "E → E♭ (tie between 15 and 17 goes down)"
        );
        assert_eq!(snap(14, 5, 0), 15, "PMIN: D → E♭, the nearer");
        assert_eq!(snap(-1, 2, 0), -2, "below C: B♭");
        assert_eq!(snap(13, 1, 1), 13, "MAJ from C♯ holds C♯");
        let mut f = with_gate(0, "x");
        steps(&mut f, 0, N, &[12.0; STEPS]);
        let cv = |trns: f64| {
            let (o, _) = play([0.0, trns, 0.0, 0.5], &f, 1, |_, _, _| {});
            held(&o, 0)
        };
        assert_eq!(cv(1.0), 0.0, "12 + 1 = 13 snaps down to 12");
        assert_eq!(cv(2.0), 2.0 / 12.0, "12 + 2 = 14 is D");
        assert_eq!(cv(4.0), 3.0 / 12.0, "12 + 4 = 16 snaps to E♭");
        assert_eq!(cv(-24.0), -2.0, "two octaves down");
    }

    #[test]
    fn eoc_and_reset() {
        let mut f = with_gate(0, "xxxx");
        set_step_mode(&mut f, 0);
        steps(&mut f, 0, N, &[12.0, 13.0, 14.0, 15.0]);
        set_len(&mut f, 0, N, 4);
        f[SCALE] = 0.0;
        let (o, _) = play(PAR, &f, 12, |n, inp, i| {
            inp[1][i] = if (5 * TICK + 200..5 * TICK + 248).contains(&n) {
                1.0
            } else {
                0.0
            };
        });
        let eoc: Vec<usize> = rises(&o[EOC]).iter().map(|n| n / TICK).collect();
        assert_eq!(
            eoc,
            [4, 10],
            "wraps at 4; RST after clock 5 → step 1 at 6, wrap at 10"
        );
        assert_eq!(held(&o, 5), 1.0 / 12.0, "clock 5 played step 2");
        assert_eq!(held(&o, 6), 0.0, "clock 6 played step 1 again");
    }

    #[test]
    fn lowering_len_wraps_only_that_lane() {
        let mut f = with_gate(0, "xxxxxxxxxxxxxxxx");
        set_step_mode(&mut f, 0);
        let mut b = bench(PAR, &f);
        let mut m = MetaSeq::new(SR);
        let first = (9 * TICK + 300).div_ceil(BLOCK);
        b.run(&mut m, first, |blk, i, inp| {
            inp[0][i] = clock(blk * BLOCK + i, usize::MAX)
        });
        let t = m.trace().unwrap();
        assert_eq!([t[1 + N], t[1 + G], t[1 + T]], [9.0, 9.0, 9.0]);
        b.fixed[lane_at(0, N) + STEPS] = 4.0;
        b.run(
            &mut m,
            (10 * TICK + 300).div_ceil(BLOCK) - first,
            |blk, i, inp| inp[0][i] = clock((blk + first) * BLOCK + i, usize::MAX),
        );
        let t = m.trace().unwrap();
        assert_eq!(t[1 + N], 0.0, "NOTE wrapped to step 1");
        assert_eq!(
            [t[1 + G], t[1 + T], t[1 + C]],
            [10.0, 10.0, 10.0],
            "others went on"
        );
        assert_eq!(m.state(), 10.0);
    }

    #[test]
    fn an_audio_rate_clock_stays_in_range() {
        let mut f = with_gate(0, "x.xx..x.x.xx..x.");
        set_rate(&mut f, 0, G, 6);
        steps(&mut f, 0, T, &pads("...x...x....x..."));
        steps(&mut f, 0, A, &pads("x.x.x.x.x.x.x.x."));
        steps(&mut f, 0, N, &[0.0, 24.0, 7.0, 19.0, 3.0]);
        set_len(&mut f, 0, N, 5);
        set_rate(&mut f, 0, T, 0);
        let mut b = bench([0.0, 5.0, 0.0, 0.8], &f);
        let o = b.run(&mut MetaSeq::new(SR), 400, |blk, i, inp| {
            inp[0][i] = if (blk * BLOCK + i) % 24 < 12 {
                1.0
            } else {
                0.0
            }
        });
        for out in [GATE, ACC, EOC] {
            assert!(
                o[out].iter().all(|x| *x == 0.0 || *x == 1.0),
                "output {out}"
            );
        }
        assert!(o[VEL].iter().all(|x| (0.0..=1.0).contains(x)));
        assert!(o[CV].iter().all(|x| x.is_finite() && x.abs() <= 1.5));
        // a ×4 GATE lane of 16 steps wraps every 4 clocks: 400 blocks hold ~533 clocks
        assert!(rises(&o[EOC]).len() > 100, "{}", rises(&o[EOC]).len());
    }

    #[test]
    fn blockwise_equals_per_sample() {
        let n = 40 * BLOCK;
        let clk: Vec<f32> = (0..n)
            .map(|i| if i % 300 < 48 { 1.0 } else { 0.0 })
            .collect();
        let rst: Vec<f32> = (0..n)
            .map(|i| if (2500..2548).contains(&i) { 1.0 } else { 0.0 })
            .collect();
        let mut f = with_gate(0, "x.xx..x.x.xx..x");
        steps(&mut f, 0, T, &pads("...x....x......"));
        steps(&mut f, 0, A, &pads("x.....x.....x"));
        steps(&mut f, 0, N, &[12.0, 15.0, 19.0, 10.0, 22.0]);
        set_len(&mut f, 0, N, 5);
        set_rate(&mut f, 0, A, 5);
        set_rate(&mut f, 0, V, 1);
        steps(&mut f, 0, V, &[0.2, 0.9, 0.5]);
        steps(&mut f, 0, C, &[0.7; STEPS]);
        Bench::blockwise_equals_per_sample(
            || Box::new(MetaSeq::new(48_000.0)),
            &[clk, rst, vec![]],
            &[0.0, 3.0, 0.0, 0.5],
            &f,
            5,
            40,
        );
    }

    #[test]
    fn the_trace_reports_pattern_cursors_and_live_steps() {
        // pattern C (index 2) plays: GATE x..x over 4, NOTE 12 14 15 (STEP) over 3
        let mut f = defaults();
        steps(&mut f, 2, G, &pads("x..x"));
        set_len(&mut f, 2, G, 4);
        steps(&mut f, 2, N, &[12.0, 14.0, 15.0]);
        set_len(&mut f, 2, N, 3);
        set_step_mode(&mut f, 2);
        steps(&mut f, 2, V, &[0.25]);
        let mut b = bench([2.0, 0.0, 0.0, 0.5], &f);
        let mut m = MetaSeq::new(SR);
        b.run(&mut m, 1, |_, i, inp| inp[0][i] = 0.0);
        let t = m.trace().unwrap();
        assert_eq!(t.len(), TRACE_LEN);
        assert_eq!(&t[1..7], &[-1.0; 6], "no step yet");
        let first = (4 * TICK + 300).div_ceil(BLOCK);
        b.run(&mut m, first, |blk, i, inp| {
            inp[0][i] = clock(blk * BLOCK + i, usize::MAX)
        });
        let t = m.trace().unwrap().to_vec();
        assert_eq!(t[0], 2.0, "pattern C");
        // clocks 0–4 played: GATE 4 steps → step 1; NOTE 3 → step 2; the others 16 → step 5
        assert_eq!(&t[1..7], &[1.0, 0.0, 4.0, 4.0, 4.0, 4.0]);
        assert_eq!(t[7], 0.0, "no mutation yet");
        assert_eq!(&t[8..11], &[12.0, 14.0, 15.0], "NOTE in semitones");
        assert_eq!(&t[8 + G * 16..8 + G * 16 + 4], &[1.0, 0.0, 0.0, 1.0]);
        assert_eq!(t[8 + V * 16], 0.25);
        assert_eq!(t[8 + C * 16 + 15], 1.0);
        assert_eq!(m.state(), 0.0, "the GATE cursor");
        // an edit to the playing pattern reaches the live steps on the next block
        b.fixed[lane_at(2, N) + 1] = 19.0;
        b.run(&mut m, 1, |_, i, inp| inp[0][i] = 0.0);
        assert_eq!(m.trace().unwrap()[9], 19.0);
    }
}
