//! GRAINS (spec §7a): Hann-windowed grains (up to 64) from a library sample (FILE) or an 8 s ring of IN (LIVE).
//! A grain spawns on a TRIG rise, or DENS times a second while TRIG is unpatched; it reads from POS ± SPRAY / 2,
//! lasts SIZE, plays at PITCH ± DETUNE, backwards with probability REV %, panned within ± SPREAD. FREEZE stops
//! LIVE's recording. The trace: the write head, the grains' positions, the live buffer's peaks.

use crate::dsp::{Ctx, Dsp, Io};
use crate::spec::{choice, knob, port, Display, ModuleSpec, Param, Role, Unit};

pub fn spec() -> ModuleSpec {
    ModuleSpec {
        type_: "grains",
        internal: false,
        label: "GRAINS",
        desc: "granular: a sample or live input, freeze",
        size: (10, 2),
        inputs: vec![
            port("trig", "TRIG", Role::Trigger),
            port("in", "IN", Role::Audio),
            port("pos", "POS", Role::Mod),
            port("pitch", "PTCH", Role::Pitch),
        ],
        outputs: vec![port("l", "L", Role::Audio), port("r", "R", Role::Audio)],
        params: vec![
            knob("pos", "POS", 0.0, 1.0, 0.5).into(),
            knob("size", "SIZE", 0.005, 1.0, 0.1)
                .exp()
                .unit(Unit::S)
                .into(),
            knob("dens", "DENS", 1.0, 200.0, 20.0).exp().into(),
            knob("spray", "SPRAY", 0.0, 1.0, 0.1).into(),
            knob("pitch", "PITCH", -24.0, 24.0, 0.0).step(1.0).into(),
            knob("detune", "DETUNE", 0.0, 1.0, 0.0).into(),
            knob("rev", "REV %", 0.0, 1.0, 0.0).into(),
            knob("spread", "SPREAD", 0.0, 1.0, 0.5).into(),
            choice("source", "SOURCE", &["FILE", "LIVE"], 0).into(),
            choice("freeze", "FREEZE", &["OFF", "ON"], 0).into(),
            Param::Action {
                id: "load",
                label: "LOAD",
            },
            knob("sample", "SAMPLE", -1.0, 1e6, -1.0)
                .step(1.0)
                .hidden()
                .into(),
        ],
        normals: vec![],
        display: Some(Display {
            lanes: 4,
            kind: "grains",
        }),
    }
}

// inputs, knobs, fixed values by position
const TRIG: usize = 0;
const IN: usize = 1;
const POS_IN: usize = 2;
const PITCH_IN: usize = 3;
const POS: usize = 0;
const SIZE: usize = 1;
const DENS: usize = 2;
const SPRAY: usize = 3;
const PITCH: usize = 4;
const DETUNE: usize = 5;
const REV: usize = 6;
const SPREAD: usize = 7;
const SOURCE: usize = 0;
const FREEZE: usize = 1;
const SAMPLE: usize = 2;

pub const MAX_GRAINS: usize = 64;
const LIVE_S: f64 = 8.0;
/// the trace: [0] the write head (0…1, −1 for FILE), [1..65] grain positions (−1 idle), then the live peaks
pub const TRACE_GRAINS: usize = 1;
pub const TRACE_PEAKS: usize = TRACE_GRAINS + MAX_GRAINS;
pub const PEAK_COLUMNS: usize = 512;

#[derive(Clone, Copy, Default)]
struct Grain {
    on: bool,
    /// where it reads (frames of the file, or of the ring)
    pos: f64,
    /// frames per sample; negative plays backwards
    rate: f64,
    t: u32,
    len: u32,
    gl: f32,
    gr: f32,
    /// the Hann window's phase as a rotating unit vector (cos, sin) and its step
    c: f64,
    s: f64,
    dc: f64,
    ds: f64,
}

pub struct Grains {
    sample_rate: f64,
    grains: [Grain; MAX_GRAINS],
    ring: Vec<f32>,
    write: usize,
    /// the running peak of each column of the ring
    trace: Vec<f32>,
    phase: f64,
    trig_high: bool,
    live: bool,
    /// grains spawned so far (tests)
    spawned: u64,
}

