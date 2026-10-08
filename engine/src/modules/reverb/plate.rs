//! PLATE: Dattorro's plate (J. Dattorro, "Effect Design, Part 1", 1997) — four input diffusers into a figure-eight
//! tank of two modulated allpasses, delays, damping and decay; the output is his seven taps per side. Lengths are his
//! (at 29 761 Hz), scaled to the engine's rate and by SIZE (0.5…1.5).

use super::lines::{Allpass, Line};

const BASE_SR: f64 = 29_761.0;
const IN_DIFF: [(f64, f32); 4] = [(142.0, 0.75), (107.0, 0.75), (379.0, 0.625), (277.0, 0.625)];
/// (modulated allpass, delay, allpass, delay) for the left and the right half of the tank
const TANK: [[f64; 4]; 2] = [
    [672.0, 4453.0, 1800.0, 3720.0],
    [908.0, 4217.0, 2656.0, 3163.0],
];
const EXCURSION: f64 = 16.0;

struct Half {
    ap1: Allpass,
    d1: Line,
    lp: f64,
    ap2: Allpass,
    d2: Line,
}

pub struct Plate {
    sr: f64,
    bw: f64,
    diff: Vec<Allpass>,
    halves: [Half; 2],
    phase: f64,
}

impl Plate {
    pub fn new(sr: f64) -> Self {
        // room for SIZE 1.5 and the modulation
        let s = sr / BASE_SR * 1.5;
        let line = |n: f64| Line::new((n * s + EXCURSION * s) as usize + 4);
        let ap = |n: f64| Allpass::new((n * s + EXCURSION * s) as usize + 4);
        let half = |t: [f64; 4]| Half {
            ap1: ap(t[0]),
            d1: line(t[1]),
            lp: 0.0,
            ap2: ap(t[2]),
            d2: line(t[3]),
        };
        Plate {
            sr,
            bw: 0.0,
            diff: IN_DIFF.iter().map(|(n, _)| ap(*n)).collect(),
            halves: [half(TANK[0]), half(TANK[1])],
            phase: 0.0,
        }
    }

    pub fn process(
        &mut self,
        x: f32,
        size: f64,
        decay: f64,
        damp: f64,
        modu: f64,
        freeze: bool,
    ) -> (f32, f32) {
        let s = self.sr / BASE_SR * (0.5 + size.clamp(0.0, 1.0));
        // input bandwidth, then the diffusers
        self.bw += 0.9995 * ((if freeze { 0.0 } else { x as f64 }) - self.bw);
        let mut v = self.bw as f32;
        for (ap, (n, g)) in self.diff.iter_mut().zip(IN_DIFF) {
            v = ap.process(v, n * s, g);
        }
        // decay: four gains per trip round the figure eight, the trip being every tank delay
        let trip: f64 = TANK.iter().flatten().sum::<f64>() * s;
        let g = if freeze {
            1.0
        } else {
            10f64.powf(-3.0 * trip / (4.0 * decay.max(0.01) * self.sr))
        } as f32;
        let damping = if freeze {
            0.0
        } else {
            0.0005 + 0.7 * damp.clamp(0.0, 1.0)
        };
        self.phase = (self.phase + 1.0 / self.sr).fract();
        let wobble = modu * EXCURSION * s * (std::f64::consts::TAU * self.phase).sin();
        // each half takes the input plus the other half's end
        let ends = [
            self.halves[1].d2.read(TANK[1][3] * s),
            self.halves[0].d2.read(TANK[0][3] * s),
        ];
        for (k, h) in self.halves.iter_mut().enumerate() {
            let t = TANK[k];
            let m = if k == 0 { wobble } else { -wobble };
            let a = h.ap1.process(v + g * ends[k], t[0] * s + m, -0.7);
            h.d1.write(a);
            let d = h.d1.read(t[1] * s) as f64;
            h.lp = (1.0 - damping) * d + damping * h.lp;
            let b = h.ap2.process(h.lp as f32 * g, t[2] * s, 0.5);
            h.d2.write(b);
        }
        let [l, r] = &self.halves;
        let tap = |line: &Line, n: f64| line.read(n * s);
        let tap_ap = |ap: &Allpass, n: f64| ap.tap(n * s);
        let left = tap(&r.d1, 266.0) + tap(&r.d1, 2974.0) - tap_ap(&r.ap2, 1913.0)
            + tap(&r.d2, 1996.0)
            - tap(&l.d1, 1990.0)
            - tap_ap(&l.ap2, 187.0)
            - tap(&l.d2, 1066.0);
        let right = tap(&l.d1, 353.0) + tap(&l.d1, 3627.0) - tap_ap(&l.ap2, 1228.0)
            + tap(&l.d2, 2673.0)
            - tap(&r.d1, 2111.0)
            - tap_ap(&r.ap2, 335.0)
            - tap(&r.d2, 121.0);
        (left * 0.6, right * 0.6)
    }

    pub fn clear(&mut self) {
        self.bw = 0.0;
        for d in self.diff.iter_mut() {
            d.clear();
        }
        for h in self.halves.iter_mut() {
            h.ap1.clear();
            h.d1.clear();
            h.ap2.clear();
            h.d2.clear();
            h.lp = 0.0;
        }
    }
}
