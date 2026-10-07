//! SCOPE: an oscilloscope with thru outputs (like a Mordax DATA); gains and time affect the display only.

use crate::dsp::{Ctx, Dsp, Io, TRACE_LEN};
use crate::spec::{choice, knob, port, Display, ModuleSpec, Role, Unit};

pub fn spec() -> ModuleSpec {
    ModuleSpec {
        type_: "scope",
        label: "SCOPE",
        desc: "oscilloscope with thru outputs",
        size: (6, 2),
        inputs: vec![
            port("a", "A", Role::Audio),
            port("b", "B", Role::Audio),
            port("trig", "TRIG", Role::Trigger),
        ],
        outputs: vec![
            port("thruA", "THR A", Role::Audio),
            port("thruB", "THR B", Role::Audio),
        ],
        params: vec![
            knob("time", "TIME", 0.001, 10.0, 2.0)
                .exp()
                .unit(Unit::S)
                .random(0.3, 4.0)
                .into(),
            knob("ga", "GA", 0.1, 10.0, 1.0).exp().into(),
            knob("gb", "GB", 0.1, 10.0, 1.0).exp().into(),
            choice("mode", "MODE", &["A·B", "XY"], 0).into(),
        ],
        normals: vec![],
        display: Some(Display {
            lanes: 4,
            kind: "scope",
        }),
    }
}

const COLS: usize = 256;
// inputs, knobs and options by position
const A: usize = 0;
const B: usize = 1;
const TRIG: usize = 2;
const TIME: usize = 0;
const GA: usize = 1;
const GB: usize = 2;
const MODE: usize = 0;

pub struct Scope {
    sample_rate: f64,
    /// min A, max A, min B, max B per column
    trace: Vec<f32>,
    /// samples into the running sweep; None while waiting for a sync
    pos: Option<f64>,
    /// samples spent waiting (a sweep starts anyway after one sweep's length)
    waited: f64,
    col: usize,
    prev_a: f32,
    trig_high: bool,
}

impl Scope {
    pub fn new(sample_rate: f64) -> Self {
        Scope {
            sample_rate,
            trace: vec![0.0; TRACE_LEN],
            pos: None,
            waited: 0.0,
            col: usize::MAX,
            prev_a: 0.0,
            trig_high: false,
        }
    }
}

impl Dsp for Scope {
    fn process(&mut self, io: &mut Io, _ctx: &mut Ctx, from: usize, to: usize) {
        let (a_in, b_in, trig) = (&io.inp[A], &io.inp[B], &io.inp[TRIG]);
        let xy = io.fixed[MODE] as u32 == 1;
        let trig_patched = io.connected_in[TRIG];
        for i in from..to {
            let (a, b) = (a_in[i], b_in[i]);
            io.out[0][i] = a;
            io.out[1][i] = b;
            let sweep = (io.par[TIME][i] as f64 * self.sample_rate).max(COLS as f64);
            let rise = trig[i] > 0.5 && !self.trig_high;
            self.trig_high = trig[i] > 0.5;
            if self.pos.is_none() {
                // sync: a TRIG rise when patched, else A rising through (or from) 0, else free after a sweep's length
                let sync = if trig_patched {
                    rise
                } else {
                    self.prev_a <= 0.0 && a > 0.0
                };
                self.waited += 1.0;
                if sync || (!trig_patched && self.waited >= sweep) {
                    self.pos = Some(0.0);
                    self.col = usize::MAX;
                }
            }
            self.prev_a = a;
            let Some(pos) = self.pos else { continue };
            let col = ((pos / sweep * COLS as f64) as usize).min(COLS - 1);
            let (va, vb) = (a * io.par[GA][i], b * io.par[GB][i]);
            let t = &mut self.trace;
            if col != self.col || xy {
                t[col] = va;
                t[COLS + col] = va;
                t[2 * COLS + col] = vb;
                t[3 * COLS + col] = vb;
                self.col = col;
            } else {
                t[col] = t[col].min(va);
                t[COLS + col] = t[COLS + col].max(va);
                t[2 * COLS + col] = t[2 * COLS + col].min(vb);
                t[3 * COLS + col] = t[3 * COLS + col].max(vb);
            }
            let next = pos + 1.0;
            if next >= sweep {
                self.pos = None;
                self.waited = 0.0;
            } else {
                self.pos = Some(next);
            }
        }
    }

