//! Building blocks: a delay line read at a fractional delay, and a Schroeder allpass.

pub struct Line {
    buf: Vec<f32>,
    w: usize,
}

impl Line {
    pub fn new(len: usize) -> Self {
        Line {
            buf: vec![0.0; len.max(4)],
            w: 0,
        }
    }
    /// the value `d` samples ago (linear interpolation), 1 ≤ d ≤ len − 2
    pub fn read(&self, d: f64) -> f32 {
        let n = self.buf.len();
        let d = d.clamp(1.0, (n - 2) as f64);
        let pos = self.w as f64 - d + n as f64;
        let (i0, frac) = (pos.floor() as usize % n, (pos - pos.floor()) as f32);
        self.buf[i0] * (1.0 - frac) + self.buf[(i0 + 1) % n] * frac
    }
    pub fn write(&mut self, x: f32) {
        self.buf[self.w] = x + 1e-20;
        self.w = (self.w + 1) % self.buf.len();
    }
    pub fn clear(&mut self) {
        self.buf.fill(0.0);
    }
}

/// y = −g·x + v[n − d]; v[n] = x + g·y
pub struct Allpass {
    line: Line,
}

impl Allpass {
    pub fn new(len: usize) -> Self {
        Allpass {
            line: Line::new(len),
        }
    }
    pub fn process(&mut self, x: f32, d: f64, g: f32) -> f32 {
        let v = self.line.read(d);
        let y = -g * x + v;
        self.line.write(x + g * y);
        y
    }
    /// a tap inside the allpass's line, `d` samples back
    pub fn tap(&self, d: f64) -> f32 {
        self.line.read(d)
    }
    pub fn clear(&mut self) {
        self.line.clear();
    }
}
