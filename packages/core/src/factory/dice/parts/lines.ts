// The line parts: a melody over a gate, each its own instrument.
import { between, intIn, logBetween, pick } from '../random';
import type { Part } from '../types';
import { FILTER, grid, LPG, pitchedSeq, pitchedVoice, WAVE } from './shared';

const pluck: Part = (c) => {
  const { S, R } = c;
  const seq = pitchedSeq(c, { hits: [3, 7], slides: 1 });
  const at = grid(c);
  const os = S.add('osc', ...at(1), { freq: pick(R, [220, 261.6, 293.7]), wave: WAVE.SAW });
  const lp = S.add('lpg', ...at(2, true), { decay: between(R, 0.15, 0.35), mode: LPG.LP });
  S.wire(seq, 'cv', os, 'pitch');
  S.wire(os, 'out', lp, 'in');
  S.wire(seq, 'gate', lp, 'ping');
  return pitchedVoice(seq, [os, lp], [lp, 'out'], 'PLUCK', 'line', 'pluck', 0.55, os);
};

const arp: Part = (c) => {
  const { S, R } = c;
  const seq = pitchedSeq(c, { hits: [8, 12], slides: 0, algos: ['ARP', 'MOTIF'] });
  const at = grid(c);
  const os = S.add('osc', ...at(1), {
    freq: pick(R, [110, 130.8, 164.8, 220]),
    wave: pick(R, [WAVE.SAW, WAVE.SQR]),
  });
  const fl = S.add('filter', ...at(2, true), {
    cutoff: logBetween(R, 500, 1500),
    res: between(R, 0.2, 0.5),
    model: FILTER.SVF,
  });
  const lp = S.add('lpg', ...at(3, true), { decay: between(R, 0.12, 0.3), mode: LPG.BOTH });
  const sw = S.add('slope', ...at(2), { rise: between(R, 4, 10), fall: between(R, 4, 10), cycle: 1 });
  S.wire(seq, 'cv', os, 'pitch');
  S.wire(os, 'out', fl, 'in');
  S.wire(fl, 'lp', lp, 'in');
  S.wire(seq, 'gate', lp, 'ping');
  S.wire(sw, 'out', fl, '@cutoff');
  S.att(fl, '@cutoff', between(R, 0.3, 0.5));
  return pitchedVoice(seq, [os, fl, lp, sw], [lp, 'out'], 'ARP', 'line', 'arp', 0.5, os, {
    cutoff: [fl, '@cutoff'],
  });
};

/** bells: a sine, a COMPLEX at an inharmonic ratio, or a COMB filter pinged by the gate */
const bells: Part = (c) => {
  const { S, R } = c;
  const seq = pitchedSeq(c, { hits: [3, 6], slides: 2 });
  const at = grid(c);
  const kind = pick(R, ['sin', 'complex', 'comb'] as const);
  const lp = S.add('lpg', ...at(3, true), { decay: between(R, 0.8, 2.5), mode: LPG.BOTH });
  S.wire(seq, 'gate', lp, 'ping');
  if (kind === 'comb') {
    // the ping is the tone: the gate rings a comb tuned by the line
    const fl = S.add('filter', ...at(1), {
      cutoff: pick(R, [440, 523.3, 587.3]),
      res: between(R, 0.93, 0.98),
      model: FILTER.COMB,
    });
    S.wire(seq, 'cv', fl, 'pitch');
    S.wire(seq, 'gate', fl, 'in');
    S.wire(fl, 'lp', lp, 'in');
    return pitchedVoice(
      seq,
      [fl, lp],
      [lp, 'out'],
      'BELLS',
      'line',
      'bells',
      0.6,
      fl,
      { cutoff: [fl, '@cutoff'] },
      2,
    );
  }
  const f = pick(R, [440, 523.3, 587.3]);
  const os =
    kind === 'sin'
      ? S.add('osc', ...at(1), { freq: f, wave: WAVE.SIN })
      : S.add('complex', ...at(1), { freq: f, ratio: between(R, 2.5, 3.5), index: between(R, 0.2, 0.4) });
  S.wire(seq, 'cv', os, 'pitch');
  S.wire(os, 'out', lp, 'in');
  return pitchedVoice(seq, [os, lp], [lp, 'out'], 'BELLS', 'line', 'bells', 0.6, os, {}, 2);
};

const stab: Part = (c) => {
  const { S, R } = c;
  // one to three chords a bar
  const seq = pitchedSeq(c, { hits: [1, 3], slides: 0 });
  const at = grid(c);
  const os = S.add('osc', ...at(1), { freq: pick(R, [220, 261.6, 293.7]), wave: WAVE.SAW });
  const fl = S.add('filter', ...at(2, true), {
    cutoff: logBetween(R, 800, 2000),
    res: between(R, 0.3, 0.55),
    model: FILTER.SVF,
  });
  const lp = S.add('lpg', ...at(3, true), { decay: between(R, 0.08, 0.2), mode: LPG.BOTH });
  S.wire(seq, 'cv', os, 'pitch');
  S.wire(os, 'out', fl, 'in');
  S.wire(fl, 'bp', lp, 'in');
  S.wire(seq, 'gate', lp, 'ping');
  return pitchedVoice(seq, [os, fl, lp], [lp, 'out'], 'STAB', 'line', 'stab', 0.55, os, {
    cutoff: [fl, '@cutoff'],
  });
};

const pad: Part = (c) => {
  const { S, R } = c;
  const seq = pitchedSeq(c, { hits: [2, 4], slides: 2 });
  const at = grid(c);
  const os = S.add('osc', ...at(1), { freq: pick(R, [110, 130.8, 146.8]), wave: WAVE.TRI });
  const lp = S.add('lpg', ...at(2, true), { level: 0, mode: LPG.VCA });
  const env = S.add('slope', ...at(1), { rise: between(R, 1, 3), fall: between(R, 2, 5) });
  S.wire(seq, 'cv', os, 'pitch');
  S.wire(os, 'out', lp, 'in');
  S.wire(seq, 'gate', env, 'trig');
  S.wire(env, 'out', lp, '@level');
  return pitchedVoice(seq, [os, lp, env], [lp, 'out'], 'PAD', 'line', 'pad', 0.55, os, {}, 2);
};

const westcoast: Part = (c) => {
  const { S, R } = c;
  const seq = pitchedSeq(c, { hits: [4, 8], slides: intIn(R, 1, 2) });
  const at = grid(c);
  const cx = S.add('complex', ...at(1), {
    freq: pick(R, [110, 130.8, 164.8, 220]),
    ratio: pick(R, [1, 1.5, 2, 3]),
    index: between(R, 0.15, 0.4),
  });
  const fo = S.add('fold', ...at(2, true), { fold: between(R, 2, 8), model: pick(R, [0, 1, 3]) });
  const lp = S.add('lpg', ...at(3, true), { decay: between(R, 0.2, 0.5), mode: LPG.BOTH });
  const un = S.add('uncertainty', ...at(2), { rate: logBetween(R, 0.3, 3) });
  S.wire(seq, 'cv', cx, 'pitch');
  S.wire(cx, 'out', fo, 'in');
  S.wire(fo, 'out', lp, 'in');
  S.wire(seq, 'gate', lp, 'ping');
  S.wire(un, 'smooth', fo, '@fold');
  S.att(fo, '@fold', between(R, 0.2, 0.4));
  return pitchedVoice(seq, [cx, fo, lp, un], [lp, 'out'], 'WEST', 'line', 'westcoast', 0.55, cx);
};

export const LINE_PARTS = { pluck, arp, bells, stab, pad, westcoast };
