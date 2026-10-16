//! A4: one track of an Elektron Analog Four MKII over USB MIDI. PITCH / GATE / VEL become MIDI notes pushed into
//! the engine's event outbox (channel = TRK). Several A4 modules may share a track; each tracks its own note.
//! The clock and transport live in the separate A4 CLK module.

use crate::dsp::{Ctx, Dsp, Io};
use crate::inputs::EdgeDetector;
use crate::spec::{choice, knob, port, Display, ModuleSpec, Role, Unit};

/// velocity of a note whose VEL jack is unpatched
const DEFAULT_VEL: u8 = 100;

pub fn spec() -> ModuleSpec {
    ModuleSpec {
        type_: "a4",
        internal: false,
        label: "A4",
        desc: "Analog Four MKII track over USB MIDI",
        size: (3, 2),
        inputs: vec![
            port("pitch", "PITCH", Role::Pitch),
            port("gate", "GATE", Role::Trigger).held(),
            port("vel", "VEL", Role::Mod),
        ],
        outputs: vec![],
        params: vec![
            knob("note", "NOTE", 0.0, 127.0, 48.0)
                .step(1.0)
                .unit(Unit::Note)
                .into(),
            knob("offset", "OFS", -50.0, 50.0, 0.0).step(1.0).into(),
            choice("track", "TRK", &["T1", "T2", "T3", "T4"], 0).into(),
        ],
        normals: vec![],
        display: Some(Display {
            lanes: 2,
            kind: "device",
        }),
    }
}

// inputs, knobs and fixed values by position
const PITCH: usize = 0;
const GATE: usize = 1;
const VEL: usize = 2;
const NOTE: usize = 0;
const TRACK: usize = 0;

#[derive(Default)]
pub struct A4 {
    edge: EdgeDetector,
    /// the note-on sent and not yet ended, with its channel
    sounding: Option<(u8, u8)>,
}

impl A4 {
    pub fn new(_sample_rate: f64) -> Self {
        A4::default()
    }
}

impl Dsp for A4 {
    fn process(&mut self, io: &mut Io, ctx: &mut Ctx, from: usize, to: usize) {
        let ch = (io.fixed[TRACK] as u8).min(3);
        let patched = io.connected_in[GATE];
        for i in from..to {
            let g = io.inp[GATE][i];
            // an unpatched gate counts as a fall
            if let Some((c, n)) = self.sounding {
                if !patched || g < 0.25 {
                    ctx.events.push(i, [0x80 | c, n, 0]);
                    self.sounding = None;
                }
            }
            if !patched {
                self.edge = EdgeDetector::default();
                continue;
            }
            if self.edge.rise(g) {
                if let Some((c, n)) = self.sounding.take() {
                    ctx.events.push(i, [0x80 | c, n, 0]);
                }
                // in floats, so an infinite PITCH clamps instead of overflowing; NaN counts as 0
                let pitch = io.inp[PITCH][i];
                let semis = if pitch.is_nan() {
                    0.0
                } else {
                    12.0 * f64::from(pitch)
                };
                let n = (io.par[NOTE][i] + semis as f32).round().clamp(0.0, 127.0) as u8;
                let vel = io.inp[VEL][i];
                // NaN → 1: a note-on with velocity 0 would be a note-off
                let v = if !io.connected_in[VEL] {
                    DEFAULT_VEL
                } else if vel.is_nan() {
                    1
                } else {
                    (127.0 * vel).round().clamp(1.0, 127.0) as u8
                };
                ctx.events.push(i, [0x90 | ch, n, v]);
                self.sounding = Some((ch, n));
            }
        }
    }

    /// Forget the sounding note without sending a note-off (the ledger releases it).
    fn reset(&mut self) {
        *self = A4::default();
    }