impl Grains {
    pub fn new(sample_rate: f64) -> Self {
        let mut trace = vec![0.0; TRACE_PEAKS + PEAK_COLUMNS];
        trace[0] = -1.0;
        for t in &mut trace[TRACE_GRAINS..TRACE_PEAKS] {
            *t = -1.0;
        }
        Grains {
            sample_rate,
            grains: [Grain::default(); MAX_GRAINS],
            ring: vec![0.0; (LIVE_S * sample_rate) as usize],
            write: 0,
            trace,
            phase: 1.0, // the first grain comes at once
            trig_high: false,
            live: false,
            spawned: 0,
        }
    }

    /// Reads `buf` at a fractional position (wrapping when `ring`).
    fn read(buf: &[f32], pos: f64, ring: bool) -> f32 {
        let n = buf.len();
        let p = if ring { pos.rem_euclid(n as f64) } else { pos };
        let i0 = p.floor() as usize;
        let frac = (p - p.floor()) as f32;
        let i1 = if ring {
            (i0 + 1) % n
        } else {
            (i0 + 1).min(n - 1)
        };
        buf[i0.min(n - 1)] + (buf[i1] - buf[i0.min(n - 1)]) * frac
    }
}

impl Dsp for Grains {
    fn process(&mut self, io: &mut Io, ctx: &mut Ctx, from: usize, to: usize) {
        let live = io.fixed[SOURCE] >= 0.5;
        let freeze = io.fixed[FREEZE] >= 0.5;
        let trig_patched = io.connected_in[TRIG];
        let sr = self.sample_rate;
        let n_ring = self.ring.len();
        if live != self.live {
            // the source changed: grains of the other one end
            self.live = live;
            for g in self.grains.iter_mut() {
                g.on = false;
            }
        }
        for i in from..to {
            // LIVE: record IN (not while frozen)
            if live && !freeze {
                let x = io.inp[IN][i];
                self.ring[self.write] = x;
                let col = TRACE_PEAKS + self.write * PEAK_COLUMNS / n_ring;
                let next = (self.write + 1) % n_ring;
                if next * PEAK_COLUMNS / n_ring != self.write * PEAK_COLUMNS / n_ring {
                    // the head moves into a fresh column: it starts again
                    self.trace[TRACE_PEAKS + next * PEAK_COLUMNS / n_ring] = 0.0;
                }
                self.trace[col] = self.trace[col].max(x.abs().min(1.0));
                self.write = next;
            }
            let sample = ctx.samples.get(io.fixed[SAMPLE].round() as i32);
            let frames = if live {
                n_ring
            } else {
                sample.map_or(0, |s| s.frames)
            };
            // spawning
            let high = io.inp[TRIG][i] > 0.5;
            let spawn = if trig_patched {
                high && !self.trig_high
            } else {
                self.phase += io.par[DENS][i] as f64 / sr;
                let due = self.phase >= 1.0;
                if due {
                    self.phase -= 1.0;
                }
                due
            };
            self.trig_high = high;
            if spawn && frames > 1 {
                if let Some(k) = self.grains.iter().position(|g| !g.on) {
                    let rng = &mut ctx.rng;
                    let spray = io.par[SPRAY][i] as f64 * (rng.next_f64() - 0.5);
                    let p =
                        (io.par[POS][i] as f64 + io.inp[POS_IN][i] as f64 + spray).clamp(0.0, 1.0);
                    let det = (rng.next_f64() * 2.0 - 1.0) * 12.0 * io.par[DETUNE][i] as f64;
                    let mut rate = ((io.par[PITCH][i] as f64 + det) / 12.0
                        + io.inp[PITCH_IN][i] as f64)
                        .exp2();
                    if rng.next_f64() < io.par[REV][i] as f64 {
                        rate = -rate;
                    }
                    let len = ((io.par[SIZE][i] as f64 * sr) as u32).max(2);
                    let span = len as f64 * rate.abs();
                    let pos = if live {
                        // POS 1 = the newest audio; a grain never reads past the head
                        let back = ((1.0 - p) * n_ring as f64).max(if freeze {
                            0.0
                        } else {
                            span.max(0.0) + 2.0
                        });
                        let start = self.write as f64 - back;
                        if rate < 0.0 {
                            start + span
                        } else {
                            start
                        }
                    } else {
                        let start = p * (frames as f64 - 1.0);
                        if rate < 0.0 {
                            start.max(span.min(frames as f64 - 1.0))
                        } else {
                            start
                        }
                    };
                    let pan = (rng.next_f64() * 2.0 - 1.0) * io.par[SPREAD][i] as f64;
                    let angle = (pan + 1.0) * std::f64::consts::FRAC_PI_4;
                    let step = std::f64::consts::TAU / len as f64;
                    self.grains[k] = Grain {
                        on: true,
                        pos,
                        rate,
                        t: 0,
                        len,
                        gl: angle.cos() as f32,
                        gr: angle.sin() as f32,
                        c: 1.0,
                        s: 0.0,
                        dc: step.cos(),
                        ds: step.sin(),
                    };
                    self.spawned += 1;
                }
            }
            // playing
            let (mut l, mut r, mut active) = (0.0f32, 0.0f32, 0u32);
            for g in self.grains.iter_mut() {
                if !g.on {
                    continue;
                }
                let (xl, xr) = if live {
                    let x = Self::read(&self.ring, g.pos, true);
                    (x, x)
                } else {
                    match sample {
                        Some(s) if g.pos >= 0.0 && g.pos < s.frames as f64 => (
                            Self::read(&s.channels[0], g.pos, false),
                            Self::read(&s.channels[1], g.pos, false),
                        ),
                        _ => {
                            // no sample, or past its end: the grain ends
                            g.on = false;
                            continue;
                        }
                    }
                };
                // 0.5 − 0.5·cos(2π t / len), the cosine advanced by rotation
                let w = (0.5 - 0.5 * g.c) as f32;
                (g.c, g.s) = (g.c * g.dc - g.s * g.ds, g.s * g.dc + g.c * g.ds);
                l += xl * w * g.gl;
                r += xr * w * g.gr;
                active += 1;
                g.pos += g.rate;
                g.t += 1;
                if g.t >= g.len {
                    g.on = false;
                }
            }
            let norm = 1.0 / (active.max(1) as f32).sqrt();
            io.out[0][i] = l * norm;
            io.out[1][i] = r * norm;
        }
        // the trace
        self.trace[0] = if live {
            self.write as f32 / n_ring as f32
        } else {
            -1.0
        };
        let span = if live {
            n_ring as f64
        } else {
            ctx.samples
                .get(io.fixed[SAMPLE].round() as i32)
                .map_or(1.0, |s| s.frames as f64)
        };
        for (k, g) in self.grains.iter().enumerate() {
            self.trace[TRACE_GRAINS + k] = if !g.on {
                -1.0
            } else if live {
                (g.pos.rem_euclid(span) / span) as f32
            } else {
                (g.pos / span).clamp(0.0, 1.0) as f32
            };
        }
    }

