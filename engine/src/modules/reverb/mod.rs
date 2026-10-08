//! REVERB (spec §7a): ROOM (a small FDN), HALL (a large FDN with diffusion and more pre-delay), PLATE (Dattorro);
//! SIZE, DECAY (the −60 dB time), DAMP, PRE (pre-delay), MOD, MIX; FREEZE holds the tail (input muted, feedback 1).
//! Changing TYPE crossfades 10 ms. `state()` is the tail's level (0…1) for the room display.

mod fdn;
mod lines;
mod plate;

use crate::dsp::{Ctx, Dsp, Io};
use crate::spec::{choice, knob, port, Display, ModuleSpec, Role, Unit};
use fdn::Fdn;
use lines::Line;
use plate::Plate;

pub fn spec() -> ModuleSpec {
    ModuleSpec {
        type_: "reverb",
        internal: false,
        label: "REVERB",
        desc: "room, plate, hall; freeze",
        size: (6, 2),
        inputs: vec![port("in", "IN", Role::Audio)],
        outputs: vec![port("l", "L", Role::Audio), port("r", "R", Role::Audio)],
        params: vec![
            knob("size", "SIZE", 0.0, 1.0, 0.5).into(),
            knob("decay", "DECAY", 0.1, 30.0, 2.0)
                .exp()
                .unit(Unit::S)
                .random(0.5, 8.0)
                .into(),
            knob("damp", "DAMP", 0.0, 1.0, 0.4).into(),
            knob("pre", "PRE", 0.0, 0.25, 0.01).unit(Unit::S).into(),
            knob("mod", "MOD", 0.0, 1.0, 0.2).into(),
            knob("mix", "MIX", 0.0, 1.0, 0.35).into(),
            choice("type", "TYPE", &["ROOM", "PLATE", "HALL"], 0).into(),
            choice("freeze", "FREEZE", &["OFF", "ON"], 0).into(),
        ],
        normals: vec![],
        display: Some(Display {
            lanes: 2,
            kind: "room",
        }),
    }
}

const ROOM: usize = 0;
const PLATE: usize = 1;
const HALL: usize = 2;

pub struct Reverb {
    sr: f64,
    room: Fdn,
    hall: Fdn,
    plate: Plate,
    pre: Line,
    ty: usize,
    old: usize,
    fade_left: u32,
    fade_len: u32,
    started: bool,
    /// the tail's mean square, smoothed over ~50 ms
    energy: f64,
}

impl Reverb {
    pub fn new(sr: f64) -> Self {
        Reverb {
            sr,
            room: Fdn::new(sr, false),
            hall: Fdn::new(sr, true),
            plate: Plate::new(sr),
            pre: Line::new((0.3 * sr) as usize),
            ty: ROOM,
            old: ROOM,
            fade_left: 0,
            fade_len: ((0.01 * sr) as u32).max(1),
            started: false,
            energy: 0.0,
        }
    }

    #[allow(clippy::too_many_arguments)]
    fn run(
        &mut self,
        ty: usize,
        x: f32,
        size: f64,
        decay: f64,
        damp: f64,
        modu: f64,
        freeze: bool,
    ) -> (f32, f32) {
        match ty {
            PLATE => self.plate.process(x, size, decay, damp, modu, freeze),
            HALL => self.hall.process(x, size, decay, damp, modu, freeze),
            _ => self.room.process(x, size, decay, damp, modu, freeze),
        }
    }
}

