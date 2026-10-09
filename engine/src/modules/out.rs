//! OUT: to the speakers. R unpatched follows L.

use crate::dsp::{Ctx, Dsp, Io};
use crate::spec::{choice, knob, port, ModuleSpec, Normal, Role};

pub fn spec() -> ModuleSpec {
    ModuleSpec {
        type_: "out",
        internal: false,
        label: "OUT",
        desc: "to speakers",
        size: (3, 1),
        inputs: vec![port("l", "L", Role::Audio), port("r", "R", Role::Audio)],
        outputs: vec![],
        params: vec![
            knob("level", "LVL", 0.0, 1.0, 0.7).into(),
            choice("mute", "MUTE", &["OFF", "ON"], 0).hidden().into(),
            choice("solo", "SOLO", &["OFF", "ON"], 0).hidden().into(),
        ],
        normals: vec![Normal::Internal {
            input: "r",
            internal: "L",
        }],
        display: None,
    }
}

/// The MIX strip's gain glides over 10 ms.
const GLIDE_MS: f64 = 10.0;

pub struct Out {
    /// mute / solo gain, gliding toward its target
    gain: f32,
    step: f32,
    /// the peak of this block after LVL, mute and solo
    peak: f32,
}

impl Out {
    pub fn new(sample_rate: f64) -> Self {
        Out {
            gain: 1.0,
            step: (1.0 / (GLIDE_MS * 0.001 * sample_rate).max(1.0)) as f32,
            peak: 0.0,
        }
    }
}

impl Dsp for Out {
    fn process(&mut self, io: &mut Io, ctx: &mut Ctx, from: usize, to: usize) {
        let (l, level) = (&io.inp[0], &io.par[0]);
        let r = if io.connected_in[1] { &io.inp[1] } else { l };
        let (mute, solo) = (io.fixed[0] >= 0.5, io.fixed[1] >= 0.5);
        let target = if mute || (ctx.solo_any && !solo) {
            0.0f32
        } else {
            1.0
        };
        if from == 0 {
            self.peak = 0.0;
        }
        for i in from..to {
            if self.gain < target {
                self.gain = (self.gain + self.step).min(target);
            } else if self.gain > target {
                self.gain = (self.gain - self.step).max(target);
            }
            let g = level[i] * self.gain;
            let (a, b) = (l[i] * g, r[i] * g);
            ctx.master[0][i] += a;
            ctx.master[1][i] += b;
            self.peak = self.peak.max(a.abs()).max(b.abs());
        }
    }

    fn reset(&mut self) {
        self.gain = 1.0;
        self.peak = 0.0;
    }

    fn state(&self) -> f32 {
        self.peak
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::dsp::bench::Bench;

    #[test]
    fn only_l_patched_writes_both_channels_at_level() {
        let mut b = Bench::new(48_000.0, 2, &[0.5], &[0.0, 0.0], 0);
        b.connected_in[0] = true;
        b.run(&mut Out::new(48_000.0), 1, |_, i, inp| {
            inp[0][i] = 0.8 * (i as f32 / 128.0)
        });
        for i in 0..128 {
            let want = 0.4 * (i as f32 / 128.0);
            assert!((b.ctx.master[0][i] - want).abs() < 1e-6);
            assert!((b.ctx.master[1][i] - want).abs() < 1e-6);
        }
    }

    #[test]
    fn both_patched_keep_their_channels() {
        let mut b = Bench::new(48_000.0, 2, &[1.0], &[0.0, 0.0], 0);
        b.connected_in = vec![true, true];
        b.run(&mut Out::new(48_000.0), 1, |_, i, inp| {
            inp[0][i] = 0.3;
            inp[1][i] = -0.2;
        });
        assert!((b.ctx.master[0][5] - 0.3).abs() < 1e-6 && (b.ctx.master[1][5] + 0.2).abs() < 1e-6);
    }

    #[test]
    fn mute_silences_within_ten_ms_without_a_click() {
        let mut b = Bench::new(48_000.0, 2, &[1.0], &[1.0, 0.0], 0);
        b.connected_in[0] = true;
        let out = {
            // the bench keeps only the last block's master; collect per block
            let mut dsp = Out::new(48_000.0);
            let mut all = Vec::new();
            for _ in 0..6 {
                b.run(&mut dsp, 1, |_, i, inp| inp[0][i] = 0.5);
                all.extend_from_slice(&b.ctx.master[0]);
            }
            all
        };
        assert!(out.windows(2).all(|w| (w[1] - w[0]).abs() <= 0.05));
        assert!(out[0] > 0.4, "starts at full: {}", out[0]);
        assert!(
            out[480..].iter().all(|x| x.abs() < 1e-6),
            "silent after 10 ms"
        );
    }

    #[test]
    fn solo_elsewhere_silences_and_state_is_the_peak_after_lvl() {
        let mut b = Bench::new(48_000.0, 2, &[0.5], &[0.0, 0.0], 0);
        b.connected_in[0] = true;
        let mut dsp = Out::new(48_000.0);
        b.run(&mut dsp, 1, |_, i, inp| inp[0][i] = 0.8);
        assert!((dsp.state() - 0.4).abs() < 1e-6, "{}", dsp.state());
        b.ctx.solo_any = true;
        for _ in 0..5 {
            b.run(&mut dsp, 1, |_, i, inp| inp[0][i] = 0.8);
        }
        assert_eq!(dsp.state(), 0.0);
    }
}
