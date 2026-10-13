//! A4 CLK: MIDI Timing Clock, Start and Stop for an Elektron Analog Four MKII. CLK beats become 24 ticks per beat
//! spread over the last measured period; RUN is Start / Stop, RST is Stop then Start. Everything goes into the
//! engine's event outbox as one-byte real-time messages (no channel). The notes live in the A4 module.

use crate::dsp::{Ctx, Dsp, Io};
use crate::inputs::EdgeDetector;
use crate::spec::{knob, port, Display, ModuleSpec, Role};

const CLOCK: u8 = 0xF8;
const START: u8 = 0xFA;
const STOP: u8 = 0xFC;
/// MIDI Timing Clock ticks per beat (CLK rise)
const TICKS: u32 = 24;

pub fn spec() -> ModuleSpec {
    ModuleSpec {
        type_: "a4clk",
        internal: false,
        label: "A4 CLK",
        desc: "Analog Four MKII clock and transport over USB MIDI",
        size: (4, 2),
        inputs: vec![
            port("clk", "CLK", Role::Trigger),
            port("run", "RUN", Role::Trigger).held(),
            port("rst", "RST", Role::Trigger),
        ],
        outputs: vec![],
        // OFS is read by the main thread (MIDI send time shift), not by the DSP
        params: vec![knob("offset", "OFS", -50.0, 50.0, 0.0).step(1.0).into()],
        normals: vec![],
        display: Some(Display {
            lanes: 2,
            kind: "device",
        }),
    }
}

// inputs by position
const CLK: usize = 0;
const RUN: usize = 1;
const RST: usize = 2;

pub struct A4Clk {
    /// a gap longer than this many samples between two beats forgets the period
    max_gap: u64,
    /// samples seen so far
    now: u64,
    clk: EdgeDetector,
    rst: EdgeDetector,
    run: EdgeDetector,
    /// RUN was patched at the previous sample
    run_patched: bool,
    /// RUN's rise was seen and its fall not yet
    run_high: bool,
    /// Start sent, Stop not yet
    running: bool,
    last_rise: Option<u64>,
    /// samples between the last two rises, while known
    period: Option<u64>,
    /// the sample of the current beat's rise
    beat: u64,
    /// the next tick of the current beat; `TICKS` when none is owed
    next_tick: u32,
}

impl A4Clk {
    pub fn new(sample_rate: f64) -> Self {
        A4Clk {
            max_gap: (2.0 * sample_rate) as u64,
            now: 0,
            clk: EdgeDetector::default(),
            rst: EdgeDetector::default(),
            run: EdgeDetector::default(),
            run_patched: false,
            run_high: false,
            running: false,
            last_rise: None,
            period: None,
            beat: 0,
            next_tick: TICKS,
        }
    }
}

impl Dsp for A4Clk {
    fn process(&mut self, io: &mut Io, ctx: &mut Ctx, from: usize, to: usize) {
        let patched = io.connected_in[RUN];
        for i in from..to {
            // transport: RUN
            if patched {
                let g = io.inp[RUN][i];
                if self.run_high && g < 0.25 {
                    self.run_high = false;
                    self.running = false;
                    ctx.events.push(i, [STOP, 0, 0]);
                }
                if self.run.rise(g) {
                    self.run_high = true;
                    self.running = true;
                    ctx.events.push(i, [START, 0, 0]);
                }
            } else {
                if self.run_patched && self.running {
                    ctx.events.push(i, [STOP, 0, 0]);
                }
                if self.run_patched {
                    self.running = false;
                }
                self.run_high = false;
                self.run = EdgeDetector::default();
            }
            self.run_patched = patched;
            // while RUN is patched and low the A4 is stopped: the next RUN rise starts it from the top
            let stopped = patched && !self.run_high;
            if self.rst.rise(io.inp[RST][i]) && !stopped {
                self.running = true;
                ctx.events.push(i, [STOP, 0, 0]);
                ctx.events.push(i, [START, 0, 0]);
            }

            // clock: ticks still owed go out first, then tick 0 of the new beat
            if self.clk.rise(io.inp[CLK][i]) {
                while self.next_tick < TICKS {
                    ctx.events.push(i, [CLOCK, 0, 0]);
                    self.next_tick += 1;
                }
                ctx.events.push(i, [CLOCK, 0, 0]);
                self.period = match self.last_rise {
                    Some(last) if self.now - last <= self.max_gap => Some(self.now - last),
                    _ => None,
                };
                self.last_rise = Some(self.now);
                self.beat = self.now;
                // without a period nothing is spread yet
                self.next_tick = if self.period.is_some() { 1 } else { TICKS };
            }
            if let Some(p) = self.period {
                while self.next_tick < TICKS
                    && self.now
                        >= self.beat + (f64::from(self.next_tick) * p as f64 / 24.0).round() as u64
                {
                    ctx.events.push(i, [CLOCK, 0, 0]);
                    self.next_tick += 1;
                }
            }
            self.now += 1;
        }
    }

