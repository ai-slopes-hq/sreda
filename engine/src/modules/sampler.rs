//! SAMPLER (spec §7a): plays a sample from the pool. ONE: up to 4 voices, each from START for LEN of the rest; LOOP:
//! one voice looping the region; SLICE: the region in SLICES equal parts or at its hits (AUTO, by SENS), the next
//! slice per TRIG or the one SLICE points at. REV plays backwards; DEC decays each voice; every start, end, steal
//! and loop seam has a 1 ms fade; EOC fires at the end of each play-through, loop pass or slice.
//!
//! Two hidden, message-only values drive the display (spec §7a, "a cursor and a scrub"); neither is saved:
//! - `scrub` (−1 off, else a position 0…1): a voice of its own that fades in there and follows the value with a
//!   10 ms glide, so its speed and direction are the pointer's; −1 fades it out over 1 ms. It sounds beside the
//!   triggered voices at LVL.
//! - `play` (a one-shot request): every change of value to `n + p` (p in 0…1, n a counter the UI increments) plays,
//!   once, the slice that holds position p (SLICE's slices as a trigger would cut them); −1 re-arms.

use crate::dsp::{Ctx, Dsp, Io};
use crate::samples::Sample;
use crate::spec::{choice, knob, port, ModuleSpec, Param, Role, Unit};

pub fn spec() -> ModuleSpec {
    ModuleSpec {
        type_: "sampler",
        internal: false,
        label: "SAMPLER",
        desc: "one-shot, loop, slices",
        size: (8, 2),
        inputs: vec![
            port("trig", "TRIG", Role::Trigger),
            port("pitch", "PTCH", Role::Pitch),
            port("slice", "SLICE", Role::Mod),
            port("start", "START", Role::Mod),
        ],
        outputs: vec![
            port("l", "L", Role::Audio),
            port("r", "R", Role::Audio),
            port("eoc", "EOC", Role::Trigger),
        ],
        params: vec![
            knob("pitch", "PITCH", -24.0, 24.0, 0.0).step(1.0).into(),
            knob("start", "START", 0.0, 1.0, 0.0).into(),
            knob("len", "LEN", 0.0, 1.0, 1.0).into(),
            knob("dec", "DEC", 0.01, 10.0, 10.0)
                .exp()
                .unit(Unit::S)
                .into(),
            knob("lvl", "LVL", 0.0, 1.0, 0.8).into(),
            knob("slices", "SLICES", 2.0, 64.0, 8.0).step(1.0).into(),
            choice("mode", "MODE", &["ONE", "LOOP", "SLICE"], 0).into(),
            choice("rev", "REV", &["OFF", "ON"], 0).into(),
            choice("auto", "AUTO", &["OFF", "ON"], 0).into(),
            Param::Action {
                id: "load",
                label: "LOAD",
            },
            knob("sample", "SAMPLE", -1.0, 1e6, -1.0)
                .step(1.0)
                .hidden()
                .into(),
            knob("scrub", "SCRUB", -1.0, 1.0, -1.0).hidden().into(),
            knob("play", "PLAY", -1.0, 1e9, -1.0).hidden().into(),
        ],
        normals: vec![],
        display: Some(crate::spec::Display {
            lanes: 4,
            kind: "wave",
        }),
    }
}

// inputs, knobs, fixed values and outputs by position
const TRIG: usize = 0;
const PITCH_IN: usize = 1;
const SLICE_IN: usize = 2;
const START_IN: usize = 3;
const PITCH: usize = 0;
const START: usize = 1;
const LEN: usize = 2;
const DEC: usize = 3;
const LVL: usize = 4;
const SLICES: usize = 5;
const MODE: usize = 0;
const REV: usize = 1;
const AUTO: usize = 2;
const SAMPLE: usize = 3;
const SCRUB: usize = 4;
const PLAY: usize = 5;
const EOC: usize = 2;

const LOOP: u32 = 1;
const SLICE: u32 = 2;
/// voices sounding at once (ONE, SLICE); two more slots let stolen voices fade
const VOICES: usize = 4;
const SLOTS: usize = VOICES + 2;

