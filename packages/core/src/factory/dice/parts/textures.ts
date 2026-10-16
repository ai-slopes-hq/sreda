// The texture parts: drones, washes and clouds that sit under the rest, and the chance-played bells and blips over it.
import { between, chance, logBetween, pick } from '../random';
import type { DiceCtx, DiceVoice, Part } from '../types';
import { C, degreeFreq, FILTER, LPG, WAVE } from './shared';

/** a texture's grid: column `col`, rows 200 apart from `c.y` (a new row unless `same`) */
function rows(c: DiceCtx) {
  let row = -1;
  return (col: number, same = false): [number, number] => {
    if (!same) row++;
    return [c.x + col * 300, c.y + row * 200];
  };
}

const drone: Part = (c) => {
  const { S, R } = c;
  const at = rows(c);
  const cx = S.add('complex', ...at(0), {
    // nothing plays a drone's pitch, so it sits on a degree of the throw's scale
    freq: degreeFreq(c, 40, 110),
    ratio: pick(R, [0.5, 1.5, 2, 3]),
    index: between(R, 0.1, 0.4),
    timbre: between(R, 0, 0.5),
  });
  const ids = [cx];
  let last: [string, string] = [cx, 'out'];
  if (chance(R, 0.5)) {
    const fo = S.add('fold', ...at(1, true), { fold: between(R, 1.5, 5), model: pick(R, [0, 1, 3]) });
    const un = S.add('uncertainty', ...at(1), { rate: logBetween(R, 0.05, 0.4) });
    S.wire(cx, 'out', fo, 'in');
    S.wire(un, 'smooth', fo, '@fold');
    S.att(fo, '@fold', between(R, 0.2, 0.4));
    last = [fo, 'out'];
    ids.push(fo, un);
  }
  const fl = S.add('filter', ...at(2, true), {
    cutoff: logBetween(R, 300, 1400),
    res: between(R, 0.2, 0.6),
    model: pick(R, [FILTER.SVF, FILTER.LADDER, FILTER.SK]),
  });
  const sw = S.add('slope', ...at(2), { rise: between(R, 4, 12), fall: between(R, 6, 15), cycle: 1 });
  S.wire(last[0], last[1], fl, 'in');
  S.wire(sw, 'out', fl, '@cutoff');
  S.att(fl, '@cutoff', between(R, 0.25, 0.5));
  ids.push(fl, sw);
  return { ids, out: [fl, 'lp'], clocks: [], name: 'HUM', role: 'texture', part: 'drone', level: 0.6 };
};

const wash: Part = (c) => {
  const { S, R } = c;
  const at = rows(c);
  const nz = S.add('noise', ...at(0), { level: 0.35 });
  const fl = S.add('filter', ...at(1, true), {
    cutoff: logBetween(R, 400, 1500),
    res: between(R, 0.4, 0.7),
    model: FILTER.SVF,
  });
  const sw = S.add('slope', ...at(1), { rise: between(R, 4, 10), fall: between(R, 5, 12), cycle: 1 });
  S.wire(nz, 'pink', fl, 'in');
  S.wire(sw, 'out', fl, '@cutoff');
  S.att(fl, '@cutoff', between(R, 0.3, 0.5));
  return {
    ids: [nz, fl, sw],
    out: [fl, 'bp'],
    clocks: [],
    name: 'WASH',
    role: 'texture',
    part: 'wash',
    level: 0.45,
  };
};

