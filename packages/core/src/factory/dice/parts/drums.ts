// The drum parts: each a META-SEQ with a gate line (euclidean or grid) clocked ×4 into a pinged LPG, and the kit that
// builds two to four of them into one DRUMS voice.
import { SCALES } from '../../../generators';
import { seqParams } from '../../../migrate/seq';
import { euclidRhythm, gridRhythm } from '../../build';
import { between, intIn, logBetween, pick, weighted } from '../random';
import type { DiceCtx, DiceVoice, Part, PartId } from '../types';

// option indices
const LPG = { VCA: 0, LP: 1, BOTH: 2 };
const WAVE = { SIN: 0, TRI: 1, SAW: 2, SQR: 3 };
const FILTER = { SVF: 0, LADDER: 1, COMB: 4 };

/** A drum's meta-seq (gate line) and what it needs to be a voice; modules go on rows 200 apart from `c.y`. */
function start(c: DiceCtx, gate: Record<string, number>) {
  const { S } = c;
  const seq = S.seq(c.x, c.y, seqParams(gate, null));
  let row = 0;
  /** x of the n-th column, y of the next row */
  const at = (col: number, sameRow = false): [number, number] => {
    if (!sameRow) row++;
    return [c.x + col * 300, c.y + row * 200];
  };
  return { seq, at };
}

function voice(
  seq: string,
  ids: string[],
  out: [string, string],
  name: string,
  part: PartId,
  level: number,
  extra: Partial<DiceVoice> = {},
  ratio = 4,
): DiceVoice {
  return {
    ids: [seq, ...ids],
    out,
    clocks: [[seq, 'clk', ratio]],
    name,
    role: 'drums',
    part,
    level,
    seq,
    gate: [seq, 'gate'],
    ...extra,
  };
}

/** a pitch envelope: a SLOPE on the gate into an oscillator's @freq (or @index) at `depth` */
function envelope(c: DiceCtx, seq: string, at: [number, number], target: [string, string], fall: number, depth: number) {
  const { S } = c;
  const env = S.add('slope', at[0], at[1], { rise: 0.001, fall });
  S.wire(seq, 'gate', env, 'trig');
  S.wire(env, 'out', target[0], target[1]);
  S.att(target[0], target[1], depth);
  return env;
}

const steady = (c: DiceCtx, lo: number, hi: number) => euclidRhythm(16, intIn(c.R, lo, hi), intIn(c.R, 0, 3));

/** the frequency of a scale degree within lo…hi Hz (a random degree and octave, folded in) */
function degreeFreq(c: DiceCtx, lo: number, hi: number): number {
  const sc = SCALES[c.scale]!;
  for (let k = 0; k < 24; k++) {
    const f = 261.626 * 2 ** ((c.root + pick(c.R, sc) + 12 * intIn(c.R, -2, 1)) / 12);
    if (f >= lo && f <= hi) return f;
  }
  return between(c.R, lo, hi);
}

const kickHits = (c: DiceCtx) => euclidRhythm(16, weighted(c.R, [[4, 5], [3, 2], [5, 2]]), 0);

const kickSine: Part = (c) => {
  const { S, R } = c;
  const { seq, at } = start(c, kickHits(c));
  const os = S.add('osc', ...at(1), { freq: between(R, 45, 62), wave: WAVE.SIN });
  const lp = S.add('lpg', ...at(2, true), { decay: between(R, 0.2, 0.45), mode: LPG.BOTH });
  S.wire(os, 'out', lp, 'in');
  S.wire(seq, 'gate', lp, 'ping');
  const env = envelope(c, seq, at(1), [os, '@freq'], between(R, 0.04, 0.12), between(R, 0.3, 0.6));
  return voice(seq, [os, lp, env], [lp, 'out'], 'KICK', 'kick-sine', 0.9);
};

const kickFm: Part = (c) => {
  const { S, R } = c;
  const { seq, at } = start(c, kickHits(c));
  const cx = S.add('complex', ...at(1), { freq: between(R, 45, 60), ratio: between(R, 1, 2), index: 0.05 });
  const lp = S.add('lpg', ...at(2, true), { decay: between(R, 0.2, 0.4), mode: LPG.BOTH });
  S.wire(cx, 'out', lp, 'in');
  S.wire(seq, 'gate', lp, 'ping');
  const env = envelope(c, seq, at(1), [cx, '@index'], between(R, 0.02, 0.06), between(R, 0.3, 0.6));
  return voice(seq, [cx, lp, env], [lp, 'out'], 'KICK', 'kick-fm', 0.9);
};

