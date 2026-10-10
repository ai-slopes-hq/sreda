use super::*;
use crate::dsp::bench::Bench;
use crate::dsp::{BLOCK, TRACE_LEN};
use crate::spec::Param;

const CV: usize = 0;
const GATE: usize = 1;
const ACC: usize = 2;
const VEL: usize = 3;
const EOC: usize = 4;
const SR: f64 = 48_000.0;
/// a clock every 1200 samples (40 per second)
const TICK: usize = 1200;
/// PAT, TRNS, MUT, DENS
const PAR: [f64; 4] = [0.0, 0.0, 0.0, 0.5];

/// Every fixed value at its spec default, in spec order.
fn defaults() -> Vec<f64> {
    spec()
        .params
        .iter()
        .filter_map(|p| match p {
            Param::Knob(k) if k.hidden => Some(k.def),
            Param::Option(c) => Some(c.def as f64),
            _ => None,
        })
        .collect()
}
fn steps(f: &mut [f64], p: usize, l: usize, v: &[f64]) {
    for (k, x) in v.iter().enumerate() {
        f[lane_at(p, l) + k] = *x;
    }
}
fn pads(s: &str) -> Vec<f64> {
    s.chars()
        .map(|c| if c == 'x' { 1.0 } else { 0.0 })
        .collect()
}
fn set_len(f: &mut [f64], p: usize, l: usize, len: usize) {
    f[lane_at(p, l) + STEPS] = len as f64;
}
fn set_rate(f: &mut [f64], p: usize, l: usize, rate: usize) {
    f[lane_at(p, l) + STEPS + 1] = rate as f64;
}
fn set_step_mode(f: &mut [f64], p: usize) {
    f[p * PATTERN_PARAMS + LANES * LANE_PARAMS] = 1.0;
}
/// Pattern `p` with GATE `gate` (LEN = its length), every other lane at its default.
fn with_gate(p: usize, gate: &str) -> Vec<f64> {
    let mut f = defaults();
    steps(&mut f, p, G, &pads(gate));
    set_len(&mut f, p, G, gate.len());
    f
}
fn rises(s: &[f32]) -> Vec<usize> {
    (0..s.len())
        .filter(|&i| s[i] > 0.5 && (i == 0 || s[i - 1] <= 0.5))
        .collect()
}
fn clock(n: usize, end: usize) -> f32 {
    if n < end && n % TICK < 48 {
        1.0
    } else {
        0.0
    }
}
fn bench(par: [f64; 4], f: &[f64]) -> Bench {
    let mut b = Bench::new(SR, 3, &par, f, 5);
    b.connected_in = vec![true, true, false];
    b
}
/// Runs `ticks` clocks (and a tick of tail); `extra(n, inp, i)` may drive RST.
fn play(
    par: [f64; 4],
    f: &[f64],
    ticks: usize,
    mut extra: impl FnMut(usize, &mut [[f32; BLOCK]], usize),
) -> (Vec<Vec<f32>>, MetaSeq) {
    let mut b = bench(par, f);
    let mut m = MetaSeq::new(SR);
    let o = b.run(
        &mut m,
        ((ticks + 1) * TICK).div_ceil(BLOCK),
        |blk, i, inp| {
            let n = blk * BLOCK + i;
            inp[0][i] = clock(n, ticks * TICK);
            inp[1][i] = 0.0;
            extra(n, inp, i);
        },
    );
    (o, m)
}
/// The CV just before clock `k + 1`: what clock `k` left playing.
fn held(o: &[Vec<f32>], k: usize) -> f32 {
    o[CV][(k + 1) * TICK - 10]
}