#[derive(Clone, Copy, Default)]
struct Voice {
    on: bool,
    looping: bool,
    rev: bool,
    /// the region, in frames: [a, b)
    a: f64,
    b: f64,
    pos: f64,
    /// samples since the start (or the last loop seam)
    t: u64,
    /// samples since the voice began (DEC)
    life: u64,
    /// a stolen voice: samples of its fade left
    fade_out: u32,
    /// the order voices started in
    born: u64,
}

pub struct Sampler {
    sample_rate: f64,
    fade: f64,
    pulse: u32,
    voices: [Voice; SLOTS],
    born: u64,
    trig_high: bool,
    next_slice: usize,
    eoc_left: u32,
    /// the newest voice's position 0…1, −1 silent
    pos: f32,
    /// the scrub voice: sounding, its position in frames, its gain 0…1
    sc_on: bool,
    sc_pos: f64,
    sc_g: f64,
    /// the last `play` value acted on
    last_play: f64,
}

impl Sampler {
    pub fn new(sample_rate: f64) -> Self {
        Sampler {
            sample_rate,
            fade: (0.001 * sample_rate).max(1.0),
            pulse: ((0.001 * sample_rate).round() as u32).max(1),
            voices: [Voice::default(); SLOTS],
            born: 0,
            trig_high: false,
            next_slice: 0,
            eoc_left: 0,
            pos: -1.0,
            sc_on: false,
            sc_pos: 0.0,
            sc_g: 0.0,
            last_play: -1.0,
        }
    }

    /// Slice `k` of `n` in the region [a, b): equal parts, or (AUTO) cut at the hits at least `min` strong.
    fn slice(s: &Sample, a: f64, b: f64, n: usize, k: usize, auto: bool, min: f32) -> (f64, f64) {
        if !auto {
            let w = (b - a) / n as f64;
            return (a + w * k as f64, a + w * (k + 1) as f64);
        }
        let mut lo = a;
        let mut j = 0;
        for &(at, strength) in &s.hits {
            let at = at as f64;
            if strength < min || at <= a || at >= b {
                continue;
            }
            if j == k {
                return (lo, at);
            }
            lo = at;
            j += 1;
        }
        (lo, b)
    }

    /// The number of slices AUTO finds in [a, b).
    fn auto_count(s: &Sample, a: f64, b: f64, min: f32) -> usize {
        1 + s
            .hits
            .iter()
            .filter(|&&(at, st)| st >= min && (at as f64) > a && (at as f64) < b)
            .count()
    }

    /// A voice into a free slot (or the oldest fading one's); the oldest sounding voice fades out when `limit` sound.
    fn start(&mut self, a: f64, b: f64, rev: bool, looping: bool, limit: usize) {
        if b - a < 1.0 {
            return;
        }
        let sounding = self
            .voices
            .iter()
            .filter(|v| v.on && v.fade_out == 0)
            .count();
        if sounding >= limit {
            let fade = self.fade as u32;
            let mut oldest: Option<usize> = None;
            for (k, v) in self.voices.iter().enumerate() {
                if v.on && v.fade_out == 0 && oldest.is_none_or(|o| v.born < self.voices[o].born) {
                    oldest = Some(k);
                }
            }
            if let Some(o) = oldest {
                self.voices[o].fade_out = fade;
            }
        }
        let slot = match self.voices.iter().position(|v| !v.on) {
            Some(k) => k,
            // every slot busy: the oldest fading voice gives way
            None => (0..SLOTS).min_by_key(|&k| self.voices[k].born).unwrap_or(0),
        };
        self.born += 1;
        self.voices[slot] = Voice {
            on: true,
            looping,
            rev,
            a,
            b,
            pos: if rev { b - 1.0 } else { a },
            t: 0,
            life: 0,
            fade_out: 0,
            born: self.born,
        };
    }
}

fn read(ch: &[f32], pos: f64) -> f32 {
    let i0 = pos.floor() as usize;
    let frac = (pos - pos.floor()) as f32;
    let x0 = ch[i0];
    let x1 = ch[(i0 + 1).min(ch.len() - 1)];
    x0 + (x1 - x0) * frac
}

