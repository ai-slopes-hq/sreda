//! STAGES: a 16-stage sequencer (Buchla 248 style) drawn as a contour: per stage a voltage, a time, a pulse and a
//! slide; advanced by ADV, its own stage timer, or addressed by ADDR.

use crate::dsp::{Ctx, Dsp, Io};
use crate::spec::{choice, knob, port, Display, ModuleSpec, Normal, Param, Role, Unit};

const STAGES: usize = 16;
const V_IDS: [&str; STAGES] = [
    "v1", "v2", "v3", "v4", "v5", "v6", "v7", "v8", "v9", "v10", "v11", "v12", "v13", "v14", "v15",
    "v16",
];
const V_LABELS: [&str; STAGES] = [
    "1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12", "13", "14", "15", "16",
];
const T_IDS: [&str; STAGES] = [
    "t1", "t2", "t3", "t4", "t5", "t6", "t7", "t8", "t9", "t10", "t11", "t12", "t13", "t14", "t15",
    "t16",
];
const T_LABELS: [&str; STAGES] = [
    "T1", "T2", "T3", "T4", "T5", "T6", "T7", "T8", "T9", "T10", "T11", "T12", "T13", "T14", "T15",
    "T16",
];
const P_IDS: [&str; STAGES] = [
    "p1", "p2", "p3", "p4", "p5", "p6", "p7", "p8", "p9", "p10", "p11", "p12", "p13", "p14", "p15",
    "p16",
];
const G_IDS: [&str; STAGES] = [
    "g1", "g2", "g3", "g4", "g5", "g6", "g7", "g8", "g9", "g10", "g11", "g12", "g13", "g14", "g15",
    "g16",
];

pub fn spec() -> ModuleSpec {
    let mut params: Vec<Param> = Vec::new();
    for k in 0..STAGES {
        params.push(knob(V_IDS[k], V_LABELS[k], -1.0, 1.0, 0.0).hidden().into());
    }
    for k in 0..STAGES {
        params.push(
            knob(T_IDS[k], T_LABELS[k], 0.01, 4.0, 0.25)
                .exp()
                .unit(Unit::S)
                .hidden()
                .into(),
        );
    }
    for id in P_IDS {
        params.push(choice(id, "", &["●", "○"], 0).hidden().into());
    }
    for id in G_IDS {
        params.push(choice(id, "", &["STEP", "SLIDE"], 0).hidden().into());
    }
    params.push(knob("length", "LEN", 1.0, 16.0, 16.0).step(1.0).into());
    params.push(
        choice(
            "gen",
            "GEN",
            &["303", "MOTIF", "WALK", "TURING", "ARP", "PHRASE", "PEDAL"],
            0,
        )
        .into(),
    );
    params.push(
        choice(
            "scale",
            "SCALE",
            &["CHR", "MAJ", "MIN", "DOR", "PHR", "PMIN", "PMAJ", "WHL"],
            2,
        )
        .glyph("scale")
        .into(),
    );
    params.push(
        knob("root", "ROOT", 0.0, 11.0, 0.0)
            .step(1.0)
            .unit(Unit::Note)
            .into(),
    );
    params.push(Param::Action {
        id: "dice",
        label: "DICE",
    });
    ModuleSpec {
        type_: "stages",
        internal: false,
        label: "STAGES",
        desc: "16 stages drawn as a contour: note, time, pulse, slide · generative",
        size: (10, 3),
        inputs: vec![
            port("adv", "ADV", Role::Trigger),
            port("reset", "RST", Role::Trigger),
            port("addr", "ADDR", Role::Mod),
            port("dice", "DICE", Role::Trigger),
        ],
        outputs: vec![
            port("cv", "CV", Role::Mod),
            port("pulse", "PLS", Role::Trigger),
            port("eoc", "EOC", Role::Trigger),
        ],
        params,
        normals: vec![Normal::Internal {
            input: "adv",
            internal: "stage timer",
        }],
        display: Some(Display {
            lanes: 9,
            kind: "contour",
        }),
    }
}