#[test]
fn polymeter_note_7_over_gate_16_repeats_after_112_clocks() {
    let mut f = with_gate(0, "xxxxxxxxxxxxxxxx");
    set_step_mode(&mut f, 0);
    steps(&mut f, 0, N, &[12.0, 14.0, 15.0, 17.0, 19.0, 20.0, 22.0]);
    set_len(&mut f, 0, N, 7);
    let (o, _) = play(PAR, &f, 336, |_, _, _| {});
    // per clock: the note it played and whether the GATE lane wrapped there (EOC; not at the start)
    let seq: Vec<(f32, bool)> = (0..336)
        .map(|k| {
            let eoc = o[EOC][k * TICK..(k + 1) * TICK].iter().any(|x| *x > 0.5);
            (held(&o, k), eoc)
        })
        .collect();
    let (cycle, again) = (&seq[112..224], &seq[224..]);
    assert_eq!(cycle, again, "repeats after 112 clocks");
    assert_eq!(seq[1..112], seq[113..224], "from the start too");
    for d in (1..112).filter(|d| 112 % d == 0) {
        assert!(
            (d..112).any(|k| cycle[k] != cycle[k - d]),
            "a shorter period {d}"
        );
    }
    assert_eq!(rises(&o[GATE]).len(), 336, "every step a hit");
}

#[test]
fn rate_x2_steps_twice_per_clock_and_div2_once_per_two() {
    let mut f = with_gate(0, "xxxxxxxxxxxxxxxx");
    set_rate(&mut f, 0, G, 4);
    let (o, _) = play(PAR, &f, 11, |_, _, _| {});
    // once the interval is known: a step at the clock and one half way
    let r: Vec<usize> = rises(&o[GATE])
        .into_iter()
        .filter(|n| (2 * TICK..10 * TICK).contains(n))
        .collect();
    assert_eq!(r.len(), 16, "{r:?}");
    assert!(r.iter().all(|n| n % (TICK / 2) == 0), "{r:?}");

    set_rate(&mut f, 0, G, 2);
    let (o, _) = play(PAR, &f, 8, |_, _, _| {});
    let r: Vec<usize> = rises(&o[GATE]).iter().map(|n| n / TICK).collect();
    assert_eq!(r, [0, 2, 4, 6]);
}

#[test]
fn played_waits_on_rests_step_does_not() {
    let notes: Vec<f64> = [0.0, 2.0, 4.0, 5.0].iter().map(|s| s + 12.0).collect();
    let mut f = with_gate(0, "x.x.");
    steps(&mut f, 0, N, &notes);
    set_len(&mut f, 0, N, 4);
    f[SCALE] = 0.0; // CHR: the notes as drawn
    let at_hits =
        |o: &[Vec<f32>]| -> Vec<f32> { [0, 2, 4, 6].iter().map(|&k| held(o, k) * 12.0).collect() };
    let (o, _) = play(PAR, &f, 8, |_, _, _| {});
    assert_eq!(at_hits(&o), [0.0, 2.0, 4.0, 5.0], "PLAYED");
    set_step_mode(&mut f, 0);
    let (o, _) = play(PAR, &f, 8, |_, _, _| {});
    assert_eq!(at_hits(&o), [0.0, 4.0, 0.0, 4.0], "STEP");
}

#[test]
fn a_tie_holds_the_gate_and_glides_to_a_new_note() {
    let mut f = with_gate(0, "x.");
    set_step_mode(&mut f, 0);
    steps(&mut f, 0, N, &[12.0, 24.0]);
    set_len(&mut f, 0, N, 2);
    steps(&mut f, 0, T, &pads(".x"));
    set_len(&mut f, 0, T, 2);
    f[SCALE] = 0.0;
    // two clocks, then on past the glide (80 ms is 3840 samples)
    let mut b = bench(PAR, &f);
    let o = b.run(
        &mut MetaSeq::new(SR),
        8000usize.div_ceil(BLOCK),
        |blk, i, inp| {
            inp[0][i] = clock(blk * BLOCK + i, 2 * TICK);
        },
    );
    assert_eq!(rises(&o[GATE]), [0], "one rise: the tie holds");
    assert!(o[GATE][TICK - 1] > 0.5 && o[GATE][TICK + 1] > 0.5);
    let mid = o[CV][TICK + 1920];
    assert!(mid > 0.4 && mid < 0.6, "half way at 40 ms: {mid}");
    assert!(o[CV][TICK + 10] < 0.1, "a glide, not a jump");
    assert_eq!(o[CV][TICK + 4000], 1.0, "arrived");
    assert_eq!(rises(&o[ACC]).len(), 0);
}