impl Dsp for Sampler {
    fn process(&mut self, io: &mut Io, ctx: &mut Ctx, from: usize, to: usize) {
        let mode = io.fixed[MODE].round() as u32;
        let rev = io.fixed[REV] >= 0.5;
        let auto = io.fixed[AUTO] >= 0.5;
        let sample = ctx.samples.get(io.fixed[SAMPLE].round() as i32);
        let scrub = io.fixed[SCRUB];
        let play = io.fixed[PLAY];
        let glide = 1.0 - (-1.0 / (0.01 * self.sample_rate)).exp();
        let slice_patched = io.connected_in[SLICE_IN];
        let sr = self.sample_rate;
        for i in from..to {
            let Some(s) = sample else {
                // no sample: silence, and every voice ends
                for v in self.voices.iter_mut() {
                    v.on = false;
                }
                io.out[0][i] = 0.0;
                io.out[1][i] = 0.0;
                io.out[EOC][i] = if self.eoc_left > 0 { 1.0 } else { 0.0 };
                self.eoc_left = self.eoc_left.saturating_sub(1);
                self.pos = -1.0;
                self.sc_on = false;
                self.sc_g = 0.0;
                continue;
            };
            let frames = s.frames as f64;
            // the region now
            let st = (io.par[START][i] as f64 + io.inp[START_IN][i] as f64).clamp(0.0, 1.0);
            let a = st * frames;
            let b = ((st + io.par[LEN][i] as f64 * (1.0 - st)) * frames).min(frames);
            let high = io.inp[TRIG][i] > 0.5;
            if high && !self.trig_high {
                match mode {
                    LOOP => {
                        for v in self.voices.iter_mut() {
                            if v.on && v.fade_out == 0 {
                                v.fade_out = self.fade as u32;
                            }
                        }
                        self.start(a, b, rev, true, usize::MAX);
                    }
                    SLICE => {
                        let knob = io.par[SLICES][i].round().clamp(2.0, 64.0);
                        let min = 1.0 - (knob - 2.0) / 62.0;
                        let n = if auto {
                            Self::auto_count(s, a, b, min)
                        } else {
                            knob as usize
                        };
                        let k = if slice_patched {
                            ((io.inp[SLICE_IN][i].clamp(0.0, 1.0) * n as f32) as usize).min(n - 1)
                        } else {
                            let k = self.next_slice % n;
                            self.next_slice = k + 1;
                            k
                        };
                        let (sa, sb) = Self::slice(s, a, b, n, k, auto, min);
                        self.start(sa, sb, rev, false, VOICES);
                    }
                    // ONE
                    _ => self.start(a, b, rev, false, VOICES),
                }
            }
            self.trig_high = high;
            if play != self.last_play {
                self.last_play = play;
                if play >= 0.0 {
                    // the slice holding position p, played once (a click on SLICE's display)
                    let p = (play - play.floor()) * frames;
                    let knob = io.par[SLICES][i].round().clamp(2.0, 64.0);
                    let min = 1.0 - (knob - 2.0) / 62.0;
                    let n = if auto {
                        Self::auto_count(s, a, b, min)
                    } else {
                        knob as usize
                    };
                    for k in 0..n {
                        let (sa, sb) = Self::slice(s, a, b, n, k, auto, min);
                        if p >= sa && (p < sb || k == n - 1) {
                            self.start(sa, sb, rev, false, VOICES);
                            break;
                        }
                    }
                }
            }

            let rate = (io.par[PITCH][i] as f64 / 12.0 + io.inp[PITCH_IN][i] as f64).exp2();
            let dec = io.par[DEC][i] as f64;
            let decays = dec < 9.999;
            let lvl = io.par[LVL][i];
            let (mut l, mut r) = (0.0f32, 0.0f32);
            let mut newest = 0u64;
            self.pos = -1.0;
            for k in 0..SLOTS {
                let v = &mut self.voices[k];
                if !v.on {
                    continue;
                }
                // positions follow the current sample (it may have been replaced by a shorter one)
                if v.pos < 0.0 || v.pos >= frames || v.b > frames {
                    v.on = false;
                    continue;
                }
                let left = if v.rev {
                    (v.pos - v.a) / rate + 1.0
                } else {
                    (v.b - v.pos) / rate
                };
                let mut g = ((v.t + 1) as f64 / self.fade)
                    .min(1.0)
                    .min(left / self.fade);
                if decays {
                    g *= (-(v.life as f64) / (dec * sr)).exp();
                }
                if v.fade_out > 0 {
                    g *= v.fade_out as f64 / self.fade;
                }
                let g = g as f32 * lvl;
                l += read(&s.channels[0], v.pos) * g;
                r += read(&s.channels[1], v.pos) * g;
                if v.born > newest {
                    newest = v.born;
                    self.pos = (v.pos / frames) as f32;
                }
                v.t += 1;
                v.life += 1;
                if v.fade_out > 0 {
                    v.fade_out -= 1;
                    if v.fade_out == 0 {
                        v.on = false;
                        continue;
                    }
                }
                v.pos += if v.rev { -rate } else { rate };
                let past = if v.rev { v.pos < v.a } else { v.pos >= v.b };
                if past {
                    self.eoc_left = self.pulse;
                    if v.looping {
                        // the next pass, over the region as it is now
                        let over = if v.rev { v.a - v.pos } else { v.pos - v.b };
                        v.a = a;
                        v.b = b;
                        v.t = 0;
                        v.pos = if v.rev { b - 1.0 - over } else { a + over };
                        if b - a < 1.0 {
                            v.on = false;
                        }
                    } else {
                        v.on = false;
                    }
                }
            }
            // the scrub voice: it follows `scrub` through a one-pole glide, with 1 ms fades at both ends
            let last = (frames - 1.0).max(0.0);
            if scrub >= 0.0 {
                let to = scrub.min(1.0) * last;
                if self.sc_on {
                    self.sc_pos += (to - self.sc_pos) * glide;
                } else {
                    self.sc_on = true;
                    self.sc_pos = to;
                }
                self.sc_g = (self.sc_g + 1.0 / self.fade).min(1.0);
            } else if self.sc_on {
                self.sc_g -= 1.0 / self.fade;
                if self.sc_g <= 0.0 {
                    self.sc_on = false;
                    self.sc_g = 0.0;
                }
            }
            if self.sc_on {
                let at = self.sc_pos.clamp(0.0, last);
                let g = self.sc_g as f32 * lvl;
                l += read(&s.channels[0], at) * g;
                r += read(&s.channels[1], at) * g;
                if self.pos < 0.0 {
                    self.pos = (at / frames) as f32;
                }
            }
            io.out[0][i] = l;
            io.out[1][i] = r;
            io.out[EOC][i] = if self.eoc_left > 0 { 1.0 } else { 0.0 };
            self.eoc_left = self.eoc_left.saturating_sub(1);
        }
    }

