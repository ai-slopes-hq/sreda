//! A4: plays an Elektron Analog Four MKII over USB MIDI. PITCH / GATE / VEL per track become MIDI notes pushed into
//! the engine's event outbox (channel = track). The clock side (CLK / RUN / RST, CLK option) comes with a later task.

use crate::dsp::{Ctx, Dsp, Io};
use crate::inputs::EdgeDetector;
use crate::spec::{choice, knob, port, Display, ModuleSpec, Param, Role, Unit};

const TRACKS: usize = 4;
/// velocity of a note whose VEL jack is unpatched
const DEFAULT_VEL: u8 = 100;

pub fn spec() -> ModuleSpec {
    let pitch = ["t1_pitch", "t2_pitch", "t3_pitch", "t4_pitch"];
    let gate = ["t1_gate", "t2_gate", "t3_gate", "t4_gate"];
    let vel = ["t1_vel", "t2_vel", "t3_vel", "t4_vel"];
    let p_l = ["P1", "P2", "P3", "P4"];
    let g_l = ["G1", "G2", "G3", "G4"];
    let v_l = ["V1", "V2", "V3", "V4"];
    let note = ["t1_note", "t2_note", "t3_note", "t4_note"];
    let n_l = ["NOTE 1", "NOTE 2", "NOTE 3", "NOTE 4"];
    let mut inputs = Vec::new();
    for t in 0..TRACKS {
        inputs.push(port(pitch[t], p_l[t], Role::Pitch));
        inputs.push(port(gate[t], g_l[t], Role::Trigger).held());
        inputs.push(port(vel[t], v_l[t], Role::Mod));
    }
    inputs.push(port("clk", "CLK", Role::Trigger));
    inputs.push(port("run", "RUN", Role::Trigger).held());
    inputs.push(port("rst", "RST", Role::Trigger));
    let mut params: Vec<Param> = (0..TRACKS)
        .map(|t| {
            knob(note[t], n_l[t], 0.0, 127.0, 48.0)
                .step(1.0)
                .unit(Unit::Note)
                .into()
        })
        .collect();
    params.push(knob("offset", "OFS", -50.0, 50.0, 0.0).step(1.0).into());
    params.push(choice("clock", "CLK", &["OFF", "ON"], 0).into());
    ModuleSpec {
        type_: "a4",
        internal: false,
        label: "A4",
        desc: "Analog Four MKII over USB MIDI",
        size: (8, 2),
        inputs,
        outputs: vec![],
        params,
        normals: vec![],
        display: Some(Display {
            lanes: 2,
            kind: "device",
        }),
    }
}

// input positions of a track's jacks
const fn pitch_in(t: usize) -> usize {
    t * 3
}
const fn gate_in(t: usize) -> usize {
    t * 3 + 1
}
const fn vel_in(t: usize) -> usize {
    t * 3 + 2
}
#[derive(Default)]
struct Track {
    edge: EdgeDetector,
    /// the note-on sent and not yet ended
    sounding: Option<u8>,
}

pub struct A4 {
    tracks: [Track; TRACKS],
}

impl A4 {
    pub fn new(_sample_rate: f64) -> Self {
        A4 {
            tracks: std::array::from_fn(|_| Track::default()),
        }
    }
}

impl Dsp for A4 {
    fn process(&mut self, io: &mut Io, ctx: &mut Ctx, from: usize, to: usize) {
        for i in from..to {
            for (t, tr) in self.tracks.iter_mut().enumerate() {
                let g = io.inp[gate_in(t)][i];
                let patched = io.connected_in[gate_in(t)];
                // an unpatched gate counts as a fall
                if let Some(n) = tr.sounding {
                    if !patched || g < 0.25 {
                        ctx.events.push(i, [0x80 | t as u8, n, 0]);
                        tr.sounding = None;
                    }
                }
                if !patched {
                    tr.edge = EdgeDetector::default();
                    continue;
                }
                if tr.edge.rise(g) {
                    if let Some(n) = tr.sounding.take() {
                        ctx.events.push(i, [0x80 | t as u8, n, 0]);
                    }
                    let semis = (12.0 * io.inp[pitch_in(t)][i]).round() as i32;
                    let n = (io.par[t][i].round() as i32 + semis).clamp(0, 127) as u8;
                    let v = if io.connected_in[vel_in(t)] {
                        (127.0 * io.inp[vel_in(t)][i]).round().clamp(1.0, 127.0) as u8
                    } else {
                        DEFAULT_VEL
                    };
                    ctx.events.push(i, [0x90 | t as u8, n, v]);
                    tr.sounding = Some(n);
                }
            }
        }
    }

