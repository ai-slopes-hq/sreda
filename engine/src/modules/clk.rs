//! CLOCK (spec §7c): a tempo without a frame. One 1 ms pulse per beat at BPM (its knob, so it can be modulated), the
//! first at once; while a cable is in CLK IN, that input (after its ratio) goes out instead and the own beat rests.

use crate::dsp::{Ctx, Dsp, Io};
use crate::modules::clock::Beat;
use crate::spec::{knob, port, ModuleSpec, Param, Role};

pub fn spec() -> ModuleSpec {
    ModuleSpec {
        type_: "clk",
        internal: false,
        label: "CLOCK",
        desc: "a tempo: one beat per BPM",
        size: (3, 1),
        inputs: vec![port("clk", "CLK", Role::Trigger)],
        outputs: vec![port("out", "CLK", Role::Trigger)],
        params: vec![
            knob("bpm", "BPM", 20.0, 300.0, 120.0)
                .random(80.0, 160.0)
                .into(),
            Param::Action {
                id: "tap",
                label: "TAP",
            },
        ],
        normals: vec![],
        display: None,
    }
}

pub struct Clk {
    sample_rate: f64,
    beat: Beat,
}

impl Clk {
    pub fn new(sample_rate: f64) -> Self {
        Clk {
            sample_rate,
            beat: Beat::new(sample_rate),
        }
    }
}

impl Dsp for Clk {
    fn process(&mut self, io: &mut Io, _ctx: &mut Ctx, from: usize, to: usize) {
        // a cable in CLK IN wins; without one, the own beat runs at the (modulated) BPM
        let run = !io.connected_in[0];
        let per_minute = 60.0 * self.sample_rate;
        for i in from..to {
            let step = (io.par[0][i] as f64).clamp(20.0, 300.0) / per_minute;
            let beat = self.beat.next(run, step);
            io.out[0][i] = if run { beat } else { io.inp[0][i] };
        }
    }

    fn reset(&mut self) {
        self.beat = Beat::new(self.sample_rate);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::dsp::bench::Bench;
    use crate::dsp::BLOCK;

    fn rises(s: &[f32]) -> Vec<usize> {
        (0..s.len())
            .filter(|&i| s[i] > 0.5 && (i == 0 || s[i - 1] <= 0.5))
            .collect()
    }

    fn intervals_near(r: &[usize], want: usize) {
        assert!(r.len() >= 2, "{r:?}");
        for w in r.windows(2) {
            assert!(
                (w[1] - w[0]).abs_diff(want) <= 1,
                "{} vs {want}",
                w[1] - w[0]
            );
        }
    }

    #[test]
    fn it_beats_at_bpm_with_the_first_at_once() {
        // 120 BPM at 48 kHz, 10 s = 3750 blocks
        let mut b = Bench::new(48_000.0, 1, &[120.0], &[], 1);
        let o = b.run(&mut Clk::new(48_000.0), 3750, |_, _, _| {});
        let r = rises(&o[0]);
        assert_eq!(r.len(), 20);
        assert_eq!(r[0], 0);
        intervals_near(&r, 24_000);
        let high = o[0][r[1]..r[1] + 60].iter().filter(|x| **x > 0.5).count();
        assert_eq!(high, 48, "1 ms pulses");
    }

    #[test]
    fn a_cable_in_clk_in_replaces_the_own_beat() {
        let mut b = Bench::new(48_000.0, 1, &[120.0], &[], 1);
        b.connected_in = vec![true];
        let o = b.run(&mut Clk::new(48_000.0), 100, |blk, i, inp| {
            inp[0][i] = if (blk * BLOCK + i) % 1000 < 48 {
                1.0
            } else {
                0.0
            };
        });
        assert_eq!(rises(&o[0]), (0..13).map(|k| k * 1000).collect::<Vec<_>>());
    }

    #[test]
    fn a_modulated_bpm_bends_without_a_lost_or_doubled_beat() {
        let mut b = Bench::new(48_000.0, 1, &[60.0], &[], 1);
        let mut c = Clk::new(48_000.0);
        let first = b.run(&mut c, 250, |_, _, _| {}); // 32 000 samples: two thirds of a beat at 60
        assert_eq!(rises(&first[0]), vec![0]);
        b.par[0] = [240.0; BLOCK];
        let rest = b.run(&mut c, 200, |_, _, _| {});
        let r = rises(&rest[0]);
        // the last third of the beat at 240 BPM (12 000 samples a beat) takes 4 000
        assert!(r[0].abs_diff(4_000) <= 1, "{}", r[0]);
        intervals_near(&r, 12_000);
    }

    #[test]
    fn unplugging_clk_in_restarts_with_a_beat_at_once() {
        let mut b = Bench::new(48_000.0, 1, &[120.0], &[], 1);
        let mut c = Clk::new(48_000.0);
        let first = b.run(&mut c, 3, |_, _, _| {}); // the first beat at sample 0
        assert_eq!(rises(&first[0]), vec![0]);
        b.connected_in = vec![true];
        let plugged = b.run(&mut c, 50, |_, _, _| {}); // a silent cable
        assert!(rises(&plugged[0]).is_empty());
        b.connected_in = vec![false];
        let freed = b.run(&mut c, 10, |_, _, _| {});
        assert_eq!(rises(&freed[0]), vec![0]);
    }

    #[test]
    fn a_bpm_beyond_its_range_clamps() {
        let mut b = Bench::new(48_000.0, 1, &[0.0], &[], 1);
        let o = b.run(&mut Clk::new(48_000.0), 2300, |_, _, _| {});
        assert!(o[0].iter().all(|x| x.is_finite()));
        intervals_near(&rises(&o[0]), 144_000);
        let mut b = Bench::new(48_000.0, 1, &[1000.0], &[], 1);
        let o = b.run(&mut Clk::new(48_000.0), 400, |_, _, _| {});
        intervals_near(&rises(&o[0]), 9_600);
    }

    #[test]
    fn blockwise_equals_per_sample() {
        let t: Vec<f32> = (0..20 * BLOCK)
            .map(|i| if i % 700 < 48 { 1.0 } else { 0.0 })
            .collect();
        Bench::blockwise_equals_per_sample(
            || Box::new(Clk::new(48_000.0)),
            &[t],
            &[120.0],
            &[],
            1,
            20,
        );
        Bench::blockwise_equals_per_sample(
            || Box::new(Clk::new(48_000.0)),
            &[vec![]],
            &[300.0],
            &[],
            1,
            200,
        );
    }

    #[test]
    fn its_spec_is_clock_3_by_1() {
        let s = spec();
        assert_eq!(
            (s.type_, s.label, s.size, s.internal),
            ("clk", "CLOCK", (3, 1), false)
        );
        let Param::Knob(k) = &s.params[0] else {
            panic!("bpm is a knob")
        };
        assert_eq!((k.id, k.min, k.max, k.def), ("bpm", 20.0, 300.0, 120.0));
        assert_eq!(k.random_range, Some((80.0, 160.0)));
        assert!(matches!(s.params[1], Param::Action { id: "tap", .. }));
    }
}