    fn reset(&mut self) {
        self.voices = [Voice::default(); SLOTS];
        self.eoc_left = 0;
        self.next_slice = 0;
        self.pos = -1.0;
        self.sc_on = false;
        self.sc_g = 0.0;
        self.last_play = -1.0;
    }

    fn state(&self) -> f32 {
        self.pos
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::dsp::bench::Bench;
    use crate::dsp::BLOCK;

    const SR: f64 = 48_000.0;

    fn sample(l: Vec<f32>, hits: Vec<(usize, f32)>) -> Sample {
        Sample {
            frames: l.len(),
            channels: [l.clone(), l],
            hits,
        }
    }
    /// 0.1 → 1.0 over `n` frames
    fn ramp(n: usize) -> Vec<f32> {
        (0..n).map(|i| 0.1 + 0.9 * i as f32 / n as f32).collect()
    }
    /// [pitch, start, len, dec, lvl, slices], [mode, rev, auto]
    fn bench(sr: f64, s: Sample, par: [f64; 6], fixed: [f64; 3]) -> Bench {
        let mut b = Bench::new(
            sr,
            4,
            &par,
            &[fixed[0], fixed[1], fixed[2], 0.0, -1.0, -1.0],
            3,
        );
        b.connected_in = vec![true, false, false, false];
        b.ctx.samples.insert(0, s);
        b
    }
    const PLAIN: [f64; 6] = [0.0, 0.0, 1.0, 10.0, 1.0, 8.0];
    /// triggers (1 ms) at these samples
    fn trigs(at: &'static [usize]) -> impl FnMut(usize, usize, &mut [[f32; BLOCK]]) {
        move |blk, i, inp| {
            let n = blk * BLOCK + i;
            inp[TRIG][i] = if at.iter().any(|&t| n >= t && n < t + 48) {
                1.0
            } else {
                0.0
            };
        }
    }
    fn sounding(s: &[f32]) -> usize {
        s.iter().filter(|x| x.abs() > 0.0).count()
    }
    fn rises(s: &[f32]) -> Vec<usize> {
        (0..s.len())
            .filter(|&i| s[i] > 0.5 && (i == 0 || s[i - 1] <= 0.5))
            .collect()
    }
    fn max_step(s: &[f32]) -> f32 {
        s.windows(2).fold(0.0, |a, w| a.max((w[1] - w[0]).abs()))
    }

    #[test]
    fn one_plays_the_file_once_and_fires_eoc_at_its_end() {
        let mut b = bench(SR, sample(ramp(48_000), vec![]), PLAIN, [0.0, 0.0, 0.0]);
        let o = b.run(&mut Sampler::new(SR), 500, trigs(&[100]));
        assert!(sounding(&o[0]).abs_diff(48_000) <= 1, "{}", sounding(&o[0]));
        assert_eq!(o[0], o[1]);
        assert!(
            rises(&o[EOC])[0].abs_diff(48_100) <= 1,
            "{:?}",
            rises(&o[EOC])
        );
        // PITCH +12: half as long
        let mut b = bench(
            SR,
            sample(ramp(48_000), vec![]),
            [12.0, 0.0, 1.0, 10.0, 1.0, 8.0],
            [0.0, 0.0, 0.0],
        );
        let o = b.run(&mut Sampler::new(SR), 500, trigs(&[100]));
        assert!(sounding(&o[0]).abs_diff(24_000) <= 1, "{}", sounding(&o[0]));
    }

    #[test]
    fn rev_plays_the_ramp_down() {
        let mut b = bench(SR, sample(ramp(48_000), vec![]), PLAIN, [0.0, 1.0, 0.0]);
        let o = b.run(&mut Sampler::new(SR), 500, trigs(&[0]));
        assert!(o[0][1000] > 0.95 && o[0][47_000] < 0.15 && o[0][1000] > o[0][2000]);
    }

    #[test]
    fn start_and_len_choose_the_region() {
        // START 0.25, LEN 0.5 of the rest: from 12 000 for 18 000 frames
        let mut b = bench(
            SR,
            sample(ramp(48_000), vec![]),
            [0.0, 0.25, 0.5, 10.0, 1.0, 8.0],
            [0.0, 0.0, 0.0],
        );
        let o = b.run(&mut Sampler::new(SR), 300, trigs(&[0]));
        assert!(sounding(&o[0]).abs_diff(18_000) <= 1, "{}", sounding(&o[0]));
        assert!((o[0][100] - (0.1 + 0.9 * 12_100.0 / 48_000.0)).abs() < 1e-3);
    }

    #[test]
    fn four_voices_then_a_fifth_steals_the_oldest_with_a_short_fade() {
        let mut b = bench(
            SR,
            sample(vec![0.2; 48_000], vec![]),
            PLAIN,
            [0.0, 0.0, 0.0],
        );
        let o = b.run(
            &mut Sampler::new(SR),
            100,
            trigs(&[0, 1000, 2000, 3000, 4000]),
        );
        assert!(
            (o[0][3500] - 0.8).abs() < 1e-3,
            "four voices: {}",
            o[0][3500]
        );
        assert!(
            (o[0][4500] - 0.8).abs() < 1e-3,
            "still four after the steal: {}",
            o[0][4500]
        );
        assert!(max_step(&o[0]) <= 0.05, "{}", max_step(&o[0]));
    }

    #[test]
    fn loop_repeats_the_region_with_eoc_each_pass() {
        let mut b = bench(SR, sample(ramp(4_800), vec![]), PLAIN, [1.0, 0.0, 0.0]);
        let o = b.run(&mut Sampler::new(SR), 200, trigs(&[0]));
        let r = rises(&o[EOC]);
        assert!(
            r.len() >= 5 && r.windows(2).all(|w| w[1] - w[0] == 4_800),
            "{r:?}"
        );
        assert!(o[0][20_000].abs() > 0.1, "still playing");
    }

    #[test]
    fn slice_plays_the_next_eighth_per_trigger_and_wraps() {
        let n = 48_000;
        let mut b = bench(SR, sample(ramp(n), vec![]), PLAIN, [2.0, 0.0, 0.0]);
        let at: &'static [usize] = &[
            0, 10_000, 20_000, 30_000, 40_000, 50_000, 60_000, 70_000, 80_000,
        ];
        let o = b.run(&mut Sampler::new(SR), 700, trigs(at));
        for (k, &t) in at.iter().enumerate() {
            let expect = 0.1 + 0.9 * ((k % 8) * n / 8 + 100) as f32 / n as f32;
            assert!(
                (o[0][t + 100] - expect).abs() < 1e-3,
                "slice {k}: {} vs {expect}",
                o[0][t + 100]
            );
        }
        assert!(sounding(&o[0][..10_000]).abs_diff(6_000) <= 1);
    }

