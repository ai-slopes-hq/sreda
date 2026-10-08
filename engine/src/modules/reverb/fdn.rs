//! ROOM and HALL: an 8-line feedback delay network (Hadamard mixing). Line lengths are spread over a range scaled by
//! SIZE; each line's gain gives DECAY as the −60 dB time; a one-pole low-pass per line darkens the tail (DAMP); MOD
//! moves the lengths slowly; FREEZE holds the tail (gains 1, no damping). HALL adds four input diffusers.

use super::lines::{Allpass, Line};

const N: usize = 8;
/// relative line lengths (mutually prime-ish), mapped onto the size range
const SPREAD: [f64; N] = [1.0, 1.137, 1.276, 1.411, 1.553, 1.689, 1.832, 1.977];

pub struct Fdn {
    sr: f64,
    lines: Vec<Line>,
    lp: [f64; N],
    phase: [f64; N],
    /// (shortest, longest) line in seconds at SIZE 1
    range: (f64, f64),
    diffusers: Vec<Allpass>,
}

/// The input diffusers' delays (s) and their gain.
const DIFFUSE: [f64; 4] = [0.0047, 0.0036, 0.0127, 0.0093];
const DIFFUSE_G: f32 = 0.7;

impl Fdn {
    /// `hall`: longer lines and input diffusion
    pub fn new(sr: f64, hall: bool) -> Self {
        let range = if hall { (0.040, 0.200) } else { (0.010, 0.060) };
        let max = (range.1 * SPREAD[N - 1] / SPREAD[N - 1] + 0.002) * sr;
        Fdn {
            sr,
            lines: (0..N).map(|_| Line::new(max as usize + 4)).collect(),
            lp: [0.0; N],
            phase: [0.0; N],
            range,
            diffusers: if hall {
                DIFFUSE
                    .iter()
                    .map(|d| Allpass::new((d * sr) as usize + 4))
                    .collect()
            } else {
                vec![]
            },
        }
    }

    /// one sample: the dry input in, (L, R) of the tail out
    pub fn process(
        &mut self,
        x: f32,
        size: f64,
        decay: f64,
        damp: f64,
        modu: f64,
        freeze: bool,
    ) -> (f32, f32) {
        let sr = self.sr;
        let mut x = if freeze { 0.0 } else { x };
        for (k, ap) in self.diffusers.iter_mut().enumerate() {
            x = ap.process(x, DIFFUSE[k] * sr, DIFFUSE_G);
        }
        let scale = 0.3 + 0.7 * size.clamp(0.0, 1.0);
        let (lo, hi) = (self.range.0 * scale, self.range.1 * scale);
        let lp_a = if freeze {
            1.0
        } else {
            1.0 - (-std::f64::consts::TAU * 16_000.0 * (1.0 - 0.85 * damp) / sr).exp()
        };
        let mut v = [0.0f64; N];
        for k in 0..N {
            // lengths spread over lo…hi, moved by slow sines (0.1…0.7 Hz, ≤ 1 ms · MOD)
            let len = (lo + (hi - lo) * (SPREAD[k] - 1.0) / (SPREAD[N - 1] - 1.0)) * sr;
            self.phase[k] = (self.phase[k] + (0.1 + 0.6 * k as f64 / N as f64) / sr).fract();
            let m = modu * 0.001 * sr * (std::f64::consts::TAU * self.phase[k]).sin();
            // frozen: whole-sample lengths, no modulation (interpolation would slowly drain the held tail)
            let d = if freeze { len.round() } else { len + m };
            let out = self.lines[k].read(d) as f64;
            self.lp[k] += lp_a * (out - self.lp[k]);
            let g = if freeze {
                1.0
            } else {
                10f64.powf(-3.0 * len / (decay.max(0.01) * sr))
            };
            v[k] = self.lp[k] * g;
        }
        let (l, r) = (
            (v[0] + v[2] + v[4] + v[6]) as f32 * 0.5,
            (v[1] + v[3] + v[5] + v[7]) as f32 * 0.5,
        );
        // the Hadamard mix (fast Walsh–Hadamard, normalised), then the input into every line with alternating signs
        let mut h = 1;
        while h < N {
            for i in (0..N).step_by(2 * h) {
                for j in i..i + h {
                    let (a, b) = (v[j], v[j + h]);
                    v[j] = a + b;
                    v[j + h] = a - b;
                }
            }
            h *= 2;
        }
        let norm = 1.0 / (N as f64).sqrt();
        for (k, line) in self.lines.iter_mut().enumerate() {
            let sign = if k % 2 == 0 { 1.0 } else { -1.0 };
            line.write((v[k] * norm) as f32 + sign * x * 0.35);
        }
        (l, r)
    }

    pub fn clear(&mut self) {
        for l in self.lines.iter_mut() {
            l.clear();
        }
        for d in self.diffusers.iter_mut() {
            d.clear();
        }
        self.lp = [0.0; N];
    }
}