    fn reset(&mut self) {
        self.trace.fill(0.0);
        self.pos = None;
        self.waited = 0.0;
        self.col = usize::MAX;
    }

    fn trace(&self) -> Option<&[f32]> {
        Some(&self.trace)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::dsp::bench::Bench;
    use crate::dsp::BLOCK;

    fn bench(sr: f64, time: f64) -> Bench {
        Bench::new(sr, 3, &[time, 1.0, 1.0], &[0.0], 2)
    }

    #[test]
    fn thru_outputs_are_the_inputs() {
        let mut b = bench(48_000.0, 0.1);
        b.connected_in = vec![true, true, false];
        let mut s = Scope::new(48_000.0);
        let out = b.run(&mut s, 4, |blk, i, inp| {
            inp[0][i] = (blk * BLOCK + i) as f32 * 0.001;
            inp[1][i] = -(i as f32);
        });
        for (n, (a, b)) in out[0].iter().zip(&out[1]).enumerate() {
            assert_eq!(*a, n as f32 * 0.001);
            assert_eq!(*b, -((n % BLOCK) as f32));
        }
    }

    #[test]
    fn a_fast_sine_fills_every_column_from_minus_one_to_one() {
        let sr = 48_000.0;
        // 0.5 s over 256 columns: ~94 samples a column, ~10 periods of a 4987 Hz sine at drifting phases
        let mut b = bench(sr, 0.5);
        b.connected_in = vec![true, false, false];
        let mut s = Scope::new(sr);
        b.run(&mut s, (1.2 * sr) as usize / BLOCK, |blk, i, inp| {
            inp[0][i] =
                (std::f64::consts::TAU * 4987.0 * (blk * BLOCK + i) as f64 / sr).sin() as f32;
        });
        let t = s.trace().unwrap();
        for c in 0..COLS {
            assert!(
                t[c] < -0.95 && t[COLS + c] > 0.95,
                "column {c}: {} … {}",
                t[c],
                t[COLS + c]
            );
        }
    }

    /// A ramp into A (its value = the sample index since the trigger) shows how many samples one sweep spans.
    fn sweep_span(sr: f64) -> f32 {
        let mut b = bench(sr, 0.1);
        b.connected_in = vec![true, false, true];
        let mut s = Scope::new(sr);
        b.run(&mut s, (0.2 * sr) as usize / BLOCK, |blk, i, inp| {
            let n = blk * BLOCK + i;
            inp[0][i] = n as f32;
            inp[2][i] = if n < 48 { 1.0 } else { 0.0 };
        });
        s.trace().unwrap()[2 * COLS - 1]
    }

    #[test]
    fn a_sweep_spans_time_in_seconds_at_48k_and_44k1() {
        assert!(
            (sweep_span(48_000.0) - 4799.0).abs() <= 2.0,
            "{}",
            sweep_span(48_000.0)
        );
        assert!(
            (sweep_span(44_100.0) - 4409.0).abs() <= 2.0,
            "{}",
            sweep_span(44_100.0)
        );
    }

    #[test]
    fn a_unipolar_signal_rising_from_zero_syncs_the_sweep() {
        // an envelope at 0 that rises at sample 1000: the sweep must start there, not after a free-run wait
        let sr = 48_000.0;
        let mut b = bench(sr, 0.01);
        b.connected_in = vec![true, false, false];
        let mut s = Scope::new(sr);
        b.run(&mut s, 12, |blk, i, inp| {
            let n = blk * BLOCK + i;
            inp[0][i] = if n >= 1000 {
                ((n - 1000) as f32 / 480.0).min(1.0)
            } else {
                0.0
            };
        });
        let t = s.trace().unwrap();
        assert!(
            t[COLS + 128] > 0.4,
            "the middle of the sweep shows the rise: {}",
            t[COLS + 128]
        );
    }

    #[test]
    fn blockwise_equals_per_sample() {
        let n = 20 * BLOCK;
        let a: Vec<f32> = (0..n).map(|i| (i as f32 * 0.07).sin()).collect();
        let b: Vec<f32> = (0..n).map(|i| (i as f32 * 0.013).cos()).collect();
        let t: Vec<f32> = (0..n)
            .map(|i| if i % 700 < 48 { 1.0 } else { 0.0 })
            .collect();
        Bench::blockwise_equals_per_sample(
            || Box::new(Scope::new(48_000.0)),
            &[a, b, t],
            &[0.01, 1.0, 1.0],
            &[0.0],
            2,
            20,
        );
    }
}