    #[test]
    fn the_slice_input_picks_the_slice() {
        let n = 48_000;
        let mut b = bench(SR, sample(ramp(n), vec![]), PLAIN, [2.0, 0.0, 0.0]);
        b.connected_in[SLICE_IN] = true;
        let o = b.run(&mut Sampler::new(SR), 100, |blk, i, inp| {
            inp[TRIG][i] = if blk * BLOCK + i < 48 { 1.0 } else { 0.0 };
            inp[SLICE_IN][i] = 0.6;
        });
        let expect = 0.1 + 0.9 * (4 * n / 8 + 100) as f32 / n as f32;
        assert!((o[0][100] - expect).abs() < 1e-3, "{}", o[0][100]);
    }

    #[test]
    fn auto_cuts_at_the_hits() {
        let n = 48_000;
        let hits = vec![(4_800, 0.9), (16_800, 0.3), (28_800, 1.0)];
        // SLICES at 64: SENS 1, every hit counts
        let mut b = bench(
            SR,
            sample(ramp(n), hits),
            [0.0, 0.0, 1.0, 10.0, 1.0, 64.0],
            [2.0, 0.0, 1.0],
        );
        let o = b.run(
            &mut Sampler::new(SR),
            900,
            trigs(&[0, 20_000, 40_000, 70_000, 110_000]),
        );
        let at = |t: usize| ((o[0][t + 100] - 0.1) / 0.9 * n as f32).round() as usize;
        assert_eq!(
            [at(0), at(20_000), at(40_000), at(70_000), at(110_000)],
            [100, 4_900, 16_900, 28_900, 100]
        );
        assert!(sounding(&o[0][..20_000]).abs_diff(4_800) <= 1);
    }