/// PLAYED, NOTE 12 / 24, TIE `.x`, GATE `gate`: two clocks, then on past any glide.
fn played_tie(gate: &str) -> Vec<Vec<f32>> {
    let mut f = with_gate(0, gate);
    steps(&mut f, 0, N, &[12.0, 24.0]);
    set_len(&mut f, 0, N, 2);
    steps(&mut f, 0, T, &pads(".x"));
    set_len(&mut f, 0, T, 2);
    f[SCALE] = 0.0;
    let mut b = bench(PAR, &f);
    b.run(
        &mut MetaSeq::new(SR),
        8000usize.div_ceil(BLOCK),
        |blk, i, inp| {
            inp[0][i] = clock(blk * BLOCK + i, 2 * TICK);
        },
    )
}

#[test]
fn played_tie_with_gate_slides_to_the_next_note() {
    let o = played_tie("xx");
    assert_eq!(rises(&o[GATE]), [0], "one rise: a slide does not retrigger");
    assert!(o[GATE][TICK - 1] > 0.5 && o[GATE][TICK + 1] > 0.5);
    let mid = o[CV][TICK + 1920];
    assert!(mid > 0.4 && mid < 0.6, "half way at 40 ms: {mid}");
    assert_eq!(o[CV][TICK + 4000], 1.0, "NOTE advanced to 24: 1 V");
}

#[test]
fn played_tie_without_gate_holds_the_note() {
    let o = played_tie("x.");
    assert_eq!(rises(&o[GATE]), [0], "one rise: the hold");
    assert!(o[GATE][TICK + 1] > 0.5, "held through the tie");
    assert!(
        o[CV].iter().all(|x| *x == 0.0),
        "NOTE did not advance: the first note stays"
    );
}

#[test]
fn chance_and_dens_by_seed() {
    let mut f = with_gate(0, "xxxxxxxxxxxxxxxx");
    steps(&mut f, 0, C, &[0.5; STEPS]);
    let hits = |dens: f64| {
        let (o, _) = play([0.0, 0.0, 0.0, dens], &f, 1000, |_, _, _| {});
        rises(&o[GATE]).len()
    };
    let half = hits(0.5);
    assert!((450..=550).contains(&half), "{half} of 1000");
    assert_eq!(hits(0.0), 0, "DENS 0: none");
    assert_eq!(hits(1.0), 1000, "DENS 1: all");
}

#[test]
fn pat_switches_only_on_the_gate_wrap() {
    // pattern a plays 0 V, pattern b 1 V; both GATE all on over 4 steps
    let mut f = with_gate(0, "xxxx");
    steps(&mut f, 1, G, &pads("xxxx"));
    set_len(&mut f, 1, G, 4);
    steps(&mut f, 1, N, &[24.0; STEPS]);
    f[SCALE] = 0.0;
    let mut b = bench(PAR, &f);
    let mut m = MetaSeq::new(SR);
    let first = (5 * TICK + 300).div_ceil(BLOCK);
    let a = b.run(&mut m, first, |blk, i, inp| {
        inp[0][i] = clock(blk * BLOCK + i, usize::MAX);
    });
    // PAT moves to B during the second cycle (clocks 4–7)
    b.par[0] = [1.0; BLOCK];
    let rest = b.run(
        &mut m,
        (10 * TICK).div_ceil(BLOCK) - first,
        |blk, i, inp| {
            inp[0][i] = clock((blk + first) * BLOCK + i, usize::MAX);
        },
    );
    let o: Vec<f32> = a[CV].iter().chain(rest[CV].iter()).copied().collect();
    let cv: Vec<f32> = (0..9).map(|k| o[(k + 1) * TICK - 10]).collect();
    assert_eq!(cv, [0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 1.0]);
}