    fn state(&self) -> f32 {
        f32::from(u8::from(self.sounding.is_some()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::dsp::bench::Bench;
    use crate::dsp::BLOCK;

    /// a bench with GATE patched, NOTE 48, OFS 0 and the given TRK
    fn bench(track: f64) -> Bench {
        let mut b = Bench::new(48_000.0, 3, &[48.0, 0.0], &[track], 0);
        b.connected_in[GATE] = true;
        b
    }

    /// (offset, bytes) of every event the bench collected
    fn events(b: &Bench) -> Vec<(u32, [u8; 3])> {
        b.ctx
            .events
            .words()
            .chunks(2)
            .map(|w| {
                (
                    w[0] & 0xFFFF,
                    [w[1] as u8, (w[1] >> 8) as u8, (w[1] >> 16) as u8],
                )
            })
            .collect()
    }

    /// run `blocks` blocks with `feed(sample, inputs)`, the sample counted across blocks
    fn go(b: &mut Bench, a4: &mut A4, blocks: usize, feed: impl Fn(usize, &mut [[f32; BLOCK]])) {
        b.run(a4, blocks, |blk, i, inp| feed(blk * BLOCK + i, inp));
    }

    #[test]
    fn a_gate_plays_one_note_on_its_track() {
        let mut b = bench(1.0);
        go(&mut b, &mut A4::new(48e3), 5, |s, inp| {
            inp[GATE][s % BLOCK] = if (10..500).contains(&s) { 1.0 } else { 0.0 };
        });
        assert_eq!(
            events(&b),
            [(10, [0x91, 48, 100]), (500 % BLOCK as u32, [0x81, 48, 0])]
        );
    }

    #[test]
    fn pitch_is_held_from_the_rise() {
        let mut b = bench(0.0);
        go(&mut b, &mut A4::new(48e3), 2, |s, inp| {
            let i = s % BLOCK;
            inp[GATE][i] = if (10..200).contains(&s) { 1.0 } else { 0.0 };
            inp[PITCH][i] = if s < 50 { 1.0 / 12.0 } else { 1.0 };
        });
        let e = events(&b);
        assert_eq!(e[0].1, [0x90, 49, 100]);
        assert_eq!(e[1].1, [0x80, 49, 0]);
    }

    #[test]
    fn velocity_follows_vel_and_clamps() {
        let mut b = bench(0.0);
        b.connected_in[VEL] = true;
        // VEL 0 for the first gate, 0.5 for the second
        go(&mut b, &mut A4::new(48e3), 2, |s, inp| {
            let i = s % BLOCK;
            inp[GATE][i] = if (10..40).contains(&s) || (100..140).contains(&s) {
                1.0
            } else {
                0.0
            };
            inp[VEL][i] = if s < 60 { 0.0 } else { 0.5 };
        });
        let on: Vec<u8> = events(&b)
            .iter()
            .filter(|e| e.1[0] == 0x90)
            .map(|e| e.1[2])
            .collect();
        assert_eq!(on, [1, 64]);
    }

    #[test]
    fn a_retrigger_ends_the_sounding_note_first() {
        // a rise with a note still sounding (as after the gate was re-patched): off, then on, at the same offset
        let mut b = bench(0.0);
        let mut a4 = A4::new(48e3);
        a4.sounding = Some((0, 50));
        go(&mut b, &mut a4, 1, |s, inp| {
            inp[GATE][s] = if s >= 5 { 1.0 } else { 0.5 }
        });
        assert_eq!(events(&b), [(5, [0x80, 50, 0]), (5, [0x90, 48, 100])]);
    }

    #[test]
    fn a_1ms_trigger_plays_a_short_note() {
        let mut b = bench(3.0);
        go(&mut b, &mut A4::new(48e3), 1, |s, inp| {
            inp[GATE][s] = if (30..78).contains(&s) { 1.0 } else { 0.0 };
        });
        assert_eq!(events(&b), [(30, [0x93, 48, 100]), (78, [0x83, 48, 0])]);
    }

    #[test]
    fn notes_clamp_to_0_127() {
        for (note, pitch, want) in [(120.0, 2.0, 127), (3.0, -2.0, 0)] {
            let mut b = Bench::new(48_000.0, 3, &[note, 0.0], &[0.0], 0);
            b.connected_in[GATE] = true;
            go(&mut b, &mut A4::new(48e3), 1, |s, inp| {
                inp[GATE][s] = if (10..20).contains(&s) { 1.0 } else { 0.0 };
                inp[PITCH][s] = pitch;
            });
            assert_eq!(events(&b)[0].1, [0x90, want, 100]);
        }
    }

    #[test]
    fn non_finite_pitch_and_vel_stay_in_range() {
        for (pitch, want) in [(f32::INFINITY, 127), (f32::NEG_INFINITY, 0), (f32::NAN, 48)] {
            let mut b = bench(0.0);
            go(&mut b, &mut A4::new(48e3), 1, |s, inp| {
                inp[GATE][s] = if (10..20).contains(&s) { 1.0 } else { 0.0 };
                inp[PITCH][s] = pitch;
            });
            assert_eq!(events(&b)[0].1, [0x90, want, 100], "PITCH {pitch}");
        }
        for (vel, want) in [(f32::NAN, 1), (f32::INFINITY, 127), (f32::NEG_INFINITY, 1)] {
            let mut b = bench(0.0);
            b.connected_in[VEL] = true;
            go(&mut b, &mut A4::new(48e3), 1, |s, inp| {
                inp[GATE][s] = if (10..20).contains(&s) { 1.0 } else { 0.0 };
                inp[VEL][s] = vel;
            });
            assert_eq!(events(&b)[0].1, [0x90, 48, want], "VEL {vel}");
        }
    }

    #[test]
    fn unpatching_gate_releases_the_held_note() {
        let mut b = bench(0.0);
        let mut a4 = A4::new(48e3);
        go(&mut b, &mut a4, 1, |_, inp| inp[GATE].fill(1.0));
        assert_eq!(a4.state(), 1.0);
        b.connected_in[GATE] = false;
        go(&mut b, &mut a4, 1, |_, inp| inp[GATE].fill(1.0));
        assert_eq!(a4.state(), 0.0);
        assert_eq!(events(&b).last().unwrap(), &(0, [0x80, 48, 0]));
    }

    #[test]
    fn state_is_1_while_the_note_sounds() {
        let mut b = bench(0.0);
        let mut a4 = A4::new(48e3);
        assert_eq!(a4.state(), 0.0);
        go(&mut b, &mut a4, 1, |_, inp| inp[GATE].fill(1.0));
        assert_eq!(a4.state(), 1.0);
        a4.reset();
        assert_eq!(a4.state(), 0.0);
        // reset emits nothing
        assert_eq!(events(&b).len(), 1);
    }

    #[test]
    fn two_a4s_on_one_track_keep_their_own_notes() {
        // both on T1, with different NOTEs; each releases only its own note
        let mut b1 = Bench::new(48_000.0, 3, &[40.0, 0.0], &[0.0], 0);
        let mut b2 = Bench::new(48_000.0, 3, &[60.0, 0.0], &[0.0], 0);
        b1.connected_in[GATE] = true;
        b2.connected_in[GATE] = true;
        let (mut x, mut y) = (A4::new(48e3), A4::new(48e3));
        go(&mut b1, &mut x, 1, |s, inp| {
            inp[GATE][s] = if (10..100).contains(&s) { 1.0 } else { 0.0 }
        });
        go(&mut b2, &mut y, 1, |s, inp| {
            inp[GATE][s] = if (50..60).contains(&s) { 1.0 } else { 0.0 }
        });
        assert_eq!(events(&b1), [(10, [0x90, 40, 100]), (100, [0x80, 40, 0])]);
        assert_eq!(events(&b2), [(50, [0x90, 60, 100]), (60, [0x80, 60, 0])]);
    }

    #[test]
    fn blockwise_equals_per_sample() {
        let gate = |period: usize| {
            (0..4 * BLOCK)
                .map(|i| if i % period < period / 2 { 1.0 } else { 0.0 })
                .collect::<Vec<f32>>()
        };
        let pitch: Vec<f32> = (0..4 * BLOCK).map(|i| (i / 40) as f32 / 12.0).collect();
        Bench::blockwise_equals_per_sample(
            || Box::new(A4::new(48e3)),
            &[pitch, gate(50), gate(31)],
            &[48.0, 0.0],
            &[2.0],
            0,
            4,
        );
    }
}
