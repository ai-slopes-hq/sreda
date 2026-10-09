// The factory projects (spec §6), built only from the first modules.
import type { Builder } from './build';

export const PROJECTS: { name: string; build(b: Builder): void }[] = [
  {
    // an OSC square at 2 Hz pings an LPG on a 50 Hz sine (kick); the same clock, ×2 on the input, pings a second LPG
    // on NOISE (hats); MIX → OUT
    name: 'pulse',
    build(S) {
      const clk = S.add('osc', 0, 0, { freq: 2, wave: 3 });
      const ko = S.add('osc', 0, 144, { freq: 50, wave: 0 });
      const nz = S.add('noise', 0, 288, { level: 0.6 });
      const l1 = S.add('lpg', 336, 144, { decay: 0.3 });
      const l2 = S.add('lpg', 336, 288, { decay: 0.08 });
      const mx = S.add('mix', 624, 144);
      const o = S.add('out', 864, 144);
      const sc = S.add('scope', 864, 288, { time: 2 });
      S.wire(clk, 'out', l1, 'ping');
      S.wire(ko, 'out', l1, 'in');
      S.wire(clk, 'out', l2, 'ping');
      S.rat(l2, 'ping', 2);
      S.wire(nz, 'white', l2, 'in');
      S.wire(l1, 'out', mx, 'a');
      S.wire(l2, 'out', mx, 'b');
      S.wire(mx, 'out', o, 'l');
      S.wire(mx, 'out', sc, 'a');
      S.wire(clk, 'out', sc, 'b');
    },
  },
  {
    // COMPLEX → FOLD → FILTER (LP) → DELAY → OUT; UNCERTAINTY's smooth output on the fold, a slow cycling SLOPE on
    // the cutoff
    name: 'drone',
    build(S) {
      const cx = S.add('complex', 0, 0, { freq: 55, ratio: 1.5, index: 0.15 });
      const fo = S.add('fold', 384, 0, { fold: 3 }); // ×3, the old FOLD 0.25
      const fl = S.add('filter', 624, 0, { cutoff: 700, res: 0.45 });
      const dl = S.add('delay', 912, 0, { time: 0.5, feedback: 0.6, mix: 0.35 });
      const o = S.add('out', 1200, 0);
      const un = S.add('uncertainty', 0, 176, { rate: 0.2 });
      const sl = S.add('slope', 384, 176, { rise: 6, fall: 9, cycle: 1 });
      const sc = S.add('scope', 720, 176, { time: 6 });
      S.wire(cx, 'out', fo, 'in');
      S.wire(fo, 'out', fl, 'in');
      S.wire(fl, 'lp', dl, 'in');
      S.wire(dl, 'l', o, 'l');
      S.wire(dl, 'r', o, 'r');
      S.wire(un, 'smooth', fo, '@fold');
      S.att(fo, '@fold', 0.3);
      S.wire(sl, 'out', fl, '@cutoff');
      S.wire(fl, 'lp', sc, 'a');
      S.wire(sl, 'out', sc, 'b');
    },
  },
  {
    // a cycling SLOPE advances STAGES; STAGES → QUANT → OSC pitch; STAGES' pulse pings an LPG on that OSC; STAGES'
    // voltage also feeds the SLOPE's fall, so the rhythm breathes
    name: 'self-clocked',
    build(S) {
      const sl = S.add('slope', 0, 0, { rise: 0.005, fall: 0.35, cycle: 1 });
      const st = S.add('stages', 0, 176, {
        length: 8,
        v1: 0,
        v2: 0.25,
        v3: 0.58,
        v4: 0,
        v5: 0.83,
        v6: 0.42,
        v7: 0.25,
        v8: -0.17,
        p3: 1,
        p6: 1,
      });
      const q = S.add('quant', 528, 176, { scale: 1 });
      const os = S.add('osc', 768, 176, { freq: 110, wave: 2 });
      const lp = S.add('lpg', 1104, 176, { decay: 0.25 });
      const o = S.add('out', 1392, 176);
      S.wire(sl, 'eoc', st, 'adv');
      S.wire(st, 'cv', q, 'in');
      S.wire(q, 'out', os, 'pitch');
      S.wire(st, 'pulse', lp, 'ping');
      S.wire(os, 'out', lp, 'in');
      S.wire(lp, 'out', o, 'l');
      S.wire(st, 'cv', sl, '@fall');
      S.att(sl, '@fall', 0.3);
    },
  },
  {
    // a group with its own clock at 120 BPM; CLK OUT → two STAGES, one at ÷3, one at ×2, each driving its own voice
    name: 'polymeter',
    build(S) {
      const sa = S.add('stages', 0, 96, { length: 5, v1: 0, v2: 0.33, v3: 0.17, v4: 0.58, v5: 0.42 });
      const oa = S.add('osc', 528, 96, { freq: 110, wave: 2 });
      const la = S.add('lpg', 864, 96, { decay: 0.2 });
      const sb = S.add('stages', 0, 544, {
        length: 7,
        v1: -0.5,
        v2: -0.33,
        v3: -0.5,
        v4: -0.17,
        v5: -0.5,
        v6: -0.42,
        v7: -0.25,
      });
      const ob = S.add('osc', 528, 544, { freq: 110, wave: 0 });
      const lb = S.add('lpg', 864, 544, { decay: 0.12 });
      const mx = S.add('mix', 1216, 352);
      const o = S.add('out', 1456, 352);
      const ga = S.frame([sa, oa, la], 'VOICE A', { ratio: -3, tint: 1 });
      const gb = S.frame([sb, ob, lb], 'VOICE B', { ratio: 2, tint: 5 });
      S.frame([ga, gb], 'POLY', { bpm: 120 });
      S.wire(ga, 'clkOut', sa, 'adv');
      S.wire(gb, 'clkOut', sb, 'adv');
      S.wire(sa, 'cv', oa, 'pitch');
      S.wire(sa, 'pulse', la, 'ping');
      S.wire(oa, 'out', la, 'in');
      S.wire(sb, 'cv', ob, 'pitch');
      S.wire(sb, 'pulse', lb, 'ping');
      S.wire(ob, 'out', lb, 'in');
      S.wire(la, 'out', mx, 'a');
      S.wire(lb, 'out', mx, 'b');
      S.wire(mx, 'out', o, 'l');
    },
  },
  {
    // S&H (input normalled to noise), sampled on a SLOPE's EOC, sets that SLOPE's fall, so the rhythm drifts
    name: 'ratchet',
    build(S) {
      const sl = S.add('slope', 0, 0, { rise: 0.003, fall: 0.2, cycle: 1 });
      const sh = S.add('snh', 336, 0);
      const os = S.add('osc', 336, 160, { freq: 220, wave: 0 });
      const lp = S.add('lpg', 672, 64, { decay: 0.15 });
      const o = S.add('out', 960, 64);
      S.wire(sl, 'eoc', sh, 'trig');
      S.wire(sh, 'out', sl, '@fall');
      S.att(sl, '@fall', 0.5);
      S.wire(sl, 'eoc', lp, 'ping');
      S.wire(os, 'out', lp, 'in');
      S.wire(lp, 'out', o, 'l');
    },
  },
  {
    // a frame ACID with its own clock at 128 BPM; RHYTHM (GRID) at ×4 on its CLK; GATE advances STAGES (16 notes in
    // C minor, four slides) and fires the filter and amp SLOPEs; ACC fires a third SLOPE on the same CUTOFF mod jack;
    // STAGES → OSC (saw) → FILTER (LP, high res) → LPG in VCA mode → DELAY → OUT
    name: 'acid',
    build(S) {
      const rh = S.add('rhythm', 0, 96, { mode: 1, hits: 7 });
      S.grid(rh, 'x.x-..x.x.xx-.x.', '...........A..A.');
      const st = S.add(
        'stages',
        528,
        96,
        S.notes({ gen: 0, scale: 2 }, [0, 0, 12, 3, 7, 0, 10, 5, 0, 12, 3, 3, 7, 10, 0, 15], [3, 6, 11, 14]),
      );
      const os = S.add('osc', 0, 480, { freq: 110, wave: 2 });
      const fl = S.add('filter', 336, 480, { cutoff: 260, res: 0.82 });
      const va = S.add('lpg', 576, 480, { level: 0, mode: 0 });
      const dl = S.add('delay', 768, 480, { time: 0.35, feedback: 0.35, mix: 0.2 });
      const o = S.add('out', 1056, 480);
      const ef = S.add('slope', 0, 640, { rise: 0.002, fall: 0.25 });
      const ea = S.add('slope', 336, 640, { rise: 0.002, fall: 0.2 });
      const ec = S.add('slope', 672, 640, { rise: 0.002, fall: 0.12 });
      const g = S.frame([rh, st, os, fl, va, dl, o, ef, ea, ec], 'ACID', { bpm: 128, tint: 2 });
      S.wire(g, 'clkOut', rh, 'clk');
      S.rat(rh, 'clk', 4);
      S.wire(rh, 'gate', st, 'adv');
      S.wire(rh, 'gate', ef, 'trig');
      S.wire(rh, 'gate', ea, 'trig');
      S.wire(rh, 'acc', ec, 'trig');
      S.wire(st, 'cv', os, 'pitch');
      S.wire(os, 'out', fl, 'in');
      S.wire(fl, 'lp', va, 'in');
      S.wire(va, 'out', dl, 'in');
      S.wire(dl, 'l', o, 'l');
      S.wire(dl, 'r', o, 'r');
      S.wire(ef, 'out', fl, '@cutoff');
      S.att(fl, '@cutoff', 0.35);
      S.wire(ec, 'out', fl, '@cutoff');
      S.wire(ea, 'out', va, '@level');
    },
  },
];
