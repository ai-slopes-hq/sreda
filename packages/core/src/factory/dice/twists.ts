// The twists (spec §6, revision 36): sound design over any style. Each runs on the finished voices before `assemble`,
// wires what it adds (and moves a voice's out or clock where it must) and returns null when the voices lack what it
// needs, so no twist leaves a dangling module or an empty input.
import { laneParam } from '../../metaseq';
import { between, intIn, logBetween, pick } from './random';
import type { DiceCtx, DiceVoice, Twist, TwistId } from './types';

/** a random element of `xs`, or undefined when there is none */
const some = <T>(c: DiceCtx, xs: T[]): T | undefined => (xs.length ? pick(c.R, xs) : undefined);
const nothing = (): { ids: string[]; clocks: [string, string, number][] } => ({ ids: [], clocks: [] });

/** an oscillator's output into another pitched voice's FM input */
const fm: Twist = (c, voices) => {
  const src = some(
    c,
    voices.filter((v) => v.osc && voices.some((w) => w !== v && w.fm)),
  );
  if (!src?.osc) return null;
  const dst = some(
    c,
    voices.filter((v) => v !== src && v.fm),
  );
  if (!dst?.fm) return null;
  const { S, R } = c;
  if (S.typeOf(dst.fm[0]) === 'complex') {
    S.wire(src.osc[0], src.osc[1], dst.fm[0], '@index');
  } else {
    S.set(dst.fm[0], { fmi: between(R, 0.1, 0.4) });
    S.wire(src.osc[0], src.osc[1], dst.fm[0], dst.fm[1]);
  }
  return nothing();
};

/** white noise sampled on a voice's gate, into another voice's pitch (a little) or cutoff (more) */
const snh: Twist = (c, voices) => {
  const src = some(
    c,
    voices.filter((v) => v.gate),
  );
  if (!src?.gate) return null;
  const dst = some(
    c,
    voices.filter((v) => v !== src && (v.pitch || v.cutoff)),
  );
  if (!dst) return null;
  const { S, R } = c;
  const nz = S.add('noise', c.x, c.y, {});
  const sh = S.add('snh', c.x + 300, c.y, {});
  S.wire(nz, 'white', sh, 'in');
  S.wire(src.gate[0], src.gate[1], sh, 'trig');
  const ids = [nz, sh];
  if (dst.cutoff && (!dst.pitch || R() < 0.5)) {
    S.wire(sh, 'out', dst.cutoff[0], dst.cutoff[1]);
    S.att(dst.cutoff[0], dst.cutoff[1], between(R, 0.2, 0.4));
  } else if (dst.pitch) {
    // the pitch input keeps its own melody; the sampled noise joins it through an attenuverter
    const at = S.add('att', c.x + 600, c.y, { a1: between(R, 0.05, 0.15) });
    S.wire(sh, 'out', at, 'in1');
    S.wire(at, 'out1', dst.pitch[0], dst.pitch[1]);
    ids.push(at);
  }
  return { ids, clocks: [] };
};

/** a SPREAD sends one voice's gate alternately to two other voices, which lose their own gate cables */
const switchTwist: Twist = (c, voices) => {
  const gated = voices.filter((v) => v.gate);
  if (gated.length < 3) return null;
  const src = pick(c.R, gated);
  const rest = gated.filter((v) => v !== src);
  const a = pick(c.R, rest);
  const b = pick(
    c.R,
    rest.filter((v) => v !== a),
  );
  const { S, R } = c;
  const sp = S.add('spread', c.x, c.y, { len: intIn(R, 2, 4), mode: pick(R, [0, 1]) });
  S.wire(src.gate![0], src.gate![1], sp, 'in');
  S.wire(src.gate![0], src.gate![1], sp, 'adv');
  S.retarget(a.gate!, [sp, 'out1']);
  S.retarget(b.gate!, [sp, 'out2']);
  return { ids: [sp], clocks: [] };
};