    fn reset(&mut self) {
        self.grains = [Grain::default(); MAX_GRAINS];
        self.ring.fill(0.0);
        for t in &mut self.trace[TRACE_PEAKS..] {
            *t = 0.0;
        }
        self.phase = 1.0;
    }

    fn state(&self) -> f32 {
        self.grains.iter().filter(|g| g.on).count() as f32
    }

    fn trace(&self) -> Option<&[f32]> {
        Some(&self.trace)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::dsp::bench::{rising, Bench};
    use crate::dsp::BLOCK;
    use crate::samples::Sample;

    const SR: f64 = 48_000.0;

    fn sample(l: Vec<f32>) -> Sample {
        Sample {
            frames: l.len(),
            channels: [l.clone(), l],
            hits: vec![],
        }
    }
    fn sine(hz: f64, sr: f64, n: usize) -> Vec<f32> {
        (0..n)
            .map(|i| (std::f64::consts::TAU * hz * i as f64 / sr).sin() as f32 * 0.5)
            .collect()
    }
    /// [pos, size, dens, spray, pitch, detune, rev, spread], [source, freeze]
    fn bench(par: [f64; 8], fixed: [f64; 2], s: Option<Sample>) -> Bench {
        let mut b = Bench::new(SR, 4, &par, &[fixed[0], fixed[1], 0.0], 2);
        b.connected_in = vec![false, true, false, false];
        if let Some(s) = s {
            b.ctx.samples.insert(0, s);
        }
        b
    }
    const PLAIN: [f64; 8] = [0.5, 0.1, 20.0, 0.0, 0.0, 0.0, 0.0, 0.0];

    #[test]
    fn dens_100_spawns_100_grains_a_second_and_a_trig_one_per_rise() {
        let mut b = bench(
            [0.5, 0.005, 100.0, 0.1, 0.0, 0.0, 0.0, 0.5],
            [0.0, 0.0],
            Some(sample(vec![0.5; 48_000])),
        );
        let mut g = Grains::new(SR);
        b.run(&mut g, 375, |_, _, _| {}); // 1 s
        assert!(g.spawned.abs_diff(100) <= 1, "{}", g.spawned);
        let mut b = bench(PLAIN, [0.0, 0.0], Some(sample(vec![0.5; 48_000])));
        b.connected_in[TRIG] = true;
        let mut g = Grains::new(SR);
        b.run(&mut g, 375, |blk, i, inp| {
            inp[TRIG][i] = if (blk * BLOCK + i) % 4800 < 48 {
                1.0
            } else {
                0.0
            }
        });
        assert_eq!(g.spawned, 10);
    }

    #[test]
    fn a_grain_is_hann_over_size() {
        // one grain of 0.1 s over a constant: SPREAD 0 puts it in the middle (cos π/4 each side)
        let mut b = bench(
            [0.5, 0.1, 1.0, 0.0, 0.0, 0.0, 0.0, 0.0],
            [0.0, 0.0],
            Some(sample(vec![1.0; 48_000])),
        );
        let o = b.run(&mut Grains::new(SR), 40, |_, _, _| {});
        let peak = std::f32::consts::FRAC_1_SQRT_2;
        assert!(o[0][0].abs() < 1e-3 && o[0][4799].abs() < 1e-3 && o[0][4800] == 0.0);
        assert!((o[0][2400] - peak).abs() < 1e-3, "{}", o[0][2400]);
        assert!((o[0][1200] - peak * 0.5).abs() < 1e-3, "{}", o[0][1200]);
        assert_eq!(o[0], o[1], "SPREAD 0: L = R");
    }

    fn mean_period(s: &[f32]) -> f64 {
        let r = rising(s);
        (r[r.len() - 1] - r[0]) as f64 / (r.len() - 1) as f64
    }

    #[test]
    fn pitch_12_doubles_a_440_hz_sample() {
        let mut b = bench(
            [0.2, 0.2, 1.0, 0.0, 12.0, 0.0, 0.0, 0.0],
            [0.0, 0.0],
            Some(sample(sine(440.0, SR, 96_000))),
        );
        let o = b.run(&mut Grains::new(SR), 70, |_, _, _| {});
        let hz = SR / mean_period(&o[0][1000..8000]);
        assert!((hz / 880.0 - 1.0).abs() < 0.02, "{hz}");
    }

    #[test]
    fn a_22_05_k_file_resampled_to_48_k_keeps_its_pitch() {
        // decoded files arrive at the engine's rate: 1 s of 440 Hz at 22.05 k is 48 000 frames of 440 Hz
        let mut b = bench(
            [0.3, 0.2, 1.0, 0.0, 0.0, 0.0, 0.0, 0.0],
            [0.0, 0.0],
            Some(sample(sine(440.0, SR, 48_000))),
        );
        let o = b.run(&mut Grains::new(SR), 70, |_, _, _| {});
        let hz = SR / mean_period(&o[0][1000..8000]);
        assert!((hz / 440.0 - 1.0).abs() < 0.02, "{hz}");
    }

    #[test]
    fn rev_100_plays_a_ramp_backwards() {
        let ramp: Vec<f32> = (0..48_000).map(|i| i as f32 / 48_000.0).collect();
        let mut b = bench(
            [0.5, 0.1, 1.0, 0.0, 0.0, 0.0, 1.0, 0.0],
            [0.0, 0.0],
            Some(sample(ramp)),
        );
        let o = b.run(&mut Grains::new(SR), 40, |_, _, _| {});
        // divide out the window: the source read falls
        let w = |t: usize| 0.5 - 0.5 * (std::f32::consts::TAU * t as f32 / 4800.0).cos();
        let (a, c) = (o[0][1500] / w(1500), o[0][3300] / w(3300));
        assert!(a > c + 0.02, "{a} then {c}");
    }

    #[test]
    fn live_records_in_and_freeze_stops_it() {
        // POS 1: the newest audio
        let mut b = bench([1.0, 0.1, 20.0, 0.0, 0.0, 0.0, 0.0, 0.0], [1.0, 0.0], None);
        let mut g = Grains::new(SR);
        b.run(&mut g, 100, |blk, i, inp| {
            inp[IN][i] = ((blk * BLOCK + i) % 100) as f32 / 100.0
        });
        let sum = |g: &Grains| g.ring.iter().map(|x| *x as f64).sum::<f64>();
        let recorded = sum(&g);
        assert!(recorded > 1000.0 && g.write == 100 * BLOCK);
        assert!(
            b.out[0].iter().any(|x| x.abs() > 0.0),
            "grains play the recording"
        );
        b.fixed[FREEZE] = 1.0;
        b.run(&mut g, 100, |_, i, inp| inp[IN][i] = 0.9);
        assert_eq!(sum(&g), recorded);
        assert_eq!(g.write, 100 * BLOCK);
        assert!(
            g.trace[0] > 0.0 && g.trace[TRACE_PEAKS] > 0.5,
            "the head and the peaks are in the trace"
        );
    }

    #[test]
    fn two_hundred_long_grains_a_second_stay_within_64() {
        let mut b = bench(
            [0.5, 1.0, 200.0, 1.0, 0.0, 1.0, 0.5, 1.0],
            [0.0, 0.0],
            Some(sample(sine(220.0, SR, 96_000))),
        );
        let mut g = Grains::new(SR);
        let o = b.run(&mut g, 400, |_, _, _| {});
        assert!(g.state() <= 64.0 && g.state() >= 60.0, "{}", g.state());
        assert!(o[0]
            .iter()
            .chain(&o[1])
            .all(|x| x.is_finite() && x.abs() < 4.0));
    }

    #[test]
    fn the_sample_gone_mid_grain_is_silence() {
        let mut b = bench(PLAIN, [0.0, 0.0], Some(sample(vec![0.5; 48_000])));
        let mut g = Grains::new(SR);
        b.run(&mut g, 10, |_, _, _| {});
        b.fixed[SAMPLE] = -1.0;
        let o = b.run(&mut g, 10, |_, _, _| {});
        assert!(o[0].iter().all(|x| *x == 0.0) && g.state() == 0.0);
        // a shorter sample under the same id
        b.fixed[SAMPLE] = 0.0;
        b.run(&mut g, 10, |_, _, _| {});
        b.ctx.samples.insert(0, sample(vec![0.5; 100]));
        let o = b.run(&mut g, 40, |_, _, _| {});
        assert!(o[0].iter().all(|x| x.is_finite()));
    }

    #[test]
    fn blockwise_equals_per_sample() {
        let trig: Vec<f32> = (0..30 * BLOCK)
            .map(|i| if i % 700 < 48 { 1.0 } else { 0.0 })
            .collect();
        let x: Vec<f32> = sine(330.0, SR, 30 * BLOCK);
        let pos: Vec<f32> = (0..30 * BLOCK).map(|i| (i % 500) as f32 / 2000.0).collect();
        for source in [0.0, 1.0] {
            for t in [trig.clone(), vec![]] {
                Bench::blockwise_equals_per_sample_with(
                    || Box::new(Grains::new(SR)),
                    |ctx| ctx.samples.insert(0, sample(sine(220.0, SR, 9_000))),
                    &[t, x.clone(), pos.clone(), vec![]],
                    &[0.4, 0.02, 150.0, 0.3, 3.0, 0.4, 0.3, 0.7],
                    &[source, 0.0, 0.0],
                    2,
                    30,
                );
            }
        }
    }

    #[test]
    #[ignore = "a benchmark: run in release"]
    fn twenty_grains_at_dens_200_run_a_minute_well_under_real_time() {
        // 20 GRAINS, 200 grains a second of 0.2 s (≈ 40 playing each), FILE and LIVE half and half
        let mut benches: Vec<(Bench, Grains)> = (0..20)
            .map(|k| {
                let b = bench(
                    [0.5, 0.2, 200.0, 0.5, 0.0, 0.3, 0.2, 0.8],
                    [(k % 2) as f64, 0.0],
                    Some(sample(sine(220.0, SR, 480_000))),
                );
                (b, Grains::new(SR))
            })
            .collect();
        let t = std::time::Instant::now();
        let mut sum = 0.0f32;
        for (b, g) in benches.iter_mut() {
            let o = b.run(g, 60 * 48_000 / BLOCK, |blk, i, inp| {
                inp[IN][i] = ((blk + i) % 64) as f32 / 64.0 - 0.5
            });
            sum += o[0][1000];
        }
        let took = t.elapsed().as_secs_f64();
        assert!(sum.is_finite());
        eprintln!(
            "a minute of 20 GRAINS at DENS 200: {took:.3} s ({:.1} % of real time)",
            took / 60.0 * 100.0
        );
        assert!(took < 0.25 * 60.0);
    }
}