    #[test]
    fn dec_falls_60_db_in_6_9_dec() {
        let mut b = bench(
            SR,
            sample(vec![1.0; 96_000], vec![]),
            [0.0, 0.0, 1.0, 0.1, 1.0, 8.0],
            [0.0, 0.0, 0.0],
        );
        let o = b.run(&mut Sampler::new(SR), 500, trigs(&[0]));
        let t = o[0].iter().position(|x| *x < 1e-3).unwrap() as f64 / SR;
        assert!((t / 0.69 - 1.0).abs() <= 0.1, "{t}");
    }

    #[test]
    fn a_1_s_file_at_44_1_k_plays_44_100_samples() {
        let sr = 44_100.0;
        let mut b = bench(sr, sample(ramp(44_100), vec![]), PLAIN, [0.0, 0.0, 0.0]);
        let o = b.run(&mut Sampler::new(sr), 400, trigs(&[0]));
        assert!(sounding(&o[0]).abs_diff(44_100) <= 2);
    }

    #[test]
    fn a_shorter_sample_mid_play_ends_the_voice_and_none_plays_silence() {
        let mut b = bench(SR, sample(ramp(48_000), vec![]), PLAIN, [0.0, 0.0, 0.0]);
        let mut d = Sampler::new(SR);
        b.run(&mut d, 100, trigs(&[0]));
        b.ctx.samples.insert(0, sample(ramp(4_800), vec![]));
        let o = b.run(&mut d, 100, |_, i, inp| inp[TRIG][i] = 0.0);
        assert!(o[0].iter().all(|x| x.is_finite()) && sounding(&o[0]) == 0);
        assert_eq!(d.state(), -1.0);
        // no sample
        b.fixed[SAMPLE] = -1.0;
        let o = b.run(&mut d, 100, trigs(&[0]));
        assert_eq!(sounding(&o[0]), 0);
    }

