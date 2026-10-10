// The factory projects (spec §6), built only from the first modules.
import { seqParams } from '../migrate/seq';
import { gridRhythm, stagesLine, type Builder } from './build';
import {
  chaoticBells,
  clap,
  drone,
  fmBass,
  grainCloud,
  hats,
  kick,
  pluck,
  snare,
  technoDrums,
  type Voice,
} from './voices';

/**
 * A project of voices (spec §6, revision 31): each voice in its own named frame inside one clock frame, mixed, through
 * the effects, into one OUT.
 */
function voicesProject(
  S: Builder,
  name: string,
  bpm: number,
  parts: [string, (S: Builder, x: number, y: number) => Voice, number][],
  fx: (
    S: Builder,
    x: number,
  ) => { ids: string[]; inp: [string, string]; out: [string, string]; clocks?: [string, string][] },
): void {
  let y = 0;
  const ids: string[] = [];
  const clocks: [string, string, number][] = [];
  const voices = parts.map(([frame, voice, tint]) => {
    const v = voice(S, 0, y);
    y += 1200;
    S.frame(v.ids, frame, { tint });
    ids.push(...v.ids);
    clocks.push(...v.clocks);
    return v;
  });
  const levels = ['la', 'lb', 'lc', 'ld'];
  const mx = S.add('mix', 2400, 0, Object.fromEntries(voices.map((_, i) => [levels[i]!, 0.7])));
  voices.forEach((v, i) => S.wire(v.out[0], v.out[1], mx, 'abcd'[i]!));
  const f = fx(S, 2700);
  S.wire(mx, 'out', f.inp[0], f.inp[1]);
  const o = S.add('out', 3600, 0, { level: 0.7 });
  S.wire(f.out[0], f.out[1], o, 'l');
  ids.push(mx, ...f.ids, o);
  const g = S.frame(ids, name, { bpm, tint: 1 });
  for (const [id, port, ratio] of clocks) {
    S.wire(g, 'clkOut', id, port);
    if (ratio !== 1) S.rat(id, port, ratio);
  }
  for (const [id, port] of f.clocks ?? []) S.wire(g, 'clkOut', id, port);
}

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
    // a cycling SLOPE clocks a META-SEQ (NOTE on STEP); its CV → QUANT → OSC pitch; its GATE pings an LPG on that
    // OSC; the CV also feeds the SLOPE's fall, so the rhythm breathes
    name: 'self-clocked',
    build(S) {
      const sl = S.add('slope', 0, 0, { rise: 0.005, fall: 0.35, cycle: 1 });
      const sq = S.seq(0, 176, seqParams(null, stagesLine([12, 15, 19, 12, 22, 17, 15, 10], { rests: [3, 6] })));
      const q = S.add('quant', 528, 176, { scale: 1 });
      const os = S.add('osc', 768, 176, { freq: 110, wave: 2 });
      const lp = S.add('lpg', 1104, 176, { decay: 0.25 });
      const o = S.add('out', 1392, 176);
      S.wire(sl, 'eoc', sq, 'clk');
      S.wire(sq, 'cv', q, 'in');
      S.wire(q, 'out', os, 'pitch');
      S.wire(sq, 'gate', lp, 'ping');
      S.wire(os, 'out', lp, 'in');
      S.wire(lp, 'out', o, 'l');
      S.wire(sq, 'cv', sl, '@fall');
      S.att(sl, '@fall', 0.3);
    },
  },
  {
    // a group with its own clock at 120 BPM; CLK OUT → two META-SEQs (5 and 7 notes), one at ÷3, one at ×2, each
    // driving its own voice
    name: 'polymeter',
    build(S) {
      const sa = S.seq(0, 96, seqParams(null, stagesLine([12, 16, 14, 19, 17])));
      const oa = S.add('osc', 528, 96, { freq: 110, wave: 2 });
      const la = S.add('lpg', 864, 96, { decay: 0.2 });
      const sb = S.seq(0, 544, seqParams(null, stagesLine([6, 8, 6, 10, 6, 7, 9])));
      const ob = S.add('osc', 528, 544, { freq: 110, wave: 0 });
      const lb = S.add('lpg', 864, 544, { decay: 0.12 });
      const mx = S.add('mix', 1216, 352);
      const o = S.add('out', 1456, 352);
      const ga = S.frame([sa, oa, la], 'VOICE A', { ratio: -3, tint: 1 });
      const gb = S.frame([sb, ob, lb], 'VOICE B', { ratio: 2, tint: 5 });
      S.frame([ga, gb], 'POLY', { bpm: 120 });
      S.wire(ga, 'clkOut', sa, 'clk');
      S.wire(gb, 'clkOut', sb, 'clk');
      S.wire(sa, 'cv', oa, 'pitch');
      S.wire(sa, 'gate', la, 'ping');
      S.wire(oa, 'out', la, 'in');
      S.wire(sb, 'cv', ob, 'pitch');
      S.wire(sb, 'gate', lb, 'ping');
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
    // a frame ACID with its own clock at 128 BPM; a META-SEQ at ×4 on its CLK: GATE x.x-..x.x.xx-.x. with accents,
    // 16 notes in C minor PLAYED on the hits, four slides; GATE fires the filter and amp SLOPEs, ACC a third SLOPE on
    // the same CUTOFF mod jack; CV → OSC (saw) → FILTER (LP, high res) → LPG in VCA mode → DELAY → OUT
    name: 'acid',
    build(S) {
      const sq = S.seq(
        0,
        96,
        seqParams(
          gridRhythm('x.x-..x.x.xx-.x.', '...........A..A.'),
          stagesLine([0, 0, 12, 3, 7, 0, 10, 5, 0, 12, 3, 3, 7, 10, 0, 15], {
            gen: 0,
            scale: 2,
            slides: [3, 6, 11, 14],
          }),
        ),
      );
      const os = S.add('osc', 0, 480, { freq: 110, wave: 2 });
      const fl = S.add('filter', 336, 480, { cutoff: 260, res: 0.82 });
      const va = S.add('lpg', 576, 480, { level: 0, mode: 0 });
      const dl = S.add('delay', 768, 480, { time: 0.35, feedback: 0.35, mix: 0.2 });
      const o = S.add('out', 1056, 480);
      const ef = S.add('slope', 0, 640, { rise: 0.002, fall: 0.25 });
      const ea = S.add('slope', 336, 640, { rise: 0.002, fall: 0.2 });
      const ec = S.add('slope', 672, 640, { rise: 0.002, fall: 0.12 });
      const g = S.frame([sq, os, fl, va, dl, o, ef, ea, ec], 'ACID', { bpm: 128, tint: 2 });
      S.wire(g, 'clkOut', sq, 'clk');
      S.rat(sq, 'clk', 4);
      S.wire(sq, 'gate', ef, 'trig');
      S.wire(sq, 'gate', ea, 'trig');
      S.wire(sq, 'acc', ec, 'trig');
      S.wire(sq, 'cv', os, 'pitch');
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
  {
    // noisy techno drums, an FM bass and hats at 130 BPM through a short synced delay
    name: 'techno',
    build(S) {
      voicesProject(
        S,
        'TECHNO',
        130,
        [
          ['DRUMS', technoDrums, 1],
          ['FM BASS', fmBass, 2],
          ['CLAP', clap, 1],
        ],
        (S, x) => {
          const dl = S.add('delay', x, 0, { time: 0.375, feedback: 0.3, mix: 0.15, type: 0 });
          return { ids: [dl], inp: [dl, 'in'], out: [dl, 'l'], clocks: [[dl, 'clk']] };
        },
      );
    },
  },
  {
    // chaotic bells over a drone, a long delay and a hall
    name: 'ambient bells',
    build(S) {
      voicesProject(
        S,
        'AMBIENT BELLS',
        66,
        [
          ['BELLS', chaoticBells, 5],
          ['DRONE', drone, 6],
          ['GRAIN CLOUD', grainCloud, 6],
        ],
        (S, x) => {
          const dl = S.add('delay', x, 0, { time: 0.9, feedback: 0.55, mix: 0.3, type: 1, ping: 1 });
          const rv = S.add('reverb', x + 300, 0, { type: 2, size: 0.9, decay: 12, mix: 0.4 });
          S.wire(dl, 'l', rv, 'in');
          return { ids: [dl, rv], inp: [dl, 'in'], out: [rv, 'l'] };
        },
      );
    },
  },
  {
    // kick, snare and a chord stab through a long spring delay and a plate at 75 BPM
    name: 'dub',
    build(S) {
      voicesProject(
        S,
        'DUB',
        75,
        [
          ['KICK', (S, x, y) => kick(S, x, y, 4), 1],
          ['SNARE', snare, 1],
          ['STAB', pluck, 3],
        ],
        (S, x) => {
          const dl = S.add('delay', x, 0, {
            time: 0.6,
            feedback: 0.7,
            mix: 0.4,
            type: 2,
            char: 0.4,
            ping: 1,
          });
          const rv = S.add('reverb', x + 300, 0, { type: 1, decay: 3, mix: 0.25 });
          S.wire(dl, 'l', rv, 'in');
          return { ids: [dl, rv], inp: [dl, 'in'], out: [rv, 'l'], clocks: [[dl, 'clk']] };
        },
      );
    },
  },
  {
    // chance-driven quantised bells and plucks, a grain cloud, hats, a room
    name: 'generative',
    build(S) {
      voicesProject(
        S,
        'GENERATIVE',
        96,
        [
          ['BELLS', chaoticBells, 5],
          ['PLUCK', pluck, 3],
          ['HATS', hats, 1],
          ['GRAIN CLOUD', grainCloud, 6],
        ],
        (S, x) => {
          const rv = S.add('reverb', x, 0, { type: 0, size: 0.6, decay: 2.5, mix: 0.3 });
          return { ids: [rv], inp: [rv, 'in'], out: [rv, 'l'] };
        },
      );
    },
  },
];
