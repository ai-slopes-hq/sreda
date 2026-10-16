// The parts DICE was made of before the styles: the rhythmic patch's drums, bass and lead and the ambient patch's drone
// and bells / pad, kept as they were so the two first styles sound as they always did.
import { genNotes, SCALES, type Algo } from '../../../generators';
import { seqParams } from '../../../migrate/seq';
import { euclidRhythm, melodyLine } from '../../build';
import { between, chance, logBetween, pick } from '../random';
import type { DiceCtx, DiceVoice, Part } from '../types';

const ALGOS: Algo[] = ['303', 'MOTIF', 'WALK', 'TURING', 'ARP', 'PHRASE', 'PEDAL'];
// option indices
const LPG = { VCA: 0, LP: 1, BOTH: 2 };
const WAVE = { SIN: 0, TRI: 1, SAW: 2, SQR: 3 };

/** A generated line in STAGES' saved form (for `seqParams`): gen, the style's scale and root, length, 16 notes, a few slides. */
function line(c: DiceCtx, slides: number): Record<string, number> {
  const { R } = c;
  const algo = Math.floor(R() * ALGOS.length);
  const semis = genNotes(ALGOS[algo]!, 16, SCALES[c.scale]!, c.root, R);
  const glide: number[] = [];
  for (let k = 0; k < slides; k++) glide.push(1 + Math.floor(R() * 16));
  return melodyLine(semis, {
    gen: algo,
    scale: c.scale,
    root: c.root,
    length: pick(R, [8, 16, 16]),
    slides: [...new Set(glide)],
  });
}

/** a lane counter: each sequence of a part sits 200 below the one before */
const lanes = (c: DiceCtx) => {
  let y = c.y;
  return { now: () => y, next: () => (y += 200) };
};

export const drumKitLegacy: Part = (c) => {
  const { S, R } = c;
  const L = lanes(c);
  const ids: string[] = [];
  const clocks: [string, string, number][] = [];
  const kr = S.seq(c.x, L.next(), seqParams(euclidRhythm(16, Math.round(between(R, 3, 5))), null));
  const kick = S.add('osc', c.x + 300, L.now(), { freq: between(R, 45, 62), wave: WAVE.SIN });
  const kl = S.add('lpg', c.x + 600, L.now(), { decay: between(R, 0.2, 0.45), mode: LPG.BOTH });
  S.wire(kick, 'out', kl, 'in');
  S.wire(kr, 'gate', kl, 'ping');
  clocks.push([kr, 'clk', 4]);
  ids.push(kr, kick, kl);
  const dm = S.add('mix', c.x + 900, L.now(), { la: 0.9, lb: 0.45, lc: 0.55 });
  ids.push(dm);
  S.wire(kl, 'out', dm, 'a');
  const hits = Math.round(between(R, 5, 11));
  const hr = S.seq(c.x, L.next(), seqParams(euclidRhythm(16, hits, Math.floor(R() * 4)), null));
  const nz = S.add('noise', c.x + 300, L.now(), { level: 0.6 });
  const hl = S.add('lpg', c.x + 600, L.now(), { decay: between(R, 0.03, 0.09), mode: LPG.BOTH });
  S.wire(nz, 'white', hl, 'in');
  S.wire(hr, 'gate', hl, 'ping');
  S.wire(hl, 'out', dm, 'b');
  clocks.push([hr, 'clk', 4]);
  ids.push(hr, nz, hl);
  if (chance(R, 0.5)) {
    // a snare: pink noise through a band-pass, on 2 and 4 (rotated)
    const sr = S.seq(c.x, L.next(), seqParams(euclidRhythm(16, 2, 4), null));
    const sn = S.add('noise', c.x + 300, L.now(), { level: 0.7 });
    const sf = S.add('filter', c.x + 600, L.now(), { cutoff: between(R, 900, 2200), res: 0.3, model: 0 });
    const sl = S.add('lpg', c.x + 900, L.now(), { decay: between(R, 0.08, 0.18), mode: LPG.BOTH });
    S.wire(sn, 'pink', sf, 'in');
    S.wire(sf, 'bp', sl, 'in');
    S.wire(sr, 'gate', sl, 'ping');
    S.wire(sl, 'out', dm, 'c');
    clocks.push([sr, 'clk', 4]);
    ids.push(sr, sn, sf, sl);
  }
  return { ids, out: [dm, 'out'], clocks, name: 'DRUMS', role: 'drums', part: 'drum-kit-legacy', level: 0.7 };
};