#[test]
fn trns_snaps_to_the_scale() {
    // MIN from C: C D E♭ F G A♭ B♭
    assert_eq!(snap(14, 2, 0), 14, "in the scale");
    assert_eq!(snap(13, 2, 0), 12, "a tie between 12 and 14 goes down");
    assert_eq!(
        snap(16, 2, 0),
        15,
        "E → E♭ (tie between 15 and 17 goes down)"
    );
    assert_eq!(snap(14, 5, 0), 15, "PMIN: D → E♭, the nearer");
    assert_eq!(snap(-1, 2, 0), -2, "below C: B♭");
    assert_eq!(snap(13, 1, 1), 13, "MAJ from C♯ holds C♯");
    let mut f = with_gate(0, "x");
    steps(&mut f, 0, N, &[12.0; STEPS]);
    let cv = |trns: f64| {
        let (o, _) = play([0.0, trns, 0.0, 0.5], &f, 1, |_, _, _| {});
        held(&o, 0)
    };
    assert_eq!(cv(1.0), 0.0, "12 + 1 = 13 snaps down to 12");
    assert_eq!(cv(2.0), 2.0 / 12.0, "12 + 2 = 14 is D");
    assert_eq!(cv(4.0), 3.0 / 12.0, "12 + 4 = 16 snaps to E♭");
    assert_eq!(cv(-24.0), -2.0, "two octaves down");
}

#[test]
fn eoc_and_reset() {
    let mut f = with_gate(0, "xxxx");
    set_step_mode(&mut f, 0);
    steps(&mut f, 0, N, &[12.0, 13.0, 14.0, 15.0]);
    set_len(&mut f, 0, N, 4);
    f[SCALE] = 0.0;
    let (o, _) = play(PAR, &f, 12, |n, inp, i| {
        inp[1][i] = if (5 * TICK + 200..5 * TICK + 248).contains(&n) {
            1.0
        } else {
            0.0
        };
    });
    let eoc: Vec<usize> = rises(&o[EOC]).iter().map(|n| n / TICK).collect();
    assert_eq!(
        eoc,
        [4, 10],
        "wraps at 4; RST after clock 5 → step 1 at 6, wrap at 10"
    );
    assert_eq!(held(&o, 5), 1.0 / 12.0, "clock 5 played step 2");
    assert_eq!(held(&o, 6), 0.0, "clock 6 played step 1 again");
}

#[test]
fn lowering_len_wraps_only_that_lane() {
    let mut f = with_gate(0, "xxxxxxxxxxxxxxxx");
    set_step_mode(&mut f, 0);
    let mut b = bench(PAR, &f);
    let mut m = MetaSeq::new(SR);
    let first = (9 * TICK + 300).div_ceil(BLOCK);
    b.run(&mut m, first, |blk, i, inp| {
        inp[0][i] = clock(blk * BLOCK + i, usize::MAX)
    });
    let t = m.trace().unwrap();
    assert_eq!([t[1 + N], t[1 + G], t[1 + T]], [9.0, 9.0, 9.0]);
    b.fixed[lane_at(0, N) + STEPS] = 4.0;
    b.run(
        &mut m,
        (10 * TICK + 300).div_ceil(BLOCK) - first,
        |blk, i, inp| inp[0][i] = clock((blk + first) * BLOCK + i, usize::MAX),
    );
    let t = m.trace().unwrap();
    assert_eq!(t[1 + N], 0.0, "NOTE wrapped to step 1");
    assert_eq!(
        [t[1 + G], t[1 + T], t[1 + C]],
        [10.0, 10.0, 10.0],
        "others went on"
    );
    assert_eq!(m.state(), 10.0);
}