    /// Run `blocks` blocks with `scrub(block)` as the scrub value of each; the outputs concatenated
    fn scrubbed(
        b: &mut Bench,
        d: &mut Sampler,
        blocks: usize,
        scrub: impl Fn(usize) -> f64,
    ) -> Vec<f32> {
        let mut out = vec![];
        for k in 0..blocks {
            b.fixed[SCRUB] = scrub(k);
            out.extend_from_slice(&b.run(d, 1, |_, i, inp| inp[TRIG][i] = 0.0)[0]);
        }
        out
    }

    #[test]
    fn scrub_sounds_the_file_at_the_pointer() {
        let mut b = bench(SR, sample(ramp(48_000), vec![]), PLAIN, [0.0, 0.0, 0.0]);
        let mut d = Sampler::new(SR);
        // 20 ms = 960 samples = 15 blocks
        let o = scrubbed(&mut b, &mut d, 20, |_| 0.5);
        let want = 0.1 + 0.9 * 0.5;
        assert!((o[o.len() - 1] - want).abs() < 0.01, "{}", o[o.len() - 1]);
        assert!(o[0].abs() < 0.05, "fades in: {}", o[0]);
        assert!((d.state() - 0.5).abs() < 0.01);
    }

    #[test]
    fn scrub_moving_makes_a_rising_ramp_without_steps() {
        let mut b = bench(SR, sample(ramp(48_000), vec![]), PLAIN, [0.0, 0.0, 0.0]);
        let mut d = Sampler::new(SR);
        scrubbed(&mut b, &mut d, 40, |_| 0.2);
        // 0.2 → 0.8 over 100 ms (75 blocks of 64)
        let o = scrubbed(&mut b, &mut d, 75, |k| 0.2 + 0.6 * k as f64 / 74.0);
        assert!(max_step(&o) < 0.05, "{}", max_step(&o));
        assert!(o[o.len() - 1] > o[0] + 0.2);
        assert!(o.windows(2).all(|w| w[1] >= w[0] - 1e-6));
    }

    #[test]
    fn scrub_off_is_silent_within_2_ms() {
        let mut b = bench(SR, sample(ramp(48_000), vec![]), PLAIN, [0.0, 0.0, 0.0]);
        let mut d = Sampler::new(SR);
        scrubbed(&mut b, &mut d, 20, |_| 0.5);
        let o = scrubbed(&mut b, &mut d, 3, |_| -1.0);
        assert!(o[96..].iter().all(|x| *x == 0.0), "{:?}", &o[90..100]);
        assert!(o.iter().all(|x| x.is_finite() && *x >= 0.0));
        assert_eq!(d.state(), -1.0);
    }

