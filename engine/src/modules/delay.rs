//! DELAY (spec §7a): up to 2 s; TYPE DIGI (clean; CHAR = bit depth and rate reduction on the wet signal), TAPE (wow
//! and flutter, saturation and high loss on everything recorded; CHAR = wear), SPRING (a dispersive allpass chain on
//! the wet signal; CHAR = drip). PING alternates repeats between L and R. With CLK patched TIME snaps to the division
//! of the clock's period nearest the knob. Changing TYPE crossfades 10 ms.

use crate::dsp::{Ctx, Dsp, Io};
use crate::spec::{choice, knob, port, ModuleSpec, Role, Unit};

pub fn spec() -> ModuleSpec {
    ModuleSpec {
        type_: "delay",
        internal: false,
        label: "DELAY",
        desc: "echo: digital, tape, spring",
        size: (6, 1),
        inputs: vec![
            port("in", "IN", Role::Audio),
            port("clk", "CLK", Role::Trigger),
        ],
        outputs: vec![port("l", "L", Role::Audio), port("r", "R", Role::Audio)],
        params: vec![
            knob("time", "TIME", 0.001, 2.0, 0.3)
                .exp()
                .unit(Unit::S)
                .random(0.05, 1.0)
                .into(),
            knob("feedback", "FB", 0.0, 0.95, 0.4).into(),
            knob("mix", "MIX", 0.0, 1.0, 0.3).into(),
            knob("char", "CHAR", 0.0, 1.0, 0.0).into(),
            choice("type", "TYPE", &["DIGI", "TAPE", "SPRING"], 0).into(),
            choice("ping", "PING", &["OFF", "ON"], 0).into(),
        ],
        normals: vec![],
        display: None,
    }
}

const MAX_S: f64 = 2.0;
const DIGI: usize = 0;
const TAPE: usize = 1;
const SPRING: usize = 2;
/// TIME's divisions of the clock's period
const DIVISIONS: [f64; 8] = [1.0 / 16.0, 1.0 / 8.0, 0.25, 0.5, 1.0, 2.0, 3.0, 4.0];
const STAGES: usize = 12;

/// One line and the wet-path state of each TYPE (all run while a TYPE change crossfades).
struct Line {
    buf: Vec<f32>,
    /// TAPE: the record head's high loss
    tape_lp: f64,
    /// SPRING: the allpass chain
    ap: [(f64, f64); STAGES],
    /// DIGI: the held sample and the samples left until the next one
    held: f32,
    hold_left: u32,
}

impl Line {
    fn new(len: usize) -> Self {
        Line {
            buf: vec![0.0; len],
            tape_lp: 0.0,
            ap: [(0.0, 0.0); STAGES],
            held: 0.0,
            hold_left: 0,
        }
    }
    fn read(&self, write: usize, d: f64) -> f32 {
        let n = self.buf.len();
        let pos = write as f64 - d + n as f64;
        let (i0, frac) = (pos.floor() as usize % n, (pos - pos.floor()) as f32);
        self.buf[i0] * (1.0 - frac) + self.buf[(i0 + 1) % n] * frac
    }
}

pub struct Delay {
    sample_rate: f64,
    l: Line,
    r: Line,
    write: usize,
    /// the delay in samples now (glides toward a clock division)
    d: f64,
    // CLK: the samples since the last rise and the period between the last two
    clk_high: bool,
    since: u64,
    period: f64,
    // TAPE's wow and flutter, SPRING's drip
    phase_wow: f64,
    phase_flutter: f64,
    drip: f64,
    rng: u32,
    // TYPE crossfade
    ty: usize,
    old: usize,
    fade_left: u32,
    fade_len: u32,
    started: bool,
}

impl Delay {
    pub fn new(sample_rate: f64) -> Self {
        // allocated here, never in process (2 s plus the tape's modulation)
        let len = (MAX_S * sample_rate) as usize + (0.01 * sample_rate) as usize + 4;
        Delay {
            sample_rate,
            l: Line::new(len),
            r: Line::new(len),
            write: 0,
            d: 0.0,
            clk_high: false,
            since: 0,
            period: 0.0,
            phase_wow: 0.0,
            phase_flutter: 0.0,
            drip: 0.0,
            rng: 0x9e37_79b9,
            ty: DIGI,
            old: DIGI,
            fade_left: 0,
            fade_len: ((0.01 * sample_rate) as u32).max(1),
            started: false,
        }
    }