// inputs, knobs, outputs; fixed = v1–16, t1–16, p1–16, g1–16, GEN, SCALE
const ADV: usize = 0;
const RESET: usize = 1;
const ADDR: usize = 2;
const LEN: usize = 0;
const CV: usize = 0;
const PULSE: usize = 1;
const EOC: usize = 2;
const T0: usize = STAGES;
const P0: usize = 2 * STAGES;
const G0: usize = 3 * STAGES;
const SLIDE_S: f64 = 0.08;

pub struct Stages {
    sample_rate: f64,
    pulse_len: u32,
    /// the current stage; None before the first advance (or after a RESET)
    stage: Option<usize>,
    /// samples left in the stage while free-running
    timer: f64,
    value: f64,
    slide_from: f64,
    /// samples into a slide; ≥ the slide length when not sliding
    slide_pos: f64,
    pulse_left: u32,
    eoc_left: u32,
    adv_high: bool,
    reset_high: bool,
}

impl Stages {
    pub fn new(sample_rate: f64) -> Self {
        Stages {
            sample_rate,
            pulse_len: ((0.001 * sample_rate).round() as u32).max(1),
            stage: None,
            timer: 0.0,
            value: 0.0,
            slide_from: 0.0,
            slide_pos: f64::INFINITY,
            pulse_left: 0,
            eoc_left: 0,
            adv_high: false,
            reset_high: false,
        }
    }

    /// Enter stage `s`: its pulse, its time, a slide into it or a jump.
    fn enter(&mut self, io: &Io, s: usize) {
        self.stage = Some(s);
        if io.fixed[P0 + s] as u32 == 0 {
            self.pulse_left = self.pulse_len;
        }
        self.timer = io.fixed[T0 + s] * self.sample_rate;
        if io.fixed[G0 + s] as u32 == 1 {
            self.slide_from = self.value;
            self.slide_pos = 0.0;
        } else {
            self.slide_pos = f64::INFINITY;
        }
    }

    /// The next stage within LEN, firing EOC on a wrap.
    fn next(&mut self, len: usize) -> usize {
        match self.stage {
            Some(s) if s + 1 < len => s + 1,
            Some(_) => {
                self.eoc_left = self.pulse_len;
                0
            }
            None => 0,
        }
    }
}

impl Dsp for Stages {
    fn process(&mut self, io: &mut Io, _ctx: &mut Ctx, from: usize, to: usize) {
        let (adv_patched, addr_patched) = (io.connected_in[ADV], io.connected_in[ADDR]);
        let slide_len = SLIDE_S * self.sample_rate;
        for i in from..to {
            let len = (io.par[LEN][i].round() as usize).clamp(1, STAGES);
            let reset = io.inp[RESET][i] > 0.5;
            if reset && !self.reset_high {
                self.stage = None;
            }
            self.reset_high = reset;
            let adv = io.inp[ADV][i] > 0.5;
            let rise = adv && !self.adv_high;
            self.adv_high = adv;
            if addr_patched {
                let s = ((io.inp[ADDR][i] as f64).clamp(0.0, 0.999) * len as f64) as usize;
                if self.stage != Some(s) {
                    self.enter(io, s);
                }
            } else if adv_patched {
                if rise {
                    let s = self.next(len);
                    self.enter(io, s);
                }
            } else {
                // the internal stage timer: advance when the stage's time is up
                self.timer -= 1.0;
                if self.stage.is_none() || self.timer <= 0.0 {
                    let s = self.next(len);
                    self.enter(io, s);
                }
            }
            let target = io.fixed[self.stage.unwrap_or(0)];
            self.value = if self.slide_pos < slide_len {
                self.slide_pos += 1.0;
                self.slide_from + (target - self.slide_from) * (self.slide_pos / slide_len).min(1.0)
            } else {
                target
            };
            io.out[CV][i] = self.value as f32;
            io.out[PULSE][i] = if self.pulse_left > 0 { 1.0 } else { 0.0 };
            io.out[EOC][i] = if self.eoc_left > 0 { 1.0 } else { 0.0 };
            self.pulse_left = self.pulse_left.saturating_sub(1);
            self.eoc_left = self.eoc_left.saturating_sub(1);
        }
    }

    fn reset(&mut self) {
        let sr = self.sample_rate;
        *self = Stages::new(sr);
    }