#[test]
fn an_audio_rate_clock_stays_in_range() {
    let mut f = with_gate(0, "x.xx..x.x.xx..x.");
    set_rate(&mut f, 0, G, 6);
    steps(&mut f, 0, T, &pads("...x...x....x..."));
    steps(&mut f, 0, A, &pads("x.x.x.x.x.x.x.x."));
    steps(&mut f, 0, N, &[0.0, 24.0, 7.0, 19.0, 3.0]);
    set_len(&mut f, 0, N, 5);
    set_rate(&mut f, 0, T, 0);
    let mut b = bench([0.0, 5.0, 0.0, 0.8], &f);
    let o = b.run(&mut MetaSeq::new(SR), 400, |blk, i, inp| {
        inp[0][i] = if (blk * BLOCK + i) % 24 < 12 {
            1.0
        } else {
            0.0
        }
    });
    for out in [GATE, ACC, EOC] {
        assert!(
            o[out].iter().all(|x| *x == 0.0 || *x == 1.0),
            "output {out}"
        );
    }
    assert!(o[VEL].iter().all(|x| (0.0..=1.0).contains(x)));
    assert!(o[CV].iter().all(|x| x.is_finite() && x.abs() <= 1.5));
    // a ×4 GATE lane of 16 steps wraps every 4 clocks: 400 blocks hold ~533 clocks
    assert!(rises(&o[EOC]).len() > 100, "{}", rises(&o[EOC]).len());
}

#[test]
fn blockwise_equals_per_sample() {
    let n = 40 * BLOCK;
    let clk: Vec<f32> = (0..n)
        .map(|i| if i % 300 < 48 { 1.0 } else { 0.0 })
        .collect();
    let rst: Vec<f32> = (0..n)
        .map(|i| if (2500..2548).contains(&i) { 1.0 } else { 0.0 })
        .collect();
    let mut f = with_gate(0, "x.xx..x.x.xx..x");
    steps(&mut f, 0, T, &pads("...x....x......"));
    steps(&mut f, 0, A, &pads("x.....x.....x"));
    steps(&mut f, 0, N, &[12.0, 15.0, 19.0, 10.0, 22.0]);
    set_len(&mut f, 0, N, 5);
    set_rate(&mut f, 0, A, 5);
    set_rate(&mut f, 0, V, 1);
    steps(&mut f, 0, V, &[0.2, 0.9, 0.5]);
    steps(&mut f, 0, C, &[0.7; STEPS]);
    Bench::blockwise_equals_per_sample(
        || Box::new(MetaSeq::new(48_000.0)),
        &[clk, rst, vec![]],
        &[0.0, 3.0, 0.0, 0.5],
        &f,
        5,
        40,
    );
}

