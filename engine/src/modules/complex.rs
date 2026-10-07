//! COMPLEX: a modulator and a sine carrier (Buchla 259 style): linear FM from the modulator or the FM input, and a
//! timbre folder on the carrier.

use crate::dsp::{Ctx, Dsp, Io};
use crate::shaping::Folder;
use crate::spec::{choice, knob, port, ModuleSpec, Normal, Role, Unit};

pub fn spec() -> ModuleSpec {
    ModuleSpec {
        type_: "complex",
        label: "COMPLEX",
        desc: "modulator + carrier",
        size: (6, 1),
        inputs: vec![
            port("pitch", "PTCH", Role::Pitch),
            port("fm", "FM", Role::Audio),
        ],
        outputs: vec![
            port("out", "OUT", Role::Audio),
            port("mod", "MOD", Role::Audio),
        ],
        params: vec![
            knob("freq", "FREQ", 20.0, 5000.0, 110.0)
                .exp()
                .unit(Unit::Hz)
                .random(40.0, 440.0)
                .mod_depth(0.25)
                .into(),
            knob("ratio", "RAT", 0.25, 8.0, 1.0)
                .exp()
                .random(0.5, 4.0)
                .into(),
            knob("index", "IDX", 0.0, 1.0, 0.2).into(),
            knob("timbre", "TMB", 0.0, 1.0, 0.0).into(),
            choice("mwave", "MOD", &["SIN", "TRI", "SAW"], 0)
                .glyph("wave")
                .into(),
        ],
        normals: vec![Normal::Internal {
            input: "fm",
            internal: "modulator",
        }],
        display: None,
    }
}

const PITCH: usize = 0;
const FM: usize = 1;
const FREQ: usize = 0;
const RATIO: usize = 1;
const INDEX: usize = 2;
const TIMBRE: usize = 3;
const MWAVE: usize = 0;

pub struct Complex {
    sample_rate: f64,
    carrier: f64,
    modulator: f64,
    folder: Folder,
}

impl Complex {
    pub fn new(sample_rate: f64) -> Self {
        Complex {
            sample_rate,
            carrier: 0.0,
            modulator: 0.0,
            folder: Folder::new(),
        }
    }
}

impl Dsp for Complex {
    fn process(&mut self, io: &mut Io, _ctx: &mut Ctx, from: usize, to: usize) {
        let wave = io.fixed[MWAVE] as u32;
        let fm_patched = io.connected_in[FM];
        for i in from..to {
            let base = io.par[FREQ][i] as f64 * (io.inp[PITCH][i] as f64).exp2();
            let minc = base * io.par[RATIO][i] as f64 / self.sample_rate;
            self.modulator = (self.modulator + minc).rem_euclid(1.0);
            let p = self.modulator;
            let dt = minc.abs().min(0.5);
            let m = match wave {
                0 => (std::f64::consts::TAU * p).sin(),
                1 => 1.0 - 4.0 * (p - 0.5).abs(),
                _ => 2.0 * p - 1.0 - super::osc::blep(p, dt),
            };
            // the FM input replaces the modulator when patched (the internal normal)
            let fm = if fm_patched { io.inp[FM][i] as f64 } else { m };
            let f = base * (1.0 + 4.0 * io.par[INDEX][i] as f64 * fm);
            self.carrier = (self.carrier + f / self.sample_rate).rem_euclid(1.0);
            let c = (std::f64::consts::TAU * self.carrier).sin() as f32;
            // timbre: the folder fades in over the first quarter, so TMB 0 is a pure sine
            let t = io.par[TIMBRE][i];
            let folded = self.folder.process(c, t, 0.0);
            let w = (4.0 * t).min(1.0);
            io.out[0][i] = (1.0 - w) * c + w * folded;
            io.out[1][i] = m as f32;
        }
    }

    fn reset(&mut self) {
        self.carrier = 0.0;
        self.modulator = 0.0;
        self.folder.reset();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::dsp::bench::{rising, Bench};
    use crate::dsp::BLOCK;

    const SR: f64 = 48_000.0;

    fn run(par: [f64; 4], fm: Option<f32>, blocks: usize) -> Vec<Vec<f32>> {
        let mut b = Bench::new(SR, 2, &par, &[0.0], 2);
        b.connected_in = vec![false, fm.is_some()];
        b.run(&mut Complex::new(SR), blocks, |_, i, inp| {
            inp[1][i] = fm.unwrap_or(0.0)
        })
    }

    #[test]
    fn index_zero_is_a_pure_sine_at_freq() {
        let o = run([440.0, 1.5, 0.0, 0.0], None, 100);
        for (n, y) in o[0].iter().enumerate().skip(10) {
            let want = (std::f64::consts::TAU * 440.0 * (n + 1) as f64 / SR).sin() as f32;
            assert!((y - want).abs() < 0.02, "sample {n}: {y} vs {want}");
        }
    }

    #[test]
    fn mod_runs_at_ratio_times_the_carrier() {
        let o = run([200.0, 2.0, 0.0, 0.0], None, 100);
        let c = rising(&o[1]);
        let period = (c[c.len() - 1] - c[0]) as f64 / (c.len() - 1) as f64;
        assert!((period - SR / 400.0).abs() < 1.0, "{period}");
    }

    #[test]
    fn a_patched_fm_input_replaces_the_modulator() {
        // a constant FM input of 0.25 at index 1 raises the carrier to 2× its frequency
        let o = run([200.0, 3.0, 1.0, 0.0], Some(0.25), 100);
        let c = rising(&o[0]);
        let period = (c[c.len() - 1] - c[0]) as f64 / (c.len() - 1) as f64;
        assert!((period - SR / 400.0).abs() < 1.0, "{period}");
    }

    #[test]
    fn blockwise_equals_per_sample() {
        let fm: Vec<f32> = (0..20 * BLOCK).map(|i| (i as f32 * 0.02).sin()).collect();
        Bench::blockwise_equals_per_sample(
            || Box::new(Complex::new(SR)),
            &[vec![], fm],
            &[150.0, 1.3, 0.4, 0.5],
            &[2.0],
            2,
            20,
        );
        Bench::blockwise_equals_per_sample(
            || Box::new(Complex::new(SR)),
            &[vec![], vec![]],
            &[150.0, 1.3, 0.4, 0.5],
            &[1.0],
            2,
            20,
        );
    }
}