    fn state(&self) -> f32 {
        self.stage.unwrap_or(0) as f32
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::dsp::bench::Bench;
    use crate::dsp::BLOCK;

    const CV: usize = 0;
    const PLS: usize = 1;
    const EOC: usize = 2;

    /// fixed: v1–16 (volts), t1–16 (s), p1–16 (0 ● / 1 ○), g1–16 (0 step / 1 slide), GEN, SCALE
    fn fixed(v: &[f64], t: f64, rests: &[usize], slides: &[usize]) -> Vec<f64> {
        let mut f = vec![0.0; 4 * STAGES + 2];
        for k in 0..STAGES {
            f[k] = *v.get(k).unwrap_or(&0.0);
            f[STAGES + k] = t;
            f[2 * STAGES + k] = if rests.contains(&k) { 1.0 } else { 0.0 };
            f[3 * STAGES + k] = if slides.contains(&k) { 1.0 } else { 0.0 };
        }
        f
    }
    fn ramp() -> Vec<f64> {
        (0..STAGES).map(|k| k as f64 / 16.0).collect()
    }
    fn rises(s: &[f32]) -> Vec<usize> {
        (0..s.len())
            .filter(|&i| s[i] > 0.5 && (i == 0 || s[i - 1] <= 0.5))
            .collect()
    }
    const TICK: usize = 1000;

    /// ADV patched with a clock every TICK samples
    fn clocked(len: f64, f: Vec<f64>, ticks: usize) -> (Vec<Vec<f32>>, Stages) {
        let mut b = Bench::new(48_000.0, 4, &[len, 0.0], &f, 3);
        b.connected_in = vec![true, false, false, false];
        let mut s = Stages::new(48_000.0);
        let o = b.run(&mut s, (ticks * TICK).div_ceil(BLOCK), |blk, i, inp| {
            let n = blk * BLOCK + i;
            inp[0][i] = if n % TICK < 48 && n < ticks * TICK {
                1.0
            } else {
                0.0
            };
        });
        (o, s)
    }

    #[test]
    fn adv_steps_through_the_stages_and_wraps_at_len_with_eoc() {
        let (o, _) = clocked(4.0, fixed(&ramp(), 0.25, &[], &[]), 9);
        // the first clock enters stage 1; the CV just before each later clock: stages 1, 2, 3, 4, 1, …
        let held: Vec<f32> = (1..9).map(|k| o[CV][k * TICK - 10]).collect();
        let want: Vec<f32> = [0, 1, 2, 3, 0, 1, 2, 3]
            .iter()
            .map(|&k| k as f32 / 16.0)
            .collect();
        assert_eq!(held, want);
        let eocs: Vec<usize> = rises(&o[EOC]).iter().map(|n| n / TICK).collect();
        assert_eq!(eocs, [4, 8]);
    }

    #[test]
    fn a_rest_stage_skips_its_pulse() {
        let (o, _) = clocked(4.0, fixed(&ramp(), 0.25, &[2], &[]), 4);
        let pulses: Vec<usize> = rises(&o[PLS]).iter().map(|n| n / TICK).collect();
        // ADV at ticks 0, 1, 2, 3 enters stages 1, 2, 3, 4 (the first clock enters stage 1)
        assert_eq!(pulses, [0, 1, 3], "stage 3 (tick 2) is a rest");
    }

    #[test]
    fn a_slide_glides_over_80_ms() {
        let mut v = vec![0.0; STAGES];
        v[1] = 1.0;
        let mut b = Bench::new(48_000.0, 4, &[2.0, 0.0], &fixed(&v, 0.25, &[], &[1]), 3);
        b.connected_in = vec![true, false, false, false];
        // clocks at 0 (stage 1) and TICK (stage 2, sliding to 1.0); 6000 samples in all
        let o = b.run(
            &mut Stages::new(48_000.0),
            6000usize.div_ceil(BLOCK),
            |blk, i, inp| {
                let n = blk * BLOCK + i;
                inp[0][i] = if n % TICK < 48 && n < 2 * TICK {
                    1.0
                } else {
                    0.0
                };
            },
        );
        let start = TICK;
        let done = o[CV][start..].iter().position(|x| *x >= 0.999).unwrap();
        assert!(
            (done as f64 - 3840.0).abs() <= 48.0,
            "glide took {done} samples"
        );
        assert!(
            o[CV][start + 1920] > 0.4 && o[CV][start + 1920] < 0.6,
            "half way at 40 ms"
        );
    }

    fn free_run_period(sr: f64) -> f64 {
        let mut b = Bench::new(sr, 4, &[4.0, 0.0], &fixed(&ramp(), 0.05, &[], &[]), 3);
        let o = b.run(
            &mut Stages::new(sr),
            (0.5 * sr) as usize / BLOCK,
            |_, _, _| {},
        );
        let r = rises(&o[EOC]);
        assert!(r.len() >= 2, "it runs by itself");
        (r[1] - r[0]) as f64 / sr
    }

    #[test]
    fn unpatched_adv_runs_on_the_stage_times_at_48k_and_44k1() {
        for sr in [48_000.0, 44_100.0] {
            let p = free_run_period(sr);
            assert!(
                (p - 0.2).abs() < 0.001,
                "{sr}: a pass of 4 × 50 ms took {p}"
            );
        }
    }

    #[test]
    fn lowering_len_below_the_stage_wraps_to_stage_one() {
        let mut b = Bench::new(
            48_000.0,
            4,
            &[16.0, 0.0],
            &fixed(&ramp(), 0.25, &[], &[]),
            3,
        );
        b.connected_in = vec![true, false, false, false];
        let mut s = Stages::new(48_000.0);
        let clock = |blk: usize, i: usize, inp: &mut [[f32; BLOCK]]| {
            inp[0][i] = if (blk * BLOCK + i) % TICK < 48 {
                1.0
            } else {
                0.0
            }
        };
        b.run(&mut s, (9 * TICK).div_ceil(BLOCK), clock);
        assert!(s.state() >= 8.0, "{}", s.state());
        b.par[0] = [3.0; BLOCK];
        b.run(&mut s, TICK.div_ceil(BLOCK) + 1, clock);
        assert!(s.state() < 3.0, "{}", s.state());
    }

    #[test]
    fn addr_beyond_one_picks_the_last_stage() {
        let mut b = Bench::new(48_000.0, 4, &[8.0, 0.0], &fixed(&ramp(), 0.25, &[], &[]), 3);
        b.connected_in = vec![false, false, true, false];
        let mut s = Stages::new(48_000.0);
        let o = b.run(&mut s, 4, |_, i, inp| inp[2][i] = 1.5);
        assert_eq!(s.state(), 7.0);
        assert_eq!(o[CV][4 * BLOCK - 1], 7.0 / 16.0);
    }

    #[test]
    fn an_audio_rate_adv_stays_finite() {
        let mut b = Bench::new(
            48_000.0,
            4,
            &[16.0, 0.0],
            &fixed(&ramp(), 0.25, &[], &[3, 7]),
            3,
        );
        b.connected_in = vec![true, false, false, false];
        let o = b.run(&mut Stages::new(48_000.0), 400, |blk, i, inp| {
            inp[0][i] = if (blk * BLOCK + i) % 24 < 12 {
                1.0
            } else {
                0.0
            }
        });
        assert!(o.iter().all(|s| s.iter().all(|x| x.is_finite())));
    }

    #[test]
    fn blockwise_equals_per_sample() {
        let n = 40 * BLOCK;
        let adv: Vec<f32> = (0..n)
            .map(|i| if i % 700 < 48 { 1.0 } else { 0.0 })
            .collect();
        Bench::blockwise_equals_per_sample(
            || Box::new(Stages::new(48_000.0)),
            &[adv.clone(), vec![], vec![], vec![]],
            &[7.0, 0.0],
            &fixed(&ramp(), 0.01, &[2], &[1, 4]),
            3,
            40,
        );
        Bench::blockwise_equals_per_sample(
            || Box::new(Stages::new(48_000.0)),
            &[vec![], vec![], vec![], vec![]],
            &[5.0, 0.0],
            &fixed(&ramp(), 0.004, &[], &[2]),
            3,
            40,
        );
    }
}