/** a bell pinged on the clock, shared by the grain cloud */
const grains: Part = (c) => {
  const { S, R } = c;
  const at = rows(c);
  const os = S.add('osc', ...at(0), { freq: degreeFreq(c, 300, 620), wave: WAVE.SIN });
  const lp = S.add('lpg', ...at(1, true), { decay: between(R, 1, 2.5), mode: LPG.BOTH });
  const gr = S.add('grains', ...at(2, true), {
    source: 1,
    pos: between(R, 0.7, 0.95),
    size: between(R, 0.1, 0.4),
    dens: between(R, 8, 30),
    spray: between(R, 0.2, 0.5),
    detune: between(R, 0.1, 0.3),
    spread: 0.9,
  });
  S.wire(os, 'out', lp, 'in');
  S.wire(lp, 'out', gr, 'in');
  return {
    ids: [os, lp, gr],
    out: [gr, 'l'],
    clocks: [[lp, 'ping', 1]],
    name: 'GRAINS',
    role: 'texture',
    part: 'grains',
    level: 0.6,
  };
};

const chaosBells: Part = (c) => {
  const { S, R } = c;
  const at = rows(c);
  const ch = S.add('chance', ...at(0), { p: between(R, 0.35, 0.55) });
  const un = S.add('uncertainty', ...at(1, true), { levels: Math.round(between(R, 6, 10)) });
  const q = S.add('quant', ...at(2, true), { scale: c.scale, root: c.root });
  const a = S.add('osc', ...at(0), { freq: C[5], wave: WAVE.SIN });
  const al = S.add('lpg', ...at(1, true), { decay: between(R, 1.6, 2.8), mode: LPG.BOTH });
  const b = S.add('osc', ...at(0), { freq: C[6], wave: WAVE.TRI });
  const bl = S.add('lpg', ...at(1, true), { decay: between(R, 1, 1.8), mode: LPG.BOTH });
  const mx = S.add('mix', ...at(2, true), { la: 0.6, lb: 0.4 });
  const rv = S.add('reverb', ...at(3, true), {
    type: 1,
    size: between(R, 0.6, 0.9),
    decay: between(R, 5, 10),
    mix: 0.5,
  });
  S.wire(ch, 'a', un, 'trig');
  S.wire(ch, 'a', al, 'ping');
  S.wire(ch, 'b', bl, 'ping');
  S.wire(un, 'quant', q, 'in');
  S.wire(q, 'out', a, 'pitch');
  S.wire(q, 'out', b, 'pitch');
  S.wire(a, 'out', al, 'in');
  S.wire(b, 'out', bl, 'in');
  S.wire(al, 'out', mx, 'a');
  S.wire(bl, 'out', mx, 'b');
  S.wire(mx, 'out', rv, 'in');
  return {
    ids: [ch, un, q, a, al, b, bl, mx, rv],
    out: [rv, 'l'],
    clocks: [[ch, 'trig', 4]],
    name: 'CHAOS BELLS',
    role: 'texture',
    part: 'chaos-bells',
    level: 0.6,
  };
};

const blips: Part = (c) => {
  const { S, R } = c;
  const at = rows(c);
  const ch = S.add('chance', ...at(0), { p: between(R, 0.35, 0.65) });
  const un = S.add('uncertainty', ...at(1, true), { levels: Math.round(between(R, 4, 10)) });
  const q = S.add('quant', ...at(2, true), { scale: c.scale, root: c.root });
  const os = S.add('osc', ...at(0), { freq: C[4], wave: pick(R, [WAVE.SIN, WAVE.TRI]) });
  const lp = S.add('lpg', ...at(1, true), { decay: between(R, 0.05, 0.2), mode: LPG.BOTH });
  S.wire(ch, 'a', un, 'trig');
  S.wire(un, 'stepped', q, 'in');
  S.wire(q, 'out', os, 'pitch');
  S.wire(os, 'out', lp, 'in');
  S.wire(ch, 'a', lp, 'ping');
  const v: DiceVoice = {
    ids: [ch, un, q, os, lp],
    out: [lp, 'out'],
    clocks: [[ch, 'trig', 4]],
    name: 'BLIPS',
    role: 'texture',
    part: 'blips',
    level: 0.5,
  };
  return v;
};

export const TEXTURE_PARTS = { drone, wash, grains, 'chaos-bells': chaosBells, blips };