    #[test]
    fn a_scrub_voice_sums_with_a_triggered_voice() {
        let mut b = bench(
            SR,
            sample(vec![0.2; 48_000], vec![]),
            [0.0, 0.0, 1.0, 10.0, 0.5, 8.0],
            [0.0, 0.0, 0.0],
        );
        let mut d = Sampler::new(SR);
        b.fixed[SCRUB] = 0.5;
        let o = b.run(&mut d, 40, trigs(&[0]));
        // 0.2 · LVL 0.5 each
        assert!((o[0][2000] - 0.2).abs() < 1e-3, "{}", o[0][2000]);
        assert_eq!(o[0], o[1]);
    }

    #[test]
    fn a_shorter_sample_mid_scrub_stays_finite() {
        let mut b = bench(SR, sample(ramp(48_000), vec![]), PLAIN, [0.0, 0.0, 0.0]);
        let mut d = Sampler::new(SR);
        scrubbed(&mut b, &mut d, 30, |_| 0.95);
        b.ctx.samples.insert(0, sample(ramp(100), vec![]));
        let o = scrubbed(&mut b, &mut d, 30, |_| 0.95);
        assert!(o.iter().all(|x| x.is_finite()));
        b.ctx.samples.insert(0, sample(ramp(1), vec![]));
        let o = scrubbed(&mut b, &mut d, 5, |_| 1.0);
        assert!(o.iter().all(|x| x.is_finite()));
    }

    #[test]
    fn play_plays_the_slice_under_the_position_once() {
        // 4 equal slices of a 48 000-frame ramp; position 0.6 is slice 2 (24 000…36 000)
        let mut b = bench(
            SR,
            sample(ramp(48_000), vec![]),
            [0.0, 0.0, 1.0, 10.0, 1.0, 4.0],
            [2.0, 0.0, 0.0],
        );
        let mut d = Sampler::new(SR);
        b.fixed[PLAY] = 3.0 + 0.6; // the third click
        let o = b.run(&mut d, 400, |_, i, inp| inp[TRIG][i] = 0.0);
        assert!(sounding(&o[0]).abs_diff(12_000) <= 1, "{}", sounding(&o[0]));
        assert!((o[0][100] - (0.1 + 0.9 * 24_100.0 / 48_000.0)).abs() < 1e-3);
        // the same value does not play again; a new one does; −1 re-arms
        let o = b.run(&mut d, 400, |_, i, inp| inp[TRIG][i] = 0.0);
        assert_eq!(sounding(&o[0]), 0);
        b.fixed[PLAY] = 4.0 + 0.1;
        let o = b.run(&mut d, 400, |_, i, inp| inp[TRIG][i] = 0.0);
        assert!(sounding(&o[0]) > 11_000);
    }

    #[test]
    fn state_is_the_newest_voice_position() {
        let mut b = bench(SR, sample(ramp(48_000), vec![]), PLAIN, [0.0, 0.0, 0.0]);
        let mut d = Sampler::new(SR);
        assert_eq!(d.state(), -1.0);
        b.run(&mut d, 188, trigs(&[0])); // 24 064 samples
        assert!((d.state() - 0.5).abs() < 0.01, "{}", d.state());
    }

    #[test]
    fn blockwise_equals_per_sample() {
        let trig: Vec<f32> = (0..40 * BLOCK)
            .map(|i| if i % 900 < 48 { 1.0 } else { 0.0 })
            .collect();
        let slice: Vec<f32> = (0..40 * BLOCK)
            .map(|i| (i % 1000) as f32 / 1000.0)
            .collect();
        for mode in [0.0, 1.0, 2.0] {
            for rev in [0.0, 1.0] {
                Bench::blockwise_equals_per_sample_with(
                    || Box::new(Sampler::new(SR)),
                    |ctx| {
                        ctx.samples
                            .insert(0, sample(ramp(3_000), vec![(700, 1.0), (1_900, 0.5)]))
                    },
                    &[
                        trig.clone(),
                        vec![],
                        if mode == 2.0 { slice.clone() } else { vec![] },
                        vec![],
                    ],
                    &[3.0, 0.1, 0.8, 0.5, 0.8, 5.0],
                    &[mode, rev, 1.0, 0.0, -1.0, -1.0],
                    3,
                    40,
                );
            }
        }
    }
}
