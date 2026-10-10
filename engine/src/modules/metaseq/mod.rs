//! META-SEQ: the sequencer (spec §7b). Eight patterns (A–H), each six polymetric
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
const MUT: usize = 2;
const DENS: usize = 3;
const SCALE: usize = PATTERNS * PATTERN_PARAMS;
const ROOT: usize = SCALE + 1;
const OUT_CV: usize = 0;
const OUT_GATE: usize = 1;
const OUT_ACC: usize = 2;
const OUT_VEL: usize = 3;
const OUT_EOC: usize = 4;
const SLIDE_S: f64 = 0.08;
/// VEL and CHNC move by up to this much when they mutate
const DRIFT: f64 = 0.25;
/// the generation wraps here, so the trace's f32 counts it exactly
const GEN_WRAP: u32 = 1 << 24;
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
    /// lane mutations so far (wrapping at GEN_WRAP): the readout writes the live steps back when it moves
    generation: u32,
    /// every pattern's steps as they sound (with their drift), and the fixed values last seen (an edit wins)
    live: [[[f32; STEPS]; LANES]; PATTERNS],
    seen: [[[f32; STEPS]; LANES]; PATTERNS],
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
            live: [[[0.0; STEPS]; LANES]; PATTERNS],
            // NaN differs from everything: the first block copies the playing pattern in
            seen: [[[f32::NAN; STEPS]; LANES]; PATTERNS],
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

    /// The playing pattern's steps edited in the document since its last look replace their live values (a pattern
    /// that does not play catches up when it plays again).
    fn sync(&mut self, io: &Io) {
        for l in 0..LANES {
            let at = lane_at(self.pat, l);
            for k in 0..STEPS {
                let v = io.fixed[at + k] as f32;
                if v.to_bits() != self.seen[self.pat][l][k].to_bits() {
                    self.seen[self.pat][l][k] = v;
                    self.live[self.pat][l][k] = v;
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

    /// Lane `l` moves to its next step; on a wrap it mutates.
    fn advance(&mut self, io: &Io, ctx: &mut Ctx, l: usize, i: usize) {
        let len = self.len(io, l);
        let wraps = self.cursor[l].is_some() && Self::next(self.cursor[l], len) == 0;
        self.cursor[l] = Some(Self::next(self.cursor[l], len));
        if wraps {
            self.mutate(io, ctx, l, len, i);
        }
    }

    /// MUTATE (spec §7b), on an unlocked lane's wrap: each step within LEN changes with odds MUT². GATE swaps with
    /// another step (the density stays), NOTE takes another note already in the lane (or a scale degree up or down
    /// when it holds one note), TIE and ACC toggle, VEL and CHNC move by up to ±DRIFT. Draws only when MUT > 0.
    fn mutate(&mut self, io: &Io, ctx: &mut Ctx, l: usize, len: usize, i: usize) {
        let m = (io.par[MUT][i] as f64).clamp(0.0, 1.0);
        let odds = m * m;
        if odds <= 0.0 || io.fixed[lane_at(self.pat, l) + STEPS + 2] >= 0.5 {
            return;
        }
        let scale = io.fixed[SCALE].max(0.0) as usize;
        let root = io.fixed[ROOT].round() as i32;
        let mut changed = false;
        for k in 0..len {
            if ctx.rng.next_f64() >= odds {
                continue;
            }
            let lane = &mut self.live[self.pat][l];
            let was = lane[k];
            match l {
                G => {
                    if len > 1 {
                        let j = (k + 1 + ctx.rng.next_u32() as usize % (len - 1)) % len;
                        lane.swap(k, j);
                    }
                }
                N => {
                    let others = lane[..len].iter().filter(|x| **x != was).count();
                    if others > 0 {
                        let pick = ctx.rng.next_u32() as usize % others;
                        if let Some(x) = lane[..len].iter().filter(|x| **x != was).nth(pick) {
                            lane[k] = *x;
                        }
                    } else {
                        let cur = was.round() as i32;
                        let in_scale = |s: &i32| snap(*s, scale, root) == *s;
                        let up = (cur + 1..=24).find(in_scale);
                        let down = (0..cur).rev().find(in_scale);
                        let pick = if ctx.rng.next_u32() & 1 == 0 {
                            up.or(down)
                        } else {
                            down.or(up)
                        };
                        if let Some(s) = pick {
                            lane[k] = s as f32;
                        }
                    }
                }
                T | A => lane[k] = if was >= 0.5 { 0.0 } else { 1.0 },
                _ => {
                    let d = (ctx.rng.next_f64() * 2.0 - 1.0) * DRIFT;
                    lane[k] = (was as f64 + d).clamp(0.0, 1.0) as f32;
                }
            }
            // (a GATE swap changes step k exactly when the two differ)
            changed |= self.live[self.pat][l][k] != was;
        }
        if changed {
            self.generation = (self.generation + 1) % GEN_WRAP;
        }
    }

    fn value(&self, l: usize) -> f32 {
        self.live[self.pat][l][self.cursor[l].unwrap_or(0)]
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
        let next_tie = self.live[self.pat][T][Self::next(self.cursor[T], self.len(io, T))] >= 0.5;
        // before a TIE the gate stays up until it (capped at four steps in case the clock stops); else half a step
        let hold = if next_tie { 4 * step } else { step / 2 }.max(1);
        let sounding = self.now < self.gate_until;
        if tie && sounding {
            // TIE with GATE on is a slide: the step plays its note; TIE alone holds the one sounding (in STEP a
            // differing note still glides). Neither retriggers the gate.
            self.gate_until = self.now + hold;
            let slide = self.value(G) >= 0.5;
            if played && slide {
                self.advance(io, ctx, N, i);
            }
            if slide || !played {
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
            self.advance(io, ctx, N, i);
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
                .copy_from_slice(&self.live[self.pat][l]);
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
                // PAT is read at the first clock (after the start or RST); every pattern keeps its live steps, so RST
                // does not undo MUTATE
                self.started = true;
                self.pat = want;
                self.sync(io);
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
                        // the switch ends the outgoing pattern's run: it is every lane's wrap (NOTE in PLAYED too),
                        // each mutating once, in lane order (no lane has wrapped yet at this sample)
                        for l in 0..LANES {
                            let len = self.len(io, l);
                            self.mutate(io, ctx, l, len, i);
                        }
                        // PAT waits for the GATE lane's wrap; then every lane starts over
                        self.pat = want;
                        self.sync(io);
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
                        self.advance(io, ctx, l, i);
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
mod tests;