const kickNoise: Part = (c) => {
  const { S, R } = c;
  const { seq, at } = start(c, kickHits(c));
  const nz = S.add('noise', ...at(1), { level: 1 });
  const fl = S.add('filter', ...at(2, true), {
    cutoff: between(R, 80, 160),
    res: between(R, 0.6, 0.85),
    model: FILTER.LADDER,
  });
  const lp = S.add('lpg', ...at(3, true), { decay: between(R, 0.08, 0.16), mode: LPG.BOTH });
  S.wire(nz, 'pink', fl, 'in');
  S.wire(fl, 'lp', lp, 'in');
  S.wire(seq, 'gate', lp, 'ping');
  return voice(seq, [nz, fl, lp], [lp, 'out'], 'KICK', 'kick-noise', 0.9);
};

const hatsNoise: Part = (c) => {
  const { S, R } = c;
  const { seq, at } = start(c, euclidRhythm(16, intIn(R, 5, 11), intIn(R, 0, 3)));
  const nz = S.add('noise', ...at(1), { level: 0.6 });
  const lp = S.add('lpg', ...at(2, true), { decay: between(R, 0.03, 0.09), mode: LPG.BOTH });
  S.wire(nz, 'white', lp, 'in');
  S.wire(seq, 'gate', lp, 'ping');
  return voice(seq, [nz, lp], [lp, 'out'], 'HATS', 'hats-noise', 0.5);
};

const hatsMetal: Part = (c) => {
  const { S, R } = c;
  const { seq, at } = start(c, euclidRhythm(16, intIn(R, 7, 12), intIn(R, 0, 3)));
  const os = S.add('osc', ...at(1), { freq: between(R, 300, 800), wave: WAVE.SQR });
  const fo = S.add('fold', ...at(2, true), { fold: between(R, 4, 12), level: 12 });
  const hp = S.add('filter', ...at(3, true), { cutoff: between(R, 6000, 10000), res: 0.6, drive: 0.8, model: FILTER.SVF });
  const lp = S.add('lpg', ...at(4, true), { decay: between(R, 0.05, 0.12), mode: LPG.BOTH });
  S.wire(os, 'out', fo, 'in');
  S.wire(fo, 'out', hp, 'in');
  S.wire(hp, 'hp', lp, 'in');
  S.wire(seq, 'gate', lp, 'ping');
  return voice(seq, [os, fo, hp, lp], [lp, 'out'], 'HATS', 'hats-metal', 0.7);
};

const hatsComb: Part = (c) => {
  const { S, R } = c;
  const { seq, at } = start(c, euclidRhythm(16, intIn(R, 5, 11), intIn(R, 0, 3)));
  const nz = S.add('noise', ...at(1), { level: 0.6 });
  const fl = S.add('filter', ...at(2, true), {
    cutoff: logBetween(R, 2000, 6000),
    res: between(R, 0.7, 0.9),
    model: FILTER.COMB,
  });
  const lp = S.add('lpg', ...at(3, true), { decay: between(R, 0.04, 0.1), mode: LPG.BOTH });
  S.wire(nz, 'white', fl, 'in');
  S.wire(fl, 'lp', lp, 'in');
  S.wire(seq, 'gate', lp, 'ping');
  return voice(seq, [nz, fl, lp], [lp, 'out'], 'HATS', 'hats-comb', 0.45);
};

const snare: Part = (c) => {
  const { S, R } = c;
  // on 2 and 4
  const { seq, at } = start(c, euclidRhythm(16, 2, 4));
  const nz = S.add('noise', ...at(1), { level: 1 });
  const fl = S.add('filter', ...at(2, true), { cutoff: between(R, 900, 2200), res: 0.7, drive: 0.6, model: FILTER.SVF });
  const lp = S.add('lpg', ...at(3, true), { decay: between(R, 0.08, 0.18), mode: LPG.BOTH });
  S.wire(nz, 'pink', fl, 'in');
  S.wire(fl, 'bp', lp, 'in');
  S.wire(seq, 'gate', lp, 'ping');
  return voice(seq, [nz, fl, lp], [lp, 'out'], 'SNARE', 'snare', 0.9);
};

const clap: Part = (c) => {
  const { S, R } = c;
  // three quick hits per clap: the GATE lane runs ×3 and holds a burst, then rests until the next clap
  const fast = R() < 0.5;
  const gate = seqParams(gridRhythm('xxx.............', '................'), null);
  gate['aglen'] = 11 / 15;
  gate['agrate'] = 5;
  const seq = S.seq(c.x, c.y, gate);
  const nz = S.add('noise', c.x + 300, c.y + 200, { level: 0.7 });
  const fl = S.add('filter', c.x + 600, c.y + 200, { cutoff: between(R, 1000, 2000), res: 0.35, model: FILTER.SVF });
  const lp = S.add('lpg', c.x + 900, c.y + 200, { decay: between(R, 0.05, 0.12), mode: LPG.BOTH });
  S.wire(nz, 'white', fl, 'in');
  S.wire(fl, 'bp', lp, 'in');
  S.wire(seq, 'gate', lp, 'ping');
  // ×4 with 12 steps: a clap every beat; ×2: one every two
  return voice(seq, [nz, fl, lp], [lp, 'out'], 'CLAP', 'clap', 0.55, {}, fast ? 4 : 2);
};