    /// Forget the beat and the transport without sending anything.
    fn reset(&mut self) {
        *self = A4Clk {
            max_gap: self.max_gap,
            ..A4Clk::new(0.0)
        };
    }

    fn state(&self) -> f32 {
        f32::from(u8::from(self.running))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::dsp::bench::Bench;
    use crate::dsp::BLOCK;

    const SR: f64 = 48_000.0;

    /// a bench with CLK, RUN and RST all patched
    fn bench() -> Bench {
        let mut b = Bench::new(SR, 3, &[0.0], &[], 0);
        b.connected_in = vec![true; 3];
        b
    }

    /// Run `blocks` blocks with `feed(sample, inputs)`; every event as (absolute sample, bytes).
    fn go(
        b: &mut Bench,
        dsp: &mut A4Clk,
        blocks: usize,
        feed: impl Fn(usize, &mut [[f32; BLOCK]]),
    ) -> Vec<(usize, u8)> {
        let mut res = Vec::new();
        for blk in 0..blocks {
            b.run(dsp, 1, |_, i, inp| feed(blk * BLOCK + i, inp));
            for w in b.ctx.events.words().chunks(2) {
                res.push((blk * BLOCK + (w[0] & 0xFFFF) as usize, w[1] as u8));
            }
            b.ctx.events.clear();
        }
        res
    }

    /// 1 ms (48-sample) CLK pulses starting at each of `rises`
    fn pulses(rises: &[usize]) -> impl Fn(usize, &mut [[f32; BLOCK]]) + '_ {
        move |s, inp| {
            inp[CLK][s % BLOCK] =
                f32::from(u8::from(rises.iter().any(|&r| (r..r + 48).contains(&s))));
        }
    }

    fn ticks(e: &[(usize, u8)]) -> Vec<usize> {
        e.iter().filter(|x| x.1 == CLOCK).map(|x| x.0).collect()
    }

    #[test]
    fn spec_matches_the_contract() {
        let s = spec();
        assert_eq!(s.size, (4, 2));
        assert_eq!(s.label, "A4 CLK");
        assert!(s.outputs.is_empty());
    }

    #[test]
    fn ticks_24_per_beat_at_a_steady_tempo() {
        // 120 BPM at 48 kHz: a beat every 24000 samples
        let rises: Vec<usize> = (0..4).map(|k| 1000 + k * 24_000).collect();
        let mut b = bench();
        let t = ticks(&go(&mut b, &mut A4Clk::new(SR), 600, pulses(&rises)));
        // beat 0 has tick 0 only; beats 1 and 2 are complete, the third beat starts at its rise
        let between = |a: usize, z: usize| t.iter().filter(|&&x| (a..z).contains(&x)).count();
        assert_eq!(between(rises[1], rises[2]), 24);
        assert_eq!(between(rises[2], rises[3]), 24);
        let beat: Vec<usize> = t
            .iter()
            .copied()
            .filter(|&x| x >= rises[1] && x < rises[2])
            .collect();
        assert_eq!(beat[0], rises[1]);
        for w in beat.windows(2) {
            assert!((w[1] - w[0]).abs_diff(1000) <= 1, "spacing {}", w[1] - w[0]);
        }
    }

