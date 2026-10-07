//! RHYTHM: a 16-step rhythm sequencer drawn as pads: EUCLID (computed live from LEN, HITS, ROT) or GRID (OFF / ON /
//! TIE per step, accents). Rests and ties as on a TB-303: a TIE holds the gate, an OFF is a rest.

use crate::dsp::{Ctx, Dsp, Io};
use crate::spec::{choice, knob, port, Display, ModuleSpec, Param, Role};

const STEPS: usize = 16;
const GATE_NAMES: [&str; STEPS] = [
    "1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12", "13", "14", "15", "16",
];
const G_IDS: [&str; STEPS] = [
    "g1", "g2", "g3", "g4", "g5", "g6", "g7", "g8", "g9", "g10", "g11", "g12", "g13", "g14", "g15",
    "g16",
];
const A_IDS: [&str; STEPS] = [
    "a1", "a2", "a3", "a4", "a5", "a6", "a7", "a8", "a9", "a10", "a11", "a12", "a13", "a14", "a15",
    "a16",
];

pub fn spec() -> ModuleSpec {
    let mut params: Vec<Param> = Vec::new();
    for k in 0..STEPS {
        params.push(
            choice(G_IDS[k], GATE_NAMES[k], &["○", "●", "—"], 0)
                .hidden()
                .into(),
        );
    }
    for id in A_IDS {
        params.push(choice(id, "", &["·", "A"], 0).hidden().into());
    }
    params.push(knob("length", "LEN", 1.0, 16.0, 16.0).step(1.0).into());
    params.push(knob("hits", "HITS", 0.0, 16.0, 5.0).step(1.0).into());
    params.push(knob("rot", "ROT", 0.0, 15.0, 0.0).step(1.0).into());
    params.push(knob("dens", "DENS", 1.0, 16.0, 8.0).step(1.0).into());
    params.push(choice("mode", "MODE", &["EUCLID", "GRID"], 0).into());
    params.push(Param::Action {
        id: "dice",
        label: "DICE",
    });
    ModuleSpec {
        type_: "rhythm",
        label: "RHYTHM",
        desc: "16 pads: euclid or grid, accents · generative",
        size: (10, 2),
        inputs: vec![
            port("clk", "CLK", Role::Trigger),
            port("reset", "RST", Role::Trigger),
            port("dice", "DICE", Role::Trigger),
        ],
        outputs: vec![
            port("gate", "GATE", Role::Trigger),
            port("acc", "ACC", Role::Trigger),
            port("eoc", "EOC", Role::Trigger),
        ],
        params,
        normals: vec![],
        display: Some(Display {
            lanes: 4,
            kind: "pads",
        }),
    }
}

// inputs, knobs, outputs; fixed = g1–16, a1–16, MODE
const CLK: usize = 0;
const RESET: usize = 1;
const LEN: usize = 0;
const HITS: usize = 1;
const ROT: usize = 2;
const MODE: usize = 2 * STEPS;
const GATE: usize = 0;
const ACC: usize = 1;
const EOC: usize = 2;

/// Euclid: is step `i` of `n` a hit with `k` hits rotated by `rot`?
pub fn euclid_hit(i: usize, n: usize, k: usize, rot: usize) -> bool {
    if k >= n {
        return true;
    }
    if k == 0 || n == 0 {
        return false;
    }
    let sh = (i + n - rot % n) % n;
    (sh * k) % n < k
}

pub struct Rhythm {
    sample_rate: f64,
    pulse: u64,
    now: u64,
    /// the current step, 0-based; None before the first clock or after a RESET
    step: Option<usize>,
    last_clk: Option<u64>,
    interval: u64,
    gate_until: u64,
    /// the last step sounded (or held a tie): a TIE extends it
    sounding: bool,
    acc_until: u64,
    eoc_until: u64,
    clk_high: bool,
    reset_high: bool,
    /// the sample a new note started while the gate was still high: low for that sample, so the rise is seen
    gap: Option<u64>,
}

impl Rhythm {
    pub fn new(sample_rate: f64) -> Self {
        Rhythm {
            sample_rate,
            gap: None,
            pulse: ((0.001 * sample_rate).round() as u64).max(1),
            now: 0,
            step: None,
            last_clk: None,
            interval: (0.125 * sample_rate) as u64,
            gate_until: 0,
            sounding: false,
            acc_until: 0,
            eoc_until: 0,
            clk_high: false,
            reset_high: false,
        }
    }