#[test]
fn the_trace_reports_pattern_cursors_and_live_steps() {
    // pattern C (index 2) plays: GATE x..x over 4, NOTE 12 14 15 (STEP) over 3
    let mut f = defaults();
    steps(&mut f, 2, G, &pads("x..x"));
    set_len(&mut f, 2, G, 4);
    steps(&mut f, 2, N, &[12.0, 14.0, 15.0]);
    set_len(&mut f, 2, N, 3);
    set_step_mode(&mut f, 2);
    steps(&mut f, 2, V, &[0.25]);
    let mut b = bench([2.0, 0.0, 0.0, 0.5], &f);
    let mut m = MetaSeq::new(SR);
    b.run(&mut m, 1, |_, i, inp| inp[0][i] = 0.0);
    let t = m.trace().unwrap();
    assert_eq!(t.len(), TRACE_LEN);
    assert_eq!(&t[1..7], &[-1.0; 6], "no step yet");
    let first = (4 * TICK + 300).div_ceil(BLOCK);
    b.run(&mut m, first, |blk, i, inp| {
        inp[0][i] = clock(blk * BLOCK + i, usize::MAX)
    });
    let t = m.trace().unwrap().to_vec();
    assert_eq!(t[0], 2.0, "pattern C");
    // clocks 0–4 played: GATE 4 steps → step 1; NOTE 3 → step 2; the others 16 → step 5
    assert_eq!(&t[1..7], &[1.0, 0.0, 4.0, 4.0, 4.0, 4.0]);
    assert_eq!(t[7], 0.0, "no mutation yet");
    assert_eq!(&t[8..11], &[12.0, 14.0, 15.0], "NOTE in semitones");
    assert_eq!(&t[8 + G * 16..8 + G * 16 + 4], &[1.0, 0.0, 0.0, 1.0]);
    assert_eq!(t[8 + V * 16], 0.25);
    assert_eq!(t[8 + C * 16 + 15], 1.0);
    assert_eq!(m.state(), 0.0, "the GATE cursor");
    // an edit to the playing pattern reaches the live steps on the next block
    b.fixed[lane_at(2, N) + 1] = 19.0;
    b.run(&mut m, 1, |_, i, inp| inp[0][i] = 0.0);
    assert_eq!(m.trace().unwrap()[9], 19.0);
}

/// A pattern A with something in every lane, each lane 8 steps long (STEP mode, so every lane wraps every 8 clocks).
fn busy() -> Vec<f64> {
    let mut f = with_gate(0, "x.xx..x.");
    set_step_mode(&mut f, 0);
    steps(
        &mut f,
        0,
        N,
        &[12.0, 14.0, 15.0, 19.0, 12.0, 7.0, 15.0, 14.0],
    );
    steps(&mut f, 0, T, &pads("...x...."));
    steps(&mut f, 0, A, &pads("x.....x."));
    steps(&mut f, 0, V, &[0.2, 0.9, 0.5, 0.7, 0.4, 0.6, 0.3, 0.8]);
    steps(&mut f, 0, C, &[0.5, 0.6, 0.7, 0.8, 0.9, 0.4, 0.3, 0.2]);
    for l in 0..LANES {
        set_len(&mut f, 0, l, 8);
    }
    f[SCALE] = 0.0;
    f
}
fn lock(f: &mut [f64], p: usize, l: usize) {
    f[lane_at(p, l) + STEPS + 2] = 1.0;
}
/// The playing pattern's lane `l` as written in `f` (pattern A).
fn written(f: &[f64], l: usize) -> Vec<f32> {
    (0..STEPS).map(|k| f[lane_at(0, l) + k] as f32).collect()
}
fn live(m: &MetaSeq, l: usize) -> Vec<f32> {
    let t = m.trace().unwrap();
    t[TR_LIVE + l * STEPS..TR_LIVE + (l + 1) * STEPS].to_vec()
}
fn generation(m: &MetaSeq) -> f32 {
    m.trace().unwrap()[TR_GEN]
}
const MUT1: [f64; 4] = [0.0, 0.0, 1.0, 0.5];

#[test]
fn mut_zero_changes_nothing() {
    let f = busy();
    let (_, m) = play(PAR, &f, 40, |_, _, _| {});
    for l in 0..LANES {
        assert_eq!(live(&m, l), written(&f, l), "lane {l}");
    }
    assert_eq!(generation(&m), 0.0);
}