    #[test]
    fn a_faster_beat_sends_the_owed_ticks_first() {
        // beats 24000 apart, then one only 6000 after the last: the rest of the ticks go out at that rise
        let rises = [1000, 25_000, 49_000, 55_000, 79_000];
        let mut b = bench();
        let e = go(&mut b, &mut A4Clk::new(SR), 700, pulses(&rises));
        let t = ticks(&e);
        let in_beat = |a: usize, z: usize| t.iter().filter(|&&x| (a..z).contains(&x)).count();
        // beat at 49000 got ticks 0..5 by 55000 (6000/1000 + 1), the other 18 at 55000, then tick 0 of the new beat
        assert_eq!(in_beat(49_000, 55_000), 6);
        assert_eq!(t.iter().filter(|&&x| x == 55_000).count(), 19);
        // the beat from 55000 (period 6000) has its own 24
        assert_eq!(in_beat(55_001, 79_000) + 1, 24);
    }

    #[test]
    fn a_slower_beat_waits_at_23() {
        // period 24000, then a beat that comes after 60000 (> 2 s is 96000, so P is kept)
        let rises = [1000, 25_000, 85_000];
        let mut b = bench();
        let t = ticks(&go(&mut b, &mut A4Clk::new(SR), 800, pulses(&rises)));
        let in_beat = t.iter().filter(|&&x| (25_000..85_000).contains(&x)).count();
        assert_eq!(in_beat, 24);
        // tick 23 is the last until the rise
        assert_eq!(t.iter().filter(|&&x| x > 48_000 && x < 85_000).count(), 0);
        assert!(t.contains(&85_000));
    }

    #[test]
    fn only_tick_0_before_the_second_rise() {
        // the first rise sends tick 0 only; the ticks 1..23 need a period
        let mut b = bench();
        let t = ticks(&go(&mut b, &mut A4Clk::new(SR), 200, pulses(&[1000])));
        assert_eq!(t, [1000]);
    }

    #[test]
    fn a_long_gap_resets_the_period() {
        let rises = [1000, 25_000, 25_000 + 96_001 + 1000];
        let mut b = bench();
        let e = go(&mut b, &mut A4Clk::new(SR), 1200, pulses(&rises));
        let t = ticks(&e);
        // after the gap only tick 0 goes out
        assert_eq!(
            t.iter().filter(|&&x| x >= rises[2]).collect::<Vec<_>>(),
            [&rises[2]]
        );
    }

    #[test]
    fn run_starts_and_stops() {
        let mut b = bench();
        let e = go(&mut b, &mut A4Clk::new(SR), 4, |s, inp| {
            inp[RUN][s % BLOCK] = f32::from(u8::from((10..300).contains(&s)));
        });
        assert_eq!(e, [(10, START), (300, STOP)]);
    }

    #[test]
    fn rst_is_stop_then_start() {
        // RUN unpatched (with RUN high it is the same)
        let mut b = bench();
        b.connected_in[RUN] = false;
        let e = go(&mut b, &mut A4Clk::new(SR), 2, |s, inp| {
            inp[RST][s % BLOCK] = f32::from(u8::from((20..68).contains(&s)));
        });
        assert_eq!(e, [(20, STOP), (20, START)]);
    }

