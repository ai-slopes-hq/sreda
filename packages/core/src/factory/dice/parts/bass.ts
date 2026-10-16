// The bass parts: each a META-SEQ line over a euclidean gate (clocked ×4) into a low voice.
import { gridRhythm } from '../../build';
import { between, chance, intIn, logBetween, pick } from '../random';
import type { Part } from '../types';
import { C, FILTER, gateEnv, grid, LPG, pitchedSeq, pitchedVoice, WAVE } from './shared';

const bassPulse: Part = (c) => {
  const { S, R } = c;
  const seq = pitchedSeq(c, { hits: [5, 10], slides: intIn(R, 1, 3) });
  const at = grid(c);
  const os = S.add('osc', ...at(1), { freq: C[2], wave: pick(R, [WAVE.SAW, WAVE.SQR]) });
  const fl = S.add('filter', ...at(2, true), {
    cutoff: logBetween(R, 180, 700),
    res: between(R, 0.35, 0.8),
    model: pick(R, [FILTER.SVF, FILTER.LADDER, FILTER.SK]),
  });
  const lp = S.add('lpg', ...at(3, true), { decay: between(R, 0.12, 0.4), mode: LPG.BOTH });
  S.wire(seq, 'cv', os, 'pitch');
  S.wire(os, 'out', fl, 'in');
  S.wire(fl, 'lp', lp, 'in');
  S.wire(seq, 'gate', lp, 'ping');
  const env = gateEnv(c, seq, at(2), [fl, '@cutoff'], between(R, 0.08, 0.5), between(R, 0.2, 0.5));
  return pitchedVoice(seq, [os, fl, lp, env], [lp, 'out'], 'BASS', 'bass', 'bass-pulse', 0.6, os, {
    cutoff: [fl, '@cutoff'],
  });
};

const bassReese: Part = (c) => {
  const { S, R } = c;
  const seq = pitchedSeq(c, { hits: [4, 8], slides: intIn(R, 1, 3) });
  const at = grid(c);
  const a = S.add('osc', ...at(1), { freq: C[2], wave: WAVE.SAW });
  const b = S.add('osc', ...at(1), { freq: C[2], wave: WAVE.SAW });
  // the second oscillator is detuned 0.5–1.2 % by a constant on its pitch input, so its FREQ stays on the C
  const dt = S.add('att', ...at(1), { a1: 0, o1: between(R, 0.0072, 0.0173) });
  const mx = S.add('mix', ...at(2, true), { la: 0.3, lb: 0.3 });
  const fl = S.add('filter', ...at(3, true), {
    cutoff: logBetween(R, 300, 600),
    res: between(R, 0.2, 0.5),
    model: FILTER.LADDER,
  });
  const sw = S.add('slope', ...at(3), { rise: between(R, 2, 5), fall: between(R, 3, 6), cycle: 1 });
  S.wire(seq, 'cv', a, 'pitch');
  S.wire(seq, 'cv', b, 'pitch');
  S.wire(dt, 'out1', b, 'pitch');
  S.wire(a, 'out', mx, 'a');
  S.wire(b, 'out', mx, 'b');
  S.wire(mx, 'out', fl, 'in');
  S.wire(sw, 'out', fl, '@cutoff');
  S.att(fl, '@cutoff', between(R, 0.2, 0.4));
  return pitchedVoice(seq, [a, b, dt, mx, fl, sw], [fl, 'lp'], 'BASS', 'bass', 'bass-reese', 0.5, a, {
    cutoff: [fl, '@cutoff'],
  });
};