impl Dsp for Reverb {
    fn process(&mut self, io: &mut Io, _ctx: &mut Ctx, from: usize, to: usize) {
        let ty = (io.fixed[0].round().max(0.0) as usize).min(HALL);
        let freeze = io.fixed[1] >= 0.5;
        if !self.started {
            self.started = true;
            self.ty = ty;
            self.old = ty;
        }
        let ema = 1.0 - (-1.0 / (0.05 * self.sr)).exp();
        for i in from..to {
            if ty != self.ty {
                self.old = self.ty;
                self.ty = ty;
                self.fade_left = self.fade_len;
            }
            let x = io.inp[0][i];
            let (size, decay, damp) = (
                io.par[0][i] as f64,
                io.par[1][i] as f64,
                io.par[2][i] as f64,
            );
            let (pre, modu, mix) = (io.par[3][i] as f64, io.par[4][i] as f64, io.par[5][i]);
            // PRE (HALL adds 20 ms)
            self.pre.write(x);
            let delay = |t: usize| ((pre + if t == HALL { 0.02 } else { 0.0 }) * self.sr).max(1.0);
            let (dn, dold) = (delay(self.ty), delay(self.old));
            let xn = self.pre.read(dn);
            let xo = self.pre.read(dold);
            let (mut l, mut r) = self.run(self.ty, xn, size, decay, damp, modu, freeze);
            if self.fade_left > 0 {
                let (ol, or) = self.run(self.old, xo, size, decay, damp, modu, freeze);
                let t = self.fade_left as f32 / self.fade_len as f32;
                l = l * (1.0 - t) + ol * t;
                r = r * (1.0 - t) + or * t;
                self.fade_left -= 1;
            }
            self.energy += ema * (0.5 * ((l * l) as f64 + (r * r) as f64) - self.energy);
            io.out[0][i] = x * (1.0 - mix) + l * mix;
            io.out[1][i] = x * (1.0 - mix) + r * mix;
        }
    }

    fn reset(&mut self) {
        self.room.clear();
        self.hall.clear();
        self.plate.clear();
        self.pre.clear();
        self.fade_left = 0;
        self.old = self.ty;
        self.energy = 0.0;
    }