/** a DIGI echo on a voice with a band-pass in its loop and the feedback turned up */
const feedback: Twist = (c, voices) => {
  const v = some(c, voices);
  if (!v) return null;
  const { S, R } = c;
  const dl = S.add('delay', c.x, c.y, {
    time: Math.min(2, (pick(R, [0.5, 0.75, 1]) * 60) / c.bpm),
    feedback: between(R, 0.7, 0.85),
    mix: between(R, 0.3, 0.5),
    type: 0,
  });
  const fl = S.add('filter', c.x + 300, c.y, {
    cutoff: logBetween(R, 500, 2500),
    res: between(R, 0.2, 0.5),
    model: 0,
  });
  const at = S.add('att', c.x + 600, c.y, { a1: 0.2 });
  S.wire(v.out[0], v.out[1], dl, 'in');
  S.wire(dl, 'l', fl, 'in');
  S.wire(fl, 'bp', at, 'in1');
  S.wire(at, 'out1', dl, 'in');
  v.ids.push(dl, fl, at);
  v.out = [dl, 'l'];
  return nothing();
};

/** GRAINS on LIVE fed by a pitched voice, a texture of its own back into the mix */
const grains: Twist = (c, voices) => {
  const src = some(
    c,
    voices.filter((v) => v.osc || v.pitch),
  );
  if (!src || voices.length >= 7) return null;
  const { S, R } = c;
  const gr = S.add('grains', c.x, c.y, {
    source: 1,
    pos: between(R, 0.6, 0.95),
    size: between(R, 0.1, 0.4),
    dens: between(R, 8, 30),
    spray: between(R, 0.2, 0.5),
    detune: between(R, 0.1, 0.3),
    spread: 0.9,
  });
  S.wire(src.out[0], src.out[1], gr, 'in');
  const extraVoice: DiceVoice = {
    ids: [gr],
    out: [gr, 'l'],
    clocks: [],
    name: 'GRAINS',
    role: 'texture',
    part: 'twist-grains',
    level: 0.4,
  };
  return { ...nothing(), extraVoice };
};

/** 1–3 voices' GATE or NOTE lanes get a length of their own: the pattern drifts against the others */
const polymeter: Twist = (c, voices) => {
  const seqd = voices.filter((v) => v.seq);
  if (!seqd.length) return null;
  const { S, R } = c;
  const chosen = [...seqd].sort(() => R() - 0.5).slice(0, intIn(R, 1, Math.min(3, seqd.length)));
  for (const v of chosen) {
    const lane = pick(R, ['g', 'n'] as const);
    S.seqSet(v.seq!, { [laneParam(0, lane, 'len')]: (pick(R, [5, 7, 9, 11, 13]) - 1) / 15 });
  }
  return nothing();
};

/** a DRIVE or FOLD right after a voice */
const shaper: Twist = (c, voices) => {
  const v = some(c, voices);
  if (!v) return null;
  const { S, R } = c;
  const sh =
    R() < 0.5
      ? S.add('drive', c.x, c.y, { gain: between(R, 6, 14), model: pick(R, [0, 1, 2, 3]), mix: between(R, 0.5, 1) })
      : S.add('fold', c.x, c.y, { fold: between(R, 1.5, 5), level: -3, model: pick(R, [0, 1, 2]) });
  S.wire(v.out[0], v.out[1], sh, 'in');
  v.ids.push(sh);
  v.out = [sh, 'out'];
  return nothing();
};

/** a CHANCE between a voice's clock and its seq thins the steps */
const chanceTwist: Twist = (c, voices) => {
  const v = some(
    c,
    voices.filter((w) => w.seq && w.clocks.some(([id, port]) => id === w.seq && port === 'clk')),
  );
  if (!v) return null;
  const { S, R } = c;
  const ch = S.add('chance', c.x, c.y, { p: between(R, 0.4, 0.75) });
  S.wire(ch, 'a', v.seq!, 'clk');
  v.clocks = v.clocks.map(([id, port, r]) => (id === v.seq && port === 'clk' ? [ch, 'trig', r] : [id, port, r]));
  v.ids.push(ch);
  return nothing();
};

export const TWISTS: Record<TwistId, Twist> = {
  fm,
  snh,
  switch: switchTwist,
  feedback,
  grains,
  polymeter,
  shaper,
  chance: chanceTwist,
};