    /// The wet signal of one line for a TYPE: what is heard, and what the feedback records.
    #[allow(clippy::too_many_arguments)]
    fn wet(line: &mut Line, ty: usize, raw: f32, ch: f64, sr: f64, drip: f64, update: bool) -> f32 {
        match ty {
            DIGI => {
                if ch <= 0.0 {
                    return raw;
                }
                // rate reduction: hold a sample for 1 + 15·CHAR² samples; then fewer bits
                if update {
                    if line.hold_left == 0 {
                        line.held = raw;
                        line.hold_left = (1.0 + 15.0 * ch * ch).round() as u32;
                    }
                    line.hold_left -= 1;
                }
                let steps = 2f64.powf(16.0 - 12.0 * ch - 1.0);
                ((line.held as f64 * steps).round() / steps) as f32
            }
            SPRING => {
                // a chain of first-order allpasses: the chirp; the drip wobbles their coefficient
                let a = (0.6 + 0.3 * ch + 0.08 * ch * drip).clamp(-0.95, 0.95);
                let mut v = raw as f64;
                for st in line.ap.iter_mut() {
                    let y = -a * v + st.0 + a * st.1;
                    if update {
                        st.0 = v;
                        st.1 = y;
                    }
                    v = y;
                }
                let _ = sr;
                v as f32
            }
            _ => raw,
        }
    }
}

impl Dsp for Delay {
    fn process(&mut self, io: &mut Io, _ctx: &mut Ctx, from: usize, to: usize) {
        let sr = self.sample_rate;
        let n = self.l.buf.len();
        let ty = (io.fixed[0].round().max(0.0) as usize).min(SPRING);
        let ping = io.fixed[1] >= 0.5;
        let clocked = io.connected_in[1];
        if !self.started {
            self.started = true;
            self.ty = ty;
            self.old = ty;
            self.d = (io.par[0][from] as f64 * sr).clamp(1.0, (n - 2) as f64);
        }
        for i in from..to {
            if ty != self.ty {
                self.old = self.ty;
                self.ty = ty;
                self.fade_left = self.fade_len;
            }
            // CLK: the period between rises
            self.since += 1;
            let high = io.inp[1][i] > 0.5;
            if high && !self.clk_high {
                if self.since > 1 {
                    self.period = self.since as f64;
                }
                self.since = 0;
            }
            self.clk_high = high;
            let knob = io.par[0][i] as f64 * sr;
            let target = if clocked && self.period > 0.0 {
                // the division of the clock's period nearest the knob, gliding there over ~10 ms
                let t = DIVISIONS
                    .iter()
                    .map(|k| k * self.period)
                    .fold(f64::MAX, |best, v| {
                        if (v - knob).abs() < (best - knob).abs() {
                            v
                        } else {
                            best
                        }
                    });
                let step = (t - self.d) / (0.01 * sr) * 4.0;
                if (t - self.d).abs() <= step.abs().max(0.5) {
                    t
                } else {
                    self.d + step
                }
            } else {
                knob
            };
            self.d = target;
            let ch = io.par[3][i] as f64;
            // TAPE: wow (0.6 Hz) and flutter (7 Hz) move the read head
            self.phase_wow = (self.phase_wow + 0.6 / sr).fract();
            self.phase_flutter = (self.phase_flutter + 7.0 / sr).fract();
            let tape_mod = ch
                * sr
                * (0.002 * (std::f64::consts::TAU * self.phase_wow).sin()
                    + 0.000_15 * (std::f64::consts::TAU * self.phase_flutter).sin());
            // SPRING: a slow random walk of the drip
            self.rng = self.rng.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
            let noise = (self.rng >> 8) as f64 / (1u32 << 24) as f64 - 0.5;
            self.drip = (self.drip + noise * 0.002).clamp(-1.0, 1.0);

            let x = io.inp[0][i];
            let fb = io.par[1][i];
            let mix = io.par[2][i];
            let read = |line: &Line, t: usize| {
                let dd = if t == TAPE { self.d + tape_mod } else { self.d };
                line.read(self.write, dd.clamp(1.0, (n - 2) as f64))
            };
            let types: [usize; 2] = [self.ty, self.old];
            let fading = self.fade_left > 0;
            let t_new = if fading {
                1.0 - self.fade_left as f32 / self.fade_len as f32
            } else {
                1.0
            };
            let (mut wl, mut wr) = (0.0f32, 0.0f32);
            for (k, &t) in types.iter().enumerate() {
                if k == 1 && !fading {
                    break;
                }
                let w = if k == 0 { t_new } else { 1.0 - t_new };
                let rl = read(&self.l, t);
                let rr = read(&self.r, t);
                wl += w * Self::wet(&mut self.l, t, rl, ch, sr, self.drip, k == 0);
                wr += w * Self::wet(&mut self.r, t, rr, ch, sr, self.drip, k == 0);
            }
            if fading {
                self.fade_left -= 1;
            }
            // what is recorded: PING sends L's repeats to R and R's back to L; TAPE records through its head
            let (in_l, in_r) = if ping {
                (x + fb * wr, fb * wl)
            } else {
                (x + fb * wl, 0.0)
            };
            let tape = |line: &mut Line, v: f32| {
                let s = (v as f64).tanh();
                let a = 1.0 - (-std::f64::consts::TAU * 12_000.0 * (1.0 - 0.9 * ch) / sr).exp();
                line.tape_lp += a * (s - line.tape_lp);
                line.tape_lp as f32
            };
            let rec_l = if self.ty == TAPE {
                tape(&mut self.l, in_l)
            } else {
                in_l
            };
            let rec_r = if self.ty == TAPE {
                tape(&mut self.r, in_r)
            } else {
                in_r
            };
            self.l.buf[self.write] = rec_l + 1e-20;
            self.r.buf[self.write] = rec_r + 1e-20;
            self.write = (self.write + 1) % n;
            let out_r = if ping { wr } else { wl };
            io.out[0][i] = x * (1.0 - mix) + wl * mix;
            io.out[1][i] = x * (1.0 - mix) + out_r * mix;
        }
    }