    fn state(&self) -> f32 {
        // the tail's RMS, scaled so a full-scale tail fills the room
        (2.0 * self.energy.sqrt()).min(1.0) as f32
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::dsp::bench::Bench;
    use crate::dsp::BLOCK;

    /// [size, decay, damp, pre, mod, mix], [type, freeze]
    fn bench(sr: f64, par: [f64; 6], fixed: [f64; 2]) -> Bench {
        let mut b = Bench::new(sr, 1, &par, &fixed, 2);
        b.connected_in = vec![true];
        b
    }

    /// the −60 dB time of an impulse response from its energy decay curve (T30 doubled)
    fn rt60(sr: f64, ty: usize, decay: f64) -> f64 {
        let mut b = bench(sr, [0.5, decay, 0.0, 0.0, 0.0, 1.0], [ty as f64, 0.0]);
        let blocks = (2.5 * decay * sr) as usize / BLOCK;
        let o = b.run(&mut Reverb::new(sr), blocks, |blk, i, inp| {
            inp[0][i] = if blk == 0 && i == 0 { 1.0 } else { 0.0 }
        });
        let e: Vec<f64> = o[0]
            .iter()
            .zip(&o[1])
            .map(|(l, r)| (*l as f64).powi(2) + (*r as f64).powi(2))
            .collect();
        let mut edc = vec![0.0; e.len()];
        let mut acc = 0.0;
        for k in (0..e.len()).rev() {
            acc += e[k];
            edc[k] = acc;
        }
        let db = |k: usize| 10.0 * (edc[k] / edc[0]).log10();
        let t5 = (0..e.len()).find(|&k| db(k) <= -5.0).unwrap();
        let t35 = (0..e.len()).find(|&k| db(k) <= -35.0).unwrap();
        2.0 * (t35 - t5) as f64 / sr
    }

    #[test]
    fn room_and_hall_decay_60_db_in_decay() {
        for sr in [48_000.0, 44_100.0] {
            for ty in [ROOM, HALL] {
                for decay in [1.0, 4.0] {
                    let t = rt60(sr, ty, decay);
                    assert!(
                        (t / decay - 1.0).abs() <= 0.25,
                        "{sr} type {ty} DECAY {decay}: {t:.2} s"
                    );
                }
            }
        }
    }

    #[test]
    fn the_plate_is_finite_and_rings_longer_with_decay() {
        let (a, b) = (rt60(48_000.0, PLATE, 1.0), rt60(48_000.0, PLATE, 4.0));
        assert!(a.is_finite() && b > 1.5 * a, "{a} then {b}");
    }

    fn noise(seed: u32) -> impl FnMut(usize, usize, &mut [[f32; BLOCK]]) {
        let mut r = crate::dsp::Rng::new(seed);
        move |_, i, inp| inp[0][i] = ((r.next_f64() * 2.0 - 1.0) * 0.3) as f32
    }
    fn rms(s: &[f32]) -> f64 {
        (s.iter().map(|x| (*x as f64).powi(2)).sum::<f64>() / s.len() as f64).sqrt()
    }

    #[test]
    fn freeze_holds_the_tail_and_ignores_the_input() {
        for ty in [ROOM, PLATE, HALL] {
            let (mut a, mut b) = (Reverb::new(48_000.0), Reverb::new(48_000.0));
            let mut ba = bench(48_000.0, [0.6, 3.0, 0.3, 0.0, 0.0, 1.0], [ty as f64, 0.0]);
            let mut bb = bench(48_000.0, [0.6, 3.0, 0.3, 0.0, 0.0, 1.0], [ty as f64, 0.0]);
            ba.run(&mut a, 375, noise(1));
            bb.run(&mut b, 375, noise(1));
            ba.fixed[1] = 1.0;
            bb.fixed[1] = 1.0;
            let first_a = ba.run(&mut a, 20, noise(2));
            let first_b = bb.run(&mut b, 20, |_, i, inp| inp[0][i] = 0.0);
            assert_eq!(
                first_a[0], first_b[0],
                "type {ty}: the input is muted while frozen"
            );
            let at_freeze = rms(&first_a[0]);
            ba.run(&mut a, 1875 - 40, noise(3));
            let later = ba.run(&mut a, 20, noise(4));
            assert!(
                rms(&later[0]) >= 0.5 * at_freeze,
                "type {ty}: {} vs {at_freeze}",
                rms(&later[0])
            );
        }
    }

    #[test]
    fn left_and_right_differ() {
        for ty in [ROOM, PLATE, HALL] {
            let mut b = bench(48_000.0, [0.5, 2.0, 0.4, 0.0, 0.2, 1.0], [ty as f64, 0.0]);
            let o = b.run(&mut Reverb::new(48_000.0), 400, noise(5));
            let (l, r) = (&o[0][24_000..], &o[1][24_000..]);
            let dot: f64 = l
                .iter()
                .zip(r)
                .map(|(a, b)| (*a as f64) * (*b as f64))
                .sum();
            let corr = dot / (rms(l) * rms(r) * l.len() as f64);
            assert!(corr < 0.9, "type {ty}: {corr}");
        }
    }

    #[test]
    fn switching_type_and_freeze_stays_finite_and_smooth() {
        let mut b = bench(48_000.0, [0.7, 6.0, 0.2, 0.02, 0.5, 0.5], [0.0, 0.0]);
        let mut rv = Reverb::new(48_000.0);
        let mut prev = 0.0f32;
        for blk in 0..1500 {
            b.fixed[0] = ((blk / 75) % 3) as f64;
            b.fixed[1] = ((blk / 120) % 2) as f64;
            let o = b.run(&mut rv, 1, |_, i, inp| {
                inp[0][i] = (0.3
                    * (std::f64::consts::TAU * 110.0 * (blk * BLOCK + i) as f64 / 48_000.0).sin())
                    as f32
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
    fn the_level_rises_with_a_tail_and_falls_with_it() {
        let mut b = bench(48_000.0, [0.5, 0.5, 0.4, 0.0, 0.0, 1.0], [0.0, 0.0]);
        let mut rv = Reverb::new(48_000.0);
        b.run(&mut rv, 4, |blk, i, inp| {
            inp[0][i] = if blk == 0 && i < 64 { 0.9 } else { 0.0 }
        });
        let up = rv.state();
        b.run(&mut rv, 400, |_, i, inp| inp[0][i] = 0.0);
        assert!(
            up > 0.01 && rv.state() < 0.2 * up,
            "{up} then {}",
            rv.state()
        );
    }

    #[test]
    fn blockwise_equals_per_sample() {
        let x: Vec<f32> = (0..20 * BLOCK)
            .map(|i| if i % 700 == 0 { 0.8 } else { 0.0 })
            .collect();
        for ty in [0.0, 1.0, 2.0] {
            Bench::blockwise_equals_per_sample(
                || Box::new(Reverb::new(48_000.0)),
                std::slice::from_ref(&x),
                &[0.6, 2.0, 0.3, 0.01, 0.4, 0.5],
                &[ty, 0.0],
                2,
                20,
            );
        }
    }
}