    /// 0 off, 1 on, 2 tie — from the live euclid pattern or the grid
    fn gate_at(&self, io: &Io, i: usize, step: usize, len: usize) -> u32 {
        if io.fixed[MODE] as u32 == 0 {
            let hits = io.par[HITS][i].round().max(0.0) as usize;
            let rot = io.par[ROT][i].round().max(0.0) as usize;
            u32::from(euclid_hit(step, len, hits, rot))
        } else {
            io.fixed[step] as u32
        }
    }
}

impl Dsp for Rhythm {
    fn process(&mut self, io: &mut Io, _ctx: &mut Ctx, from: usize, to: usize) {
        for i in from..to {
            let reset = io.inp[RESET][i] > 0.5;
            if reset && !self.reset_high {
                self.step = None;
            }
            self.reset_high = reset;
            let clk = io.inp[CLK][i] > 0.5;
            if clk && !self.clk_high {
                if let Some(last) = self.last_clk {
                    self.interval = (self.now - last).max(2);
                }
                self.last_clk = Some(self.now);
                let len = (io.par[LEN][i].round() as usize).clamp(1, STEPS);
                let next = match self.step {
                    Some(s) if s + 1 < len => s + 1,
                    Some(_) => {
                        self.eoc_until = self.now + self.pulse;
                        0
                    }
                    None => 0,
                };
                self.step = Some(next);
                let gate = self.gate_at(io, i, next, len);
                let next_is_tie = self.gate_at(io, i, (next + 1) % len, len) == 2;
                // a gate held into a following TIE overlaps the next clock, so the tie does not retrigger
                let hold = if next_is_tie {
                    self.interval + self.interval / 20
                } else {
                    self.interval / 2
                };
                match gate {
                    2 if self.sounding => self.gate_until = self.now + hold,
                    0 => self.sounding = false,
                    _ => {
                        // ON, or a TIE after a rest: a new note
                        if self.gate_until > self.now {
                            self.gap = Some(self.now);
                        }
                        self.gate_until = self.now + hold;
                        self.sounding = true;
                        if gate == 1 && io.fixed[STEPS + next] as u32 == 1 {
                            self.acc_until = self.now + self.pulse;
                        }
                    }
                }
            }
            self.clk_high = clk;
            let gate_on = self.now < self.gate_until && self.gap != Some(self.now);
            io.out[GATE][i] = if gate_on { 1.0 } else { 0.0 };
            io.out[ACC][i] = if self.now < self.acc_until { 1.0 } else { 0.0 };
            io.out[EOC][i] = if self.now < self.eoc_until { 1.0 } else { 0.0 };
            self.now += 1;
        }
    }

    fn reset(&mut self) {
        let sr = self.sample_rate;
        *self = Rhythm::new(sr);
    }