    #[test]
    fn rst_while_stopped_does_nothing() {
        let mut b = bench();
        let mut c = A4Clk::new(SR);
        let e = go(&mut b, &mut c, 2, |s, inp| {
            inp[RST][s % BLOCK] = f32::from(u8::from((20..68).contains(&s)));
        });
        assert_eq!(e, []);
        assert_eq!(c.state(), 0.0);
        // while RUN is high it restarts
        let e = go(&mut b, &mut c, 2, |s, inp| {
            inp[RUN][s % BLOCK] = 1.0;
            inp[RST][s % BLOCK] = f32::from(u8::from((300..340).contains(&(s + 256))));
        });
        assert_eq!(e, [(0, START), (44, STOP), (44, START)]);
    }

    #[test]
    fn unpatched_run_sends_no_transport_and_the_clock_runs() {
        let mut b = bench();
        b.connected_in[RUN] = false;
        let rises = [100, 24_100];
        let e = go(&mut b, &mut A4Clk::new(SR), 300, |s, inp| {
            inp[RUN][s % BLOCK] = 1.0;
            pulses(&rises)(s, inp);
        });
        assert!(e.iter().all(|x| x.1 == CLOCK));
        assert!(!e.is_empty());
    }

    #[test]
    fn unpatching_run_while_running_stops() {
        let mut b = bench();
        let mut c = A4Clk::new(SR);
        let e = go(&mut b, &mut c, 1, |_, inp| inp[RUN].fill(1.0));
        assert_eq!(e, [(0, START)]);
        b.connected_in[RUN] = false;
        let e = go(&mut b, &mut c, 2, |_, inp| inp[RUN].fill(1.0));
        assert_eq!(e, [(0, STOP)]);
        assert_eq!(c.state(), 0.0);
    }

    #[test]
    fn state_reports_running() {
        let mut b = bench();
        let mut c = A4Clk::new(SR);
        assert_eq!(c.state(), 0.0);
        go(&mut b, &mut c, 1, |_, inp| inp[RUN].fill(1.0));
        assert_eq!(c.state(), 1.0);
        go(&mut b, &mut c, 1, |_, inp| inp[RUN].fill(0.0));
        assert_eq!(c.state(), 0.0);
        go(&mut b, &mut c, 1, |_, inp| inp[RUN].fill(1.0));
        c.reset();
        assert_eq!(c.state(), 0.0);
    }

    #[test]
    fn blockwise_equals_per_sample() {
        // the helper compares outputs only, so compare the events here
        let rises: Vec<usize> = (0..8).map(|k| 40 + k * 250).collect();
        let sig = |f: &dyn Fn(usize) -> bool| -> Vec<f32> {
            (0..4 * BLOCK).map(|s| f32::from(u8::from(f(s)))).collect()
        };
        let clk = sig(&|s| rises.iter().any(|&r| (r..r + 48).contains(&s)));
        let run = sig(&|s| (100..400).contains(&s));
        let rst = sig(&|s| (500..520).contains(&s));
        let collect = |per_sample: bool| {
            let mut b = bench();
            let mut c = A4Clk::new(SR);
            let mut out = Vec::new();
            for blk in 0..4 {
                for (j, x) in [&clk, &run, &rst].iter().enumerate() {
                    b.inp[j].copy_from_slice(&x[blk * BLOCK..(blk + 1) * BLOCK]);
                }
                let mut io = Io {
                    inp: &b.inp,
                    par: &b.par,
                    fixed: &b.fixed,
                    out: &mut b.out,
                    connected_in: &b.connected_in,
                    connected_out: &b.connected_out,
                };
                if per_sample {
                    for i in 0..BLOCK {
                        c.process(&mut io, &mut b.ctx, i, i + 1);
                    }
                } else {
                    c.process(&mut io, &mut b.ctx, 0, BLOCK);
                }
                out.extend_from_slice(b.ctx.events.words());
                b.ctx.events.clear();
            }
            out
        };
        let (a, p) = (collect(false), collect(true));
        assert!(!a.is_empty());
        assert_eq!(a, p);
        Bench::blockwise_equals_per_sample(
            || Box::new(A4Clk::new(SR)),
            &[clk, run, rst],
            &[0.0],
            &[],
            0,
            4,
        );
    }
}