const percBongo: Part = (c) => {
  const { S, R } = c;
  const { seq, at } = start(c, steady(c, 3, 7));
  const f = degreeFreq(c, 150, 500);
  const os = chanceTri(R)
    ? S.add('osc', ...at(1), { freq: f, wave: WAVE.TRI })
    : S.add('complex', ...at(1), { freq: f, ratio: pick(R, [1, 1.5, 2]), index: between(R, 0.1, 0.3) });
  const lp = S.add('lpg', ...at(2, true), { decay: between(R, 0.08, 0.25), mode: LPG.LP });
  S.wire(os, 'out', lp, 'in');
  S.wire(seq, 'gate', lp, 'ping');
  return voice(seq, [os, lp], [lp, 'out'], 'BONGO', 'perc-bongo', 0.5, { pitch: [os, 'pitch'] });
};
const chanceTri = (R: () => number) => R() < 0.5;

const percPing: Part = (c) => {
  const { S, R } = c;
  const { seq, at } = start(c, steady(c, 3, 7));
  const fl = S.add('filter', ...at(1), { cutoff: degreeFreq(c, 300, 2400), res: between(R, 0.95, 1), model: FILTER.SVF });
  const lp = S.add('lpg', ...at(2, true), { decay: between(R, 0.15, 0.4), mode: LPG.BOTH });
  S.wire(seq, 'gate', fl, 'in');
  S.wire(fl, 'bp', lp, 'in');
  S.wire(seq, 'gate', lp, 'ping');
  return voice(seq, [fl, lp], [lp, 'out'], 'PING', 'perc-ping', 0.5, { cutoff: [fl, '@cutoff'] });
};

const percTom: Part = (c) => {
  const { S, R } = c;
  const { seq, at } = start(c, steady(c, 3, 6));
  const cx = S.add('complex', ...at(1), { freq: between(R, 80, 200), ratio: pick(R, [1, 1.5, 2]), index: 0.1 });
  const lp = S.add('lpg', ...at(2, true), { decay: between(R, 0.2, 0.45), mode: LPG.BOTH });
  S.wire(cx, 'out', lp, 'in');
  S.wire(seq, 'gate', lp, 'ping');
  const env = envelope(c, seq, at(1), [cx, '@freq'], between(R, 0.08, 0.2), between(R, 0.3, 0.5));
  return voice(seq, [cx, lp, env], [lp, 'out'], 'TOM', 'perc-tom', 0.55);
};

export const DRUM_PARTS: Record<PartId, Part> = {
  'kick-sine': kickSine,
  'kick-fm': kickFm,
  'kick-noise': kickNoise,
  'hats-noise': hatsNoise,
  'hats-metal': hatsMetal,
  'hats-comb': hatsComb,
  snare,
  clap,
  'perc-bongo': percBongo,
  'perc-ping': percPing,
  'perc-tom': percTom,
};

/** a drum part's row of canvas */
const ROW = 560;

/**
 * A drum kit: `count` of the weighted parts (a kick first when the weights have one) built side by side and mixed
 * into one DRUMS voice, whose gate is its kick's. `id` is the kit's registry key.
 */
export const drumKit =
  (weights: [PartId, number][], count: [number, number] = [2, 4], id: PartId = 'drums'): Part =>
  (c) => {
    const { S, R } = c;
    const n = Math.min(4, intIn(R, count[0], count[1]), weights.length);
    const left = [...weights];
    const take = (pool: [PartId, number][]) => {
      const id = weighted(R, pool);
      left.splice(
        left.findIndex(([p]) => p === id),
        1,
      );
      return id;
    };
    const kicks = left.filter(([p]) => p.startsWith('kick'));
    const chosen: PartId[] = kicks.length ? [take(kicks)] : [];
    while (chosen.length < n) chosen.push(take(left));
    const voices = chosen.map((pid, i) => DRUM_PARTS[pid]!({ ...c, y: c.y + i * ROW }));
    const mx = S.add('mix', c.x + 1500, c.y, Object.fromEntries(voices.map((v, i) => ['l' + 'abcd'[i], v.level])));
    voices.forEach((v, i) => S.wire(v.out[0], v.out[1], mx, 'abcd'[i]!));
    const lead = voices.find((v) => v.part.startsWith('kick')) ?? voices[0]!;
    return {
      ids: [...voices.flatMap((v) => v.ids), mx],
      out: [mx, 'out'],
      clocks: voices.flatMap((v) => v.clocks),
      name: 'DRUMS',
      role: 'drums',
      part: id,
      members: chosen,
      level: 0.8,
      ...(lead.seq ? { seq: lead.seq } : {}),
      ...(lead.gate ? { gate: lead.gate } : {}),
    };
  };