/** a pitched, sequenced voice: osc or complex through a filter, an optional shaper, an LPG and a cutoff envelope */
function pitched(c: DiceCtx, bass: boolean): DiceVoice {
  const { S, R } = c;
  const L = lanes(c);
  const hits = Math.round(between(R, bass ? 5 : 3, bass ? 10 : 7));
  const rhythm = euclidRhythm(16, hits, Math.floor(R() * 8));
  const gr = S.seq(c.x, L.next(), seqParams(rhythm, line(c, bass ? 3 : 1)));
  const src = chance(R, 0.75)
    ? S.add('osc', c.x, L.next(), {
        freq: bass ? pick(R, [55, 65.4, 73.4]) : pick(R, [220, 261.6, 293.7]),
        wave: pick(R, [WAVE.SAW, WAVE.SQR]),
      })
    : S.add('complex', c.x, L.next(), {
        freq: bass ? pick(R, [55, 65.4]) : pick(R, [220, 261.6]),
        ratio: pick(R, [1, 2, 3, 0.5]),
        index: between(R, 0.05, 0.3),
      });
  S.wire(gr, 'cv', src, 'pitch');
  const fl = S.add('filter', c.x + 300, L.now(), {
    cutoff: logBetween(R, bass ? 180 : 500, bass ? 700 : 2500),
    res: between(R, 0.35, 0.8),
    model: pick(R, [0, 1, 2, 3]),
  });
  S.wire(src, 'out', fl, 'in');
  const ids: string[] = [];
  let last: [string, string] = [fl, 'lp'];
  if (chance(R, 0.3)) {
    const shaper = chance(R, 0.5)
      ? S.add('drive', c.x + 600, L.now(), { gain: between(R, 6, 18), model: Math.floor(R() * 7), mix: 0.8 })
      : S.add('fold', c.x + 600, L.now(), { fold: between(R, 1.5, 4), model: Math.floor(R() * 4) });
    S.wire(last[0], last[1], shaper, 'in');
    last = [shaper, 'out'];
    ids.push(shaper);
  }
  const amp = S.add('lpg', c.x + 900, L.now(), { decay: between(R, 0.12, bass ? 0.4 : 0.9), mode: LPG.BOTH });
  S.wire(last[0], last[1], amp, 'in');
  S.wire(gr, 'gate', amp, 'ping');
  // the cutoff's envelope
  const env = S.add('slope', c.x, L.next(), { rise: 0.002, fall: between(R, 0.08, 0.5) });
  S.wire(gr, 'gate', env, 'trig');
  S.wire(env, 'out', fl, '@cutoff');
  S.att(fl, '@cutoff', between(R, 0.2, 0.5));
  ids.push(gr, src, fl, amp, env);
  return {
    ids,
    out: [amp, 'out'],
    clocks: [[gr, 'clk', 4]],
    name: bass ? 'BASS' : 'LEAD',
    role: bass ? 'bass' : 'line',
    part: bass ? 'bass-legacy' : 'lead-legacy',
    level: bass ? 0.6 : 0.55,
    seq: gr,
    gate: [gr, 'gate'],
  };
}

export const bassLegacy: Part = (c) => pitched(c, true);
export const leadLegacy: Part = (c) => pitched(c, false);

export const droneLegacy: Part = (c) => {
  const { S, R } = c;
  const L = lanes(c);
  const ids: string[] = [];
  const cx = S.add('complex', c.x, L.next(), {
    freq: logBetween(R, 40, 110),
    ratio: pick(R, [0.5, 1.5, 2, 3]),
    index: between(R, 0.1, 0.4),
    timbre: between(R, 0, 0.5),
  });
  let last: [string, string] = [cx, 'out'];
  if (chance(R, 0.5)) {
    const fo = S.add('fold', c.x + 300, L.now(), { fold: between(R, 1.5, 5), model: pick(R, [0, 1, 3]) });
    S.wire(cx, 'out', fo, 'in');
    last = [fo, 'out'];
    const un = S.add('uncertainty', c.x, L.next(), { rate: logBetween(R, 0.05, 0.4) });
    S.wire(un, 'smooth', fo, '@fold');
    S.att(fo, '@fold', between(R, 0.2, 0.4));
    ids.push(fo, un);
  }
  const fl = S.add('filter', c.x + 600, L.now(), {
    cutoff: logBetween(R, 300, 1400),
    res: between(R, 0.2, 0.6),
    model: pick(R, [0, 1, 3]),
  });
  S.wire(last[0], last[1], fl, 'in');
  const sw = S.add('slope', c.x, L.next(), { rise: between(R, 4, 12), fall: between(R, 6, 15), cycle: 1 });
  S.wire(sw, 'out', fl, '@cutoff');
  S.att(fl, '@cutoff', between(R, 0.25, 0.5));
  ids.push(cx, fl, sw);
  return { ids, out: [fl, 'lp'], clocks: [], name: 'DRONE', role: 'texture', part: 'drone-legacy', level: 0.6 };
};

/** a slow line, bells or a pad, pinged on the clock and now and then by chance */
export const bellsLegacy: Part = (c) => {
  const { S, R } = c;
  const L = lanes(c);
  const st = S.seq(c.x, L.next(), seqParams(null, line(c, 4)));
  const bells = chance(R, 0.5);
  const os = S.add('osc', c.x + 300, L.now(), {
    freq: bells ? pick(R, [440, 523.3, 587.3]) : pick(R, [110, 130.8, 146.8]),
    wave: bells ? WAVE.SIN : WAVE.TRI,
  });
  S.wire(st, 'cv', os, 'pitch');
  const amp = S.add('lpg', c.x + 600, L.now(), {
    decay: between(R, bells ? 0.8 : 1.5, bells ? 2.5 : 4),
    mode: LPG.BOTH,
  });
  S.wire(os, 'out', amp, 'in');
  const ids = [st, os, amp];
  const clocks: [string, string, number][] = [];
  let gate: [string, string] = [st, 'gate'];
  if (chance(R, 0.5)) {
    const ch = S.add('chance', c.x + 900, L.now(), { p: between(R, 0.5, 0.85) });
    clocks.push([ch, 'trig', 1]);
    S.wire(ch, 'a', st, 'clk');
    S.wire(ch, 'a', amp, 'ping');
    ids.push(ch);
    gate = [ch, 'a'];
  } else {
    clocks.push([st, 'clk', 1], [amp, 'ping', 1]);
  }
  return {
    ids,
    out: [amp, 'out'],
    clocks,
    name: bells ? 'BELLS' : 'PAD',
    role: 'line',
    part: 'bells-legacy',
    level: 0.6,
    seq: st,
    gate,
  };
};
