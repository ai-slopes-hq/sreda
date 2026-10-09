// The factory groups (spec §6): each one top frame with everything inside it.
import type { Builder } from './build';
import {
  chaoticBells,
  clap,
  drone,
  fmBass,
  frozenSpace,
  grainCloud,
  hats,
  kick,
  pad,
  pluck,
  reese,
  snare,
  technoDrums,
  type Voice,
} from './voices';

/** A voice as a group: its own frame with its own clock (so it plays when dropped in). */
function voiceGroup(
  name: string,
  frame: string,
  voice: (S: Builder, x: number, y: number) => Voice,
  bpm: number,
  tint: number,
) {
  return {
    name,
    build(S: Builder): [string, string] {
      const v = voice(S, 0, 0);
      const g = S.frame(v.ids, frame, { bpm, tint });
      for (const [id, port, ratio] of v.clocks) {
        S.wire(g, 'clkOut', id, port);
        if (ratio !== 1) S.rat(id, port, ratio);
      }
      return v.out;
    },
  };
}

/** Each group's `build` returns its main output (tests wire it into an OUT). */
export const GROUPS: { name: string; build(b: Builder): [string, string] }[] = [
  {
    // the ACID voice without delay and out, own clock 128 BPM
    name: '303 voice',
    build(S) {
      const rh = S.add('rhythm', 0, 64, { mode: 1 });
      S.grid(rh, 'x.x-..x.x.xx-.x.', '...........A..A.');
      const st = S.add(
        'stages',
        528,
        64,
        S.notes({ scale: 2 }, [0, 0, 12, 3, 7, 0, 10, 5, 0, 12, 3, 3, 7, 10, 0, 15], [3, 6, 11, 14]),
      );
      const os = S.add('osc', 0, 448, { freq: 110, wave: 2 });
      const fl = S.add('filter', 336, 448, { cutoff: 260, res: 0.82 });
      const va = S.add('lpg', 576, 448, { level: 0, mode: 0 });
      const ef = S.add('slope', 0, 608, { rise: 0.002, fall: 0.25 });
      const ea = S.add('slope', 336, 608, { rise: 0.002, fall: 0.2 });
      const ec = S.add('slope', 672, 608, { rise: 0.002, fall: 0.12 });
      const g = S.frame([rh, st, os, fl, va, ef, ea, ec], '303 VOICE', { bpm: 128, tint: 2 });
      S.wire(g, 'clkOut', rh, 'clk');
      S.rat(rh, 'clk', 4);
      S.wire(rh, 'gate', st, 'adv');
      S.wire(rh, 'gate', ef, 'trig');
      S.wire(rh, 'gate', ea, 'trig');
      S.wire(rh, 'acc', ec, 'trig');
      S.wire(st, 'cv', os, 'pitch');
      S.wire(os, 'out', fl, 'in');
      S.wire(fl, 'lp', va, 'in');
      S.wire(ef, 'out', fl, '@cutoff');
      S.att(fl, '@cutoff', 0.35);
      S.wire(ec, 'out', fl, '@cutoff');
      S.wire(ea, 'out', va, '@level');
      return [va, 'out'];
    },
  },
  {
    // COMPLEX → FOLD → LPG pinged by a cycling SLOPE, UNCERTAINTY on the fold
    name: 'complex vco',
    build(S) {
      const cx = S.add('complex', 0, 0, { freq: 110, ratio: 1.5, index: 0.3 });
      const fo = S.add('fold', 384, 0, { fold: 3.4 }); // ×3.4, the old FOLD 0.3
      const lp = S.add('lpg', 624, 0, { decay: 0.6 });
      const sl = S.add('slope', 0, 160, { rise: 0.01, fall: 0.5, cycle: 1 });
      const un = S.add('uncertainty', 336, 160, { rate: 0.3 });
      S.frame([cx, fo, lp, sl, un], 'COMPLEX VCO', { tint: 6 });
      S.wire(cx, 'out', fo, 'in');
      S.wire(fo, 'out', lp, 'in');
      S.wire(sl, 'eoc', lp, 'ping');
      S.wire(un, 'smooth', fo, '@fold');
      S.att(fo, '@fold', 0.4);
      return [lp, 'out'];
    },
  },
  {
    // own clock 120 BPM at ×4 → CHANCE → UNCERTAINTY quantised → QUANT → OSC → LPG
    name: 'bleep-bloop',
    build(S) {
      const ch = S.add('chance', 0, 0, { p: 0.6 });
      const un = S.add('uncertainty', 192, 0, { levels: 8 });
      const q = S.add('quant', 432, 0, { scale: 5 });
      const os = S.add('osc', 0, 160, { freq: 440, wave: 0 });
      const lp = S.add('lpg', 336, 160, { decay: 0.15 });
      const g = S.frame([ch, un, q, os, lp], 'BLEEP-BLOOP', { bpm: 120, tint: 4 });
      S.wire(g, 'clkOut', ch, 'trig');
      S.rat(ch, 'trig', 4);
      S.wire(ch, 'a', un, 'trig');
      S.wire(ch, 'a', lp, 'ping');
      S.wire(un, 'quant', q, 'in');
      S.wire(q, 'out', os, 'pitch');
      S.wire(os, 'out', lp, 'in');
      return [lp, 'out'];
    },
  },
  {
    // two LPGs: the first in VCA mode with a SLOPE on its level, the second pinged; CLK IN fires both
    name: 'vca-lpg',
    build(S) {
      const sl = S.add('slope', 0, 0, { rise: 0.005, fall: 0.3 });
      const va = S.add('lpg', 336, 0, { level: 0, mode: 0 });
      const lp = S.add('lpg', 528, 0, { decay: 0.3 });
      const g = S.frame([sl, va, lp], 'VCA-LPG', { tint: 3 });
      S.wire(g, 'clkOut', sl, 'trig');
      S.wire(g, 'clkOut', lp, 'ping');
      S.wire(sl, 'out', va, '@level');
      S.wire(va, 'out', lp, 'in');
      return [lp, 'out'];
    },
  },
  voiceGroup('kick', 'KICK', kick, 124, 1),
  voiceGroup('snare', 'SNARE', snare, 124, 1),
  voiceGroup('hats', 'HATS', hats, 124, 1),
  voiceGroup('clap', 'CLAP', clap, 124, 1),
  voiceGroup('noisy techno drums', 'TECHNO DRUMS', technoDrums, 132, 1),
  voiceGroup('fm bass', 'FM BASS', fmBass, 124, 2),
  voiceGroup('reese', 'REESE', reese, 124, 2),
  voiceGroup('pluck', 'PLUCK', pluck, 118, 3),
  voiceGroup('chaotic bells', 'CHAOTIC BELLS', chaoticBells, 70, 5),
  voiceGroup('pad', 'PAD', pad, 30, 5),
  voiceGroup('drone', 'DRONE', drone, 60, 6),
  voiceGroup('grain cloud', 'GRAIN CLOUD', grainCloud, 40, 6),
  voiceGroup('frozen space', 'FROZEN SPACE', frozenSpace, 20, 4),
];