#[test]
fn mut_one_mutates_every_unlocked_lane() {
    let f = busy();
    // clock 8 wraps every lane once (clocks 0–7 played steps 1–8)
    let (o, m) = play(MUT1, &f, 9, |_, _, _| {});
    assert!(generation(&m) >= LANES as f32, "{}", generation(&m));
    for l in 0..LANES {
        let (now, was) = (live(&m, l), written(&f, l));
        assert_ne!(now[..8], was[..8], "lane {l} mutated");
        assert_eq!(now[8..], was[8..], "lane {l}: past LEN untouched");
    }
    let count = |v: &[f32]| v[..8].iter().filter(|x| **x >= 0.5).count();
    assert_eq!(
        count(&live(&m, G)),
        count(&written(&f, G)),
        "GATE swaps: the density stays"
    );
    let notes = written(&f, N);
    assert!(
        live(&m, N)[..8].iter().all(|x| notes[..8].contains(x)),
        "NOTE takes values already in the lane: {:?}",
        live(&m, N)
    );
    for l in [T, A] {
        assert!(
            live(&m, l).iter().all(|x| *x == 0.0 || *x == 1.0),
            "lane {l}"
        );
    }
    for l in [V, C] {
        let (now, was) = (live(&m, l), written(&f, l));
        for k in 0..8 {
            assert!((0.0..=1.0).contains(&now[k]), "lane {l} step {k}");
            assert!((now[k] - was[k]).abs() <= 0.25 + 1e-6, "lane {l} step {k}");
        }
    }
    assert!(o[CV].iter().all(|x| x.is_finite()));
    // the drift goes on: later wraps move again
    let (_, later) = play(MUT1, &f, 40, |_, _, _| {});
    assert!(generation(&later) >= 4.0 * LANES as f32);
}

#[test]
fn a_one_note_lane_moves_a_scale_degree() {
    for (note, allowed) in [(12.0, [11.0, 12.0, 14.0]), (24.0, [23.0, 24.0, 24.0])] {
        let mut f = busy();
        steps(&mut f, 0, N, &[note; 8]);
        f[SCALE] = 1.0; // MAJ from C
        let (_, m) = play(MUT1, &f, 9, |_, _, _| {});
        let now = live(&m, N);
        assert!(now[..8].iter().any(|x| *x != note as f32), "{now:?}");
        assert!(
            now[..8].iter().all(|x| allowed.contains(x)),
            "from {note}: {now:?}"
        );
    }
}

#[test]
fn a_locked_lane_never_mutates() {
    let mut f = busy();
    lock(&mut f, 0, N);
    lock(&mut f, 0, G);
    let (_, m) = play(MUT1, &f, 40, |_, _, _| {});
    assert_eq!(live(&m, N), written(&f, N));
    assert_eq!(live(&m, G), written(&f, G));
    assert_ne!(live(&m, V), written(&f, V), "VEL is unlocked");
}

#[test]
fn an_edit_during_mutation_wins() {
    let f = busy();
    let mut b = bench(MUT1, &f);
    let mut m = MetaSeq::new(SR);
    let blocks = (9 * TICK + 300).div_ceil(BLOCK);
    b.run(&mut m, blocks, |blk, i, inp| {
        inp[0][i] = clock(blk * BLOCK + i, usize::MAX)
    });
    assert_ne!(live(&m, V), written(&f, V), "mutated");
    // the drawer writes VEL step 3 after the mutation
    b.fixed[lane_at(0, V) + 2] = 0.05;
    b.run(&mut m, 1, |_, i, inp| inp[0][i] = 0.0);
    assert_eq!(live(&m, V)[2], 0.05, "the edit replaced the live value");
}

#[test]
fn rst_keeps_mutations() {
    let f = busy();
    let mut b = bench(MUT1, &f);
    let mut m = MetaSeq::new(SR);
    let first = (9 * TICK + 300).div_ceil(BLOCK);
    b.run(&mut m, first, |blk, i, inp| {
        inp[0][i] = clock(blk * BLOCK + i, usize::MAX)
    });
    let mutated: Vec<Vec<f32>> = (0..LANES).map(|l| live(&m, l)).collect();
    assert_ne!(mutated[N], written(&f, N));
    // MUT down, then RST and a clock: every lane at step 1, the mutated steps still sound
    b.par[2] = [0.0; BLOCK];
    b.run(&mut m, 4, |blk, i, inp| {
        let n = blk * BLOCK + i;
        inp[1][i] = if n < 48 { 1.0 } else { 0.0 };
        inp[0][i] = if (200..248).contains(&n) { 1.0 } else { 0.0 };
    });
    assert_eq!(&m.trace().unwrap()[1..7], &[0.0; 6], "every lane at step 1");
    for (l, was) in mutated.iter().enumerate() {
        assert_eq!(&live(&m, l), was, "lane {l} kept its mutations");
    }
}