    /// Forget the sounding notes without sending note-offs (the ledger releases them).
    fn reset(&mut self) {
        self.tracks = std::array::from_fn(|_| Track::default());
    }

    fn state(&self) -> f32 {
        self.tracks
            .iter()
            .enumerate()
            .map(|(t, tr)| u32::from(tr.sounding.is_some()) << t)
            .sum::<u32>() as f32
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::dsp::bench::Bench;
    use crate::dsp::BLOCK;

    const NOTES: [f64; 5] = [48.0, 48.0, 48.0, 48.0, 0.0];

    fn bench(par: &[f64]) -> Bench {
        let mut b = Bench::new(48_000.0, 15, par, &[0.0], 0);
        for t in 0..TRACKS {
            b.connected_in[gate_in(t)] = true;
        }
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

    /// run `blocks` blocks with `feed(sample, inputs)`, sample counted across blocks
    fn go(b: &mut Bench, a4: &mut A4, blocks: usize, feed: impl Fn(usize, &mut [[f32; BLOCK]])) {
        b.run(a4, blocks, |blk, i, inp| feed(blk * BLOCK + i, inp));
    }

    #[test]
    fn a_gate_plays_one_note_on_its_track() {
        let mut b = bench(&NOTES);
        go(&mut b, &mut A4::new(48e3), 5, |s, inp| {
            inp[gate_in(1)][s % BLOCK] = if (10..500).contains(&s) { 1.0 } else { 0.0 };
        });
        assert_eq!(events(&b)[0], (10, [0x91, 48, 100]));
        assert_eq!(events(&b)[1], (500 % BLOCK as u32, [0x81, 48, 0]));
        assert_eq!(events(&b).len(), 2);
    }

    #[test]
    fn pitch_is_held_from_the_rise() {
        let mut b = bench(&NOTES);
        go(&mut b, &mut A4::new(48e3), 2, |s, inp| {
            let i = s % BLOCK;
            inp[gate_in(0)][i] = if (10..200).contains(&s) { 1.0 } else { 0.0 };
            inp[pitch_in(0)][i] = if s < 50 { 1.0 / 12.0 } else { 1.0 };
        });
        let e = events(&b);
        assert_eq!(e[0].1, [0x90, 49, 100]);
        assert_eq!(e[1].1, [0x80, 49, 0]);
    }

    #[test]
    fn velocity_follows_vel_and_clamps() {
        let mut b = bench(&NOTES);
        b.connected_in[vel_in(0)] = true;
        // VEL 0 for the first gate, 0.5 for the second
        go(&mut b, &mut A4::new(48e3), 2, |s, inp| {
            let i = s % BLOCK;
            inp[gate_in(0)][i] = if (10..40).contains(&s) || (100..140).contains(&s) {
                1.0
            } else {
                0.0
            };
            inp[vel_in(0)][i] = if s < 60 { 0.0 } else { 0.5 };
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
        // a rise while a note sounds (the gate dipped but stayed above the re-arm level is not a fall: use two
        // tracks' worth of state by forcing the sounding note directly)
        let mut b = bench(&NOTES);
        let mut a4 = A4::new(48e3);
        a4.tracks[2].sounding = Some(60);
        go(&mut b, &mut a4, 1, |s, inp| {
            inp[gate_in(2)][s] = if s >= 20 { 1.0 } else { 0.0 };
        });
        // the stale note is released at the first low sample, the new one starts at 20
        let e = events(&b);
        assert_eq!(e[0], (0, [0x82, 60, 0]));
        assert_eq!(e[1], (20, [0x92, 48, 100]));
        // and a rise with a note still sounding emits the off at the rise's offset, before the on
        let mut b = bench(&NOTES);
        let mut a4 = A4::new(48e3);
        a4.tracks[0].sounding = Some(50);
        go(&mut b, &mut a4, 1, |s, inp| {
            inp[gate_in(0)][s] = if s >= 5 { 1.0 } else { 0.5 }
        });
        let e = events(&b);
        assert_eq!(e[0], (5, [0x80, 50, 0]));
        assert_eq!(e[1], (5, [0x90, 48, 100]));
    }

    #[test]
    fn a_1ms_trigger_plays_a_short_note() {
        let mut b = bench(&NOTES);
        go(&mut b, &mut A4::new(48e3), 1, |s, inp| {
            inp[gate_in(3)][s] = if (30..78).contains(&s) { 1.0 } else { 0.0 };
        });
        assert_eq!(events(&b), [(30, [0x93, 48, 100]), (78, [0x83, 48, 0])]);
    }

    #[test]
    fn notes_clamp_to_0_127() {
        let mut par = NOTES;
        par[0] = 120.0;
        par[1] = 3.0;
        let mut b = bench(&par);
        go(&mut b, &mut A4::new(48e3), 1, |s, inp| {
            let g = if (10..20).contains(&s) { 1.0 } else { 0.0 };
            inp[gate_in(0)][s] = g;
            inp[pitch_in(0)][s] = 2.0;
            inp[gate_in(1)][s] = g;
            inp[pitch_in(1)][s] = -2.0;
        });
        let e = events(&b);
        assert_eq!(e[0].1, [0x90, 127, 100]);
        assert_eq!(e[1].1, [0x91, 0, 100]);
    }

    #[test]
    fn unpatching_gate_releases_the_held_note() {
        let mut b = bench(&NOTES);
        let mut a4 = A4::new(48e3);
        go(&mut b, &mut a4, 1, |_, inp| inp[gate_in(0)].fill(1.0));
        assert_eq!(a4.state(), 1.0);
        b.connected_in[gate_in(0)] = false;
        go(&mut b, &mut a4, 1, |_, inp| inp[gate_in(0)].fill(1.0));
        assert_eq!(a4.state(), 0.0);
        let e = events(&b);
        assert_eq!(e.last().unwrap(), &(0, [0x80, 48, 0]));
    }

    #[test]
    fn state_reports_sounding_tracks() {
        let mut b = bench(&NOTES);
        let mut a4 = A4::new(48e3);
        go(&mut b, &mut a4, 1, |_, inp| {
            inp[gate_in(0)].fill(1.0);
            inp[gate_in(2)].fill(1.0);
        });
        assert_eq!(a4.state(), 5.0);
        a4.reset();
        assert_eq!(a4.state(), 0.0);
        // reset emits nothing
        assert_eq!(events(&b).len(), 2);
    }

    #[test]
    fn blockwise_equals_per_sample() {
        let gate = |period: usize| {
            (0..4 * BLOCK)
                .map(|i| if i % period < period / 2 { 1.0 } else { 0.0 })
                .collect::<Vec<f32>>()
        };
        let pitch: Vec<f32> = (0..4 * BLOCK).map(|i| (i / 40) as f32 / 12.0).collect();
        let mut inputs = vec![vec![]; 15];
        inputs[pitch_in(0)] = pitch;
        inputs[gate_in(0)] = gate(50);
        inputs[gate_in(1)] = gate(77);
        inputs[vel_in(1)] = gate(31);
        Bench::blockwise_equals_per_sample(
            || Box::new(A4::new(48e3)),
            &inputs,
            &NOTES,
            &[0.0],
            0,
            4,
        );
    }
}
