//! COMB: two feedback combs tuned to f = CUT (· 2^PTCH), 20…5 000 Hz, a delay of sr / f read through a first-order
//! allpass for the fraction. LP = x + g·y[n − D] (peaks at k·f), BP = x − g·y[n − D] (peaks at the odd multiples of
//! f / 2), HP = LP − x. Feedback g = 0.98 · RES.

use super::Model;

struct Line {
    buf: Vec<f64>,
    w: usize,
    /// the allpass's previous input and output
    ax: f64,
    ay: f64,
}

impl Line {
    fn new(len: usize) -> Self {
        Line {
            buf: vec![0.0; len],
            w: 0,
            ax: 0.0,
            ay: 0.0,
        }
    }
    /// the value `delay` samples ago (fractional), then write `x`
    fn tap(&mut self, delay: f64) -> f64 {
        let n = self.buf.len();
        // integer part ≥ 1, fraction in [0.5, 1.5) keeps the allpass well behaved
        let d0 = (delay - 0.5).floor().max(1.0);
        let frac = delay - d0;
        let a = (1.0 - frac) / (1.0 + frac);
        let v = self.buf[(self.w + n - d0 as usize) % n];
        let y = a * v + self.ax - a * self.ay;
        self.ax = v;
        self.ay = y;
        y
    }
    fn write(&mut self, x: f64) {
        self.buf[self.w] = x;
        self.w = (self.w + 1) % self.buf.len();
    }
}

pub struct Comb {
    pos: Line,
    neg: Line,
}

impl Comb {
    pub fn new(sample_rate: f64) -> Self {
        // the longest delay: 20 Hz
        let len = (sample_rate / 20.0) as usize + 4;
        Comb {
            pos: Line::new(len),
            neg: Line::new(len),
        }
    }
}

impl Model for Comb {
    fn process(&mut self, x: f64, fc: f64, res: f64, _drive: f64, sr: f64) -> [f64; 3] {
        let f = fc.clamp(20.0, 5000.0);
        let d = (sr / f).min((self.pos.buf.len() - 3) as f64);
        let g = 0.98 * res.clamp(0.0, 1.0);
        let lp = x + g * self.pos.tap(d);
        self.pos.write(lp + 1e-20);
        let bp = x - g * self.neg.tap(d);
        self.neg.write(bp + 1e-20);
        [lp, bp, lp - x]
    }

    fn reset(&mut self) {
        for l in [&mut self.pos, &mut self.neg] {
            l.buf.fill(0.0);
            l.ax = 0.0;
            l.ay = 0.0;
        }
    }
}