#[test]
fn mutation_blockwise_equals_per_sample() {
    let n = 60 * BLOCK;
    let clk: Vec<f32> = (0..n)
        .map(|i| if i % 300 < 48 { 1.0 } else { 0.0 })
        .collect();
    Bench::blockwise_equals_per_sample(
        || Box::new(MetaSeq::new(48_000.0)),
        &[clk, vec![], vec![]],
        &[0.0, 0.0, 0.7, 0.5],
        &busy(),
        5,
        60,
    );
}

/// Patterns A and B both as `f`'s A, PAT alternating every GATE cycle (8 clocks) at MUT 1 for six cycles; then MUT 0
/// and each pattern played once more. Returns the generation and A's and B's live lanes on that last visit.
fn chained(f: &[f64]) -> (f32, [Vec<Vec<f32>>; 2]) {
    let mut f = f.to_vec();
    let a: Vec<f64> = f[lane_at(0, 0)..lane_at(1, 0)].to_vec();
    f[lane_at(1, 0)..lane_at(2, 0)].copy_from_slice(&a);
    let mut b = bench(MUT1, &f);
    let mut m = MetaSeq::new(SR);
    let mut done = 0;
    // run until just after clock `k`, PAT asking for `pat`
    let mut until = |b: &mut Bench, m: &mut MetaSeq, k: usize, pat: f32| {
        b.par[PAT] = [pat; BLOCK];
        let to = (k * TICK + 300).div_ceil(BLOCK);
        b.run(m, to - done, |blk, i, inp| {
            inp[0][i] = clock((blk + done) * BLOCK + i, usize::MAX)
        });
        done = to;
    };
    // A plays clocks 0–7, B 8–15, A 16–23, … : the switch is the GATE wrap
    for c in 0..6 {
        // PAT set during the cycle before: the wrap at clock 8c switches to it
        until(&mut b, &mut m, 8 * c + 1, (c % 2) as f32);
        assert_eq!(m.trace().unwrap()[0], (c % 2) as f32, "cycle {c}");
    }
    let generation = generation(&m);
    // MUT down: what each pattern drifted to must still be there when it plays again
    b.par[2] = [0.0; BLOCK];
    let mut out: [Vec<Vec<f32>>; 2] = [vec![], vec![]];
    for c in 6..8 {
        until(&mut b, &mut m, 8 * c + 1, (c % 2) as f32);
        assert_eq!(m.trace().unwrap()[0], (c % 2) as f32);
        out[c % 2] = (0..LANES).map(|l| live(&m, l)).collect();
    }
    (generation, out)
}

#[test]
fn drift_survives_pat_switches() {
    let f = busy();
    let (generation, lanes) = chained(&f);
    assert!(generation > 0.0, "the lanes mutated");
    for (p, lanes) in lanes.iter().enumerate() {
        let drifted = (0..LANES).filter(|&l| lanes[l] != written(&f, l)).count();
        assert!(
            drifted >= 4,
            "pattern {p}: {drifted} lanes kept their drift"
        );
    }
}

#[test]
fn a_pat_switch_is_every_lane_s_wrap_played_note_included() {
    // NOTE in PLAYED, LEN 8, over 4 hits a bar: with PAT stepping every bar it never reaches its own wrap
    let mut f = busy();
    f[lane_at(0, LANES)] = 0.0;
    let (_, lanes) = chained(&f);
    for (p, lanes) in lanes.iter().enumerate() {
        assert_ne!(lanes[N], written(&f, N), "pattern {p}: NOTE drifted");
    }
}