    fn state(&self) -> f32 {
        self.step.unwrap_or(0) as f32
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::dsp::bench::Bench;
    use crate::dsp::BLOCK;

    const GATE: usize = 0;
    const ACC: usize = 1;
    const EOC: usize = 2;
    const SR: f64 = 48_000.0;
    /// a clock every 1200 samples (40 per second)
    const TICK: usize = 1200;

    /// fixed: g1–16, a1–16, MODE
    fn fixed(grid: &str, accents: &str, mode: f64) -> Vec<f64> {
        let mut f: Vec<f64> = grid
            .chars()
            .map(|c| match c {
                'x' => 1.0,
                '-' => 2.0,
                _ => 0.0,
            })
            .collect();
        f.extend(accents.chars().map(|c| if c == 'A' { 1.0 } else { 0.0 }));
        f.push(mode);
        f
    }

    fn rises(s: &[f32]) -> Vec<usize> {
        // a rise on the very first sample counts too
        (0..s.len())
            .filter(|&i| s[i] > 0.5 && (i == 0 || s[i - 1] <= 0.5))
            .collect()
    }

    /// Runs `steps` clocks; returns GATE, ACC and EOC.
    fn play(
        par: [f64; 4],
        fixed: Vec<f64>,
        steps: usize,
        mut extra: impl FnMut(usize, &mut [[f32; BLOCK]], usize),
    ) -> Vec<Vec<f32>> {
        let mut b = Bench::new(SR, 3, &par, &fixed, 3);
        b.connected_in = vec![true, true, false];
        let blocks = (steps * TICK).div_ceil(BLOCK) + 1;
        b.run(&mut Rhythm::new(SR), blocks, |blk, i, inp| {
            let n = blk * BLOCK + i;
            inp[0][i] = if n < steps * TICK && n % TICK < 48 {
                1.0
            } else {
                0.0
            };
            inp[1][i] = 0.0;
            extra(n, inp, i);
        })
    }

    #[test]
    fn a_grid_with_ties_rises_once_per_note() {
        let o = play(
            [16.0, 5.0, 0.0, 8.0],
            fixed("x.x-..x.x.xx-.x.", "............A.A.", 1.0),
            16,
            |_, _, _| {},
        );
        assert_eq!(rises(&o[GATE]).len(), 7, "7 notes; the ties hold");
        let acc: Vec<usize> = rises(&o[ACC]).iter().map(|n| n / TICK).collect();
        assert_eq!(
            acc,
            [14],
            "the accent on a TIE (step 12) is ignored; step 15's fires"
        );
    }

    #[test]
    fn euclid_16_5_0_hits_steps_1_5_8_11_14() {
        let o = play(
            [16.0, 5.0, 0.0, 8.0],
            fixed("................", "................", 0.0),
            16,
            |_, _, _| {},
        );
        let steps: Vec<usize> = rises(&o[GATE]).iter().map(|n| n / TICK + 1).collect();
        assert_eq!(steps, [1, 5, 8, 11, 14]);
    }

    #[test]
    fn eoc_fires_on_wrap() {
        let o = play(
            [4.0, 4.0, 0.0, 8.0],
            fixed("................", "................", 0.0),
            9,
            |_, _, _| {},
        );
        let wraps: Vec<usize> = rises(&o[EOC]).iter().map(|n| n / TICK).collect();
        assert_eq!(wraps, [4, 8]);
    }

    #[test]
    fn lowering_len_below_the_current_step_wraps_to_step_one() {
        let mut b = Bench::new(
            SR,
            3,
            &[16.0, 16.0, 0.0, 8.0],
            &fixed("................", "................", 1.0),
            3,
        );
        b.connected_in = vec![true, false, false];
        let mut r = Rhythm::new(SR);
        b.run(&mut r, (10 * TICK).div_ceil(BLOCK), |blk, i, inp| {
            inp[0][i] = if (blk * BLOCK + i) % TICK < 48 {
                1.0
            } else {
                0.0
            }
        });
        assert!(r.state() >= 8.0, "past step 9: {}", r.state());
        b.par[0] = [4.0; BLOCK];
        b.run(&mut r, TICK.div_ceil(BLOCK) + 1, |blk, i, inp| {
            inp[0][i] = if (blk * BLOCK + i) % TICK < 48 {
                1.0
            } else {
                0.0
            }
        });
        assert!(r.state() < 4.0, "back inside LEN: {}", r.state());
    }

    #[test]
    fn reset_plays_step_one_next() {
        let o = play(
            [16.0, 1.0, 0.0, 8.0],
            fixed("................", "................", 0.0),
            8,
            |n, inp, i| {
                inp[1][i] = if (5 * TICK + 200..5 * TICK + 248).contains(&n) {
                    1.0
                } else {
                    0.0
                };
            },
        );
        let steps: Vec<usize> = rises(&o[GATE]).iter().map(|n| n / TICK).collect();
        assert_eq!(
            steps,
            [0, 6],
            "step 1 at the start, and again on the clock after RESET"
        );
    }

    #[test]
    fn an_audio_rate_clock_stays_in_range() {
        let mut b = Bench::new(
            SR,
            3,
            &[16.0, 7.0, 0.0, 8.0],
            &fixed("x.x-..x.x.xx-.x.", "A.A.A.A.A.A.A.A.", 1.0),
            3,
        );
        b.connected_in = vec![true, false, false];
        let o = b.run(&mut Rhythm::new(SR), 400, |blk, i, inp| {
            inp[0][i] = if (blk * BLOCK + i) % 24 < 12 {
                1.0
            } else {
                0.0
            }
        });
        assert!(o.iter().all(|s| s.iter().all(|x| *x == 0.0 || *x == 1.0)));
    }

    #[test]
    fn blockwise_equals_per_sample() {
        let n = 40 * BLOCK;
        let clk: Vec<f32> = (0..n)
            .map(|i| if i % 300 < 48 { 1.0 } else { 0.0 })
            .collect();
        Bench::blockwise_equals_per_sample(
            || Box::new(Rhythm::new(48_000.0)),
            &[clk, vec![], vec![]],
            &[11.0, 4.0, 1.0, 8.0],
            &fixed("x.x-..x.x.xx-.x.", "A.....A.....A...", 1.0),
            3,
            40,
        );
    }
}