    fn reset(&mut self) {
        for line in [&mut self.l, &mut self.r] {
            line.buf.fill(0.0);
            line.tape_lp = 0.0;
            line.ap = [(0.0, 0.0); STAGES];
            line.held = 0.0;
            line.hold_left = 0;
        }
        self.fade_left = 0;
        self.old = self.ty;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::dsp::bench::Bench;
    use crate::dsp::BLOCK;

    /// [time, fb, mix, char], [type, ping]
    fn run(
        sr: f64,
        par: [f64; 4],
        fixed: [f64; 2],
        blocks: usize,
        input: impl Fn(usize) -> f32,
        clk: Option<usize>,
    ) -> Vec<Vec<f32>> {
        let mut b = Bench::new(sr, 2, &par, &fixed, 2);
        b.connected_in = vec![true, clk.is_some()];
        b.run(&mut Delay::new(sr), blocks, |blk, i, inp| {
            let n = blk * BLOCK + i;
            inp[0][i] = input(n);
            inp[1][i] = match clk {
                Some(p) if n % p < 48 => 1.0,
                _ => 0.0,
            };
        })
    }
    fn peak_at(s: &[f32]) -> usize {
        s.iter()
            .enumerate()
            .fold(
                (0, 0.0f32),
                |a, (i, x)| if x.abs() > a.1 { (i, x.abs()) } else { a },
            )
            .0
    }
    fn impulse(n: usize) -> f32 {
        if n == 0 {
            1.0
        } else {
            0.0
        }
    }

    #[test]
    fn an_echo_comes_after_time_at_48k_and_44k1() {
        for sr in [48_000.0, 44_100.0] {
            let o = run(
                sr,
                [0.25, 0.0, 1.0, 0.0],
                [0.0, 0.0],
                (0.3 * sr) as usize / BLOCK,
                impulse,
                None,
            );
            let at = peak_at(&o[0]);
            assert!((at as f64 - 0.25 * sr).abs() <= 2.0, "{sr}: echo at {at}");
        }
    }

    #[test]
    fn feedback_half_takes_6_db_off_each_repeat() {
        let o = run(
            48_000.0,
            [0.05, 0.5, 1.0, 0.0],
            [0.0, 0.0],
            60,
            impulse,
            None,
        );
        let (a, b) = (
            o[0][2400].abs().max(o[0][2401].abs()),
            o[0][4800].abs().max(o[0][4801].abs()),
        );
        assert!((20.0 * (b / a).log10() + 6.02).abs() < 0.5, "{a} then {b}");
    }

    #[test]
    fn ping_alternates_left_right_left() {
        let o = run(
            48_000.0,
            [0.05, 0.8, 1.0, 0.0],
            [0.0, 1.0],
            80,
            impulse,
            None,
        );
        let big = |s: &[f32], at: usize| s[at].abs().max(s[at + 1].abs()) > 0.3;
        assert!(big(&o[0], 2400) && !big(&o[1], 2400), "first repeat left");
        assert!(big(&o[1], 4800) && !big(&o[0], 4800), "second repeat right");
        assert!(big(&o[0], 7200) && !big(&o[1], 7200), "third repeat left");
    }

    #[test]
    fn ping_takes_fb_off_every_repeat() {
        // FB 0.5: L 1, R 0.5, L 0.25; FB 0: one echo only
        let o = run(
            48_000.0,
            [0.05, 0.5, 1.0, 0.0],
            [0.0, 1.0],
            80,
            impulse,
            None,
        );
        let at = |s: &[f32], k: usize| s[k].abs().max(s[k + 1].abs());
        assert!((at(&o[1], 4800) / at(&o[0], 2400) - 0.5).abs() < 0.02);
        assert!((at(&o[0], 7200) / at(&o[0], 2400) - 0.25).abs() < 0.02);
        let o = run(
            48_000.0,
            [0.05, 0.0, 1.0, 0.0],
            [0.0, 1.0],
            80,
            impulse,
            None,
        );
        assert!(at(&o[0], 2400) > 0.5 && at(&o[1], 4800) < 1e-6);
    }

    #[test]
    fn tape_wear_darkens_the_repeats() {
        let burst = |n: usize| {
            if n < 480 {
                (std::f64::consts::TAU * 5000.0 * n as f64 / 48_000.0).sin() as f32
            } else {
                0.0
            }
        };
        let third = |ch: f64| {
            let o = run(48_000.0, [0.05, 0.9, 1.0, ch], [1.0, 0.0], 90, burst, None);
            o[0][3 * 2400 - 200..3 * 2400 + 800]
                .iter()
                .fold(0.0f32, |a, x| a.max(x.abs()))
        };
        let (fresh, worn) = (third(0.0), third(1.0));
        assert!(20.0 * (fresh / worn).log10() >= 12.0, "{fresh} vs {worn}");
    }

    #[test]
    fn digi_char_crushes_the_bits() {
        let sine =
            |n: usize| (0.9 * (std::f64::consts::TAU * 220.0 * n as f64 / 48_000.0).sin()) as f32;
        let levels = |ch: f64| {
            let o = run(48_000.0, [0.01, 0.0, 1.0, ch], [0.0, 0.0], 60, sine, None);
            let mut v: Vec<i64> = o[0][2000..].iter().map(|x| (x * 1e6) as i64).collect();
            v.sort();
            v.dedup();
            v.len()
        };
        assert!(levels(1.0) <= 17, "{}", levels(1.0));
        assert!(levels(0.0) > 1000);
    }

    #[test]
    fn a_clock_snaps_time_to_a_division_of_its_period() {
        // a 0.5 s clock, the knob at 0.24 s: repeats every 0.25 s
        let o = run(
            48_000.0,
            [0.24, 0.0, 1.0, 0.0],
            [0.0, 0.0],
            500,
            |n| if n == 48_000 { 1.0 } else { 0.0 },
            Some(24_000),
        );
        let at = peak_at(&o[0][48_100..]) + 48_100;
        assert!((at as i64 - 60_000).abs() <= 2, "echo at {at}");
    }

    #[test]
    fn switching_type_at_full_feedback_stays_finite_and_smooth() {
        let mut b = Bench::new(48_000.0, 2, &[0.11, 0.95, 0.5, 0.7], &[0.0, 1.0], 2);
        b.connected_in = vec![true, false];
        let mut d = Delay::new(48_000.0);
        let mut prev = 0.0f32;
        for blk in 0..750 {
            b.fixed[0] = ((blk / 37) % 3) as f64;
            let o = b.run(&mut d, 1, |bk, i, inp| {
                inp[0][i] = (0.3
                    * (std::f64::consts::TAU * 110.0 * ((blk + bk) * BLOCK + i) as f64 / 48_000.0)
                        .sin()) as f32
            });
            for x in &o[0] {
                assert!(
                    x.is_finite() && (x - prev).abs() <= 0.5,
                    "block {blk}: {prev} → {x}"
                );
                prev = *x;
            }
        }
    }

    #[test]
    fn blockwise_equals_per_sample() {
        let x: Vec<f32> = (0..30 * BLOCK)
            .map(|i| if i % 500 == 0 { 1.0 } else { 0.0 })
            .collect();
        let clk: Vec<f32> = (0..30 * BLOCK)
            .map(|i| if i % 1200 < 48 { 1.0 } else { 0.0 })
            .collect();
        for ty in [0.0, 1.0, 2.0] {
            for ping in [0.0, 1.0] {
                Bench::blockwise_equals_per_sample(
                    || Box::new(Delay::new(48_000.0)),
                    &[x.clone(), clk.clone()],
                    &[0.013, 0.6, 0.5, 0.6],
                    &[ty, ping],
                    2,
                    30,
                );
            }
        }
    }
}