const bassFm: Part = (c) => {
  const { S, R } = c;
  const seq = pitchedSeq(c, { hits: [5, 9], slides: intIn(R, 1, 3) });
  const at = grid(c);
  const cx = S.add('complex', ...at(1), {
    freq: C[2],
    ratio: pick(R, [1, 1.5, 2, 3]),
    index: between(R, 0.1, 0.2),
  });
  const lp = S.add('lpg', ...at(2, true), { decay: between(R, 0.2, 0.4), mode: LPG.BOTH });
  S.wire(seq, 'cv', cx, 'pitch');
  S.wire(cx, 'out', lp, 'in');
  S.wire(seq, 'gate', lp, 'ping');
  const env = gateEnv(c, seq, at(1), [cx, '@index'], between(R, 0.1, 0.3), between(R, 0.3, 0.5));
  return pitchedVoice(seq, [cx, lp, env], [lp, 'out'], 'BASS', 'bass', 'bass-fm', 0.6, cx);
};

const bassSub: Part = (c) => {
  const { S, R } = c;
  const seq = pitchedSeq(c, { hits: [3, 7], slides: intIn(R, 0, 2) });
  const at = grid(c);
  const os = S.add('osc', ...at(1), { freq: C[2], wave: WAVE.SIN });
  const lp = S.add('lpg', ...at(2, true), { level: 0, mode: LPG.VCA });
  const env = S.add('slope', ...at(1), { rise: 0.005, fall: between(R, 0.2, 0.5) });
  S.wire(seq, 'cv', os, 'pitch');
  S.wire(os, 'out', lp, 'in');
  S.wire(seq, 'gate', env, 'trig');
  S.wire(env, 'out', lp, '@level');
  return pitchedVoice(seq, [os, lp, env], [lp, 'out'], 'SUB', 'bass', 'bass-sub', 0.7, os);
};

const bassAcid: Part = (c) => {
  const { S, R } = c;
  // a 303's gate line: steady steps, a few of them accented
  const steps = Array.from({ length: 16 }, (_, k) => k);
  const on = new Set(steps.filter(() => R() < 0.6));
  on.add(0);
  const gates = steps.map((k) => (on.has(k) ? 'x' : '.')).join('');
  const accents = steps.map((k) => (on.has(k) && R() < 0.3 ? 'A' : '.')).join('');
  const seq = pitchedSeq(c, { slides: intIn(R, 3, 6), algos: ['303'], gate: gridRhythm(gates, accents) });
  const at = grid(c);
  const os = S.add('osc', ...at(1), { freq: C[2], wave: WAVE.SAW });
  const fl = S.add('filter', ...at(2, true), {
    cutoff: logBetween(R, 200, 500),
    res: between(R, 0.7, 0.9),
    model: pick(R, [FILTER.DIODE, FILTER.LADDER]),
  });
  const lp = S.add('lpg', ...at(4, true), { decay: between(R, 0.15, 0.35), mode: LPG.BOTH });
  S.wire(seq, 'cv', os, 'pitch');
  S.wire(os, 'out', fl, 'in');
  const ids = [os, fl, lp];
  let last: [string, string] = [fl, 'lp'];
  if (chance(R, 0.6)) {
    const dr = S.add('drive', ...at(3, true), {
      gain: between(R, 6, 18),
      model: pick(R, [0, 2, 3]),
      mix: 0.7,
    });
    S.wire(fl, 'lp', dr, 'in');
    last = [dr, 'out'];
    ids.push(dr);
  }
  S.wire(last[0], last[1], lp, 'in');
  S.wire(seq, 'gate', lp, 'ping');
  S.wire(seq, 'acc', lp, '@level');
  S.att(lp, '@level', 0.3);
  ids.push(gateEnv(c, seq, at(2), [fl, '@cutoff'], between(R, 0.1, 0.25), between(R, 0.4, 0.7)));
  return pitchedVoice(seq, ids, [lp, 'out'], 'ACID', 'bass', 'bass-acid', 0.55, os, {
    cutoff: [fl, '@cutoff'],
  });
};

export const BASS_PARTS = {
  'bass-pulse': bassPulse,
  'bass-reese': bassReese,
  'bass-fm': bassFm,
  'bass-sub': bassSub,
  'bass-acid': bassAcid,
};
