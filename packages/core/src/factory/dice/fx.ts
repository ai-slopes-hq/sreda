// Effect chains: what sits between the MIX and OUT. Each takes the mix's output and says what reaches OUT.
import { between, chance, pick } from './random';
import type { FxChain } from './types';

export const none: FxChain = (_c, input) => ({ ids: [], l: input, clocks: [] });

export const delay: FxChain = (c, input) => {
  const { S, R } = c;
  const dl = S.add('delay', c.x + 1500, c.y, {
    time: pick(R, [0.25, 0.375, 0.5]),
    feedback: between(R, 0.25, 0.5),
    mix: between(R, 0.15, 0.3),
    type: Math.floor(R() * 3),
    ping: chance(R, 0.5) ? 1 : 0,
  });
  S.wire(input[0], input[1], dl, 'in');
  return { ids: [dl], l: [dl, 'l'], clocks: [[dl, 'clk', 1]] };
};

export const reverb =
  (type: 'room' | 'wash'): FxChain =>
  (c, input) => {
    const { S, R } = c;
    const rv =
      type === 'room'
        ? S.add('reverb', c.x + 1800, c.y, {
            type: pick(R, [0, 1]),
            decay: between(R, 0.8, 2.5),
            mix: between(R, 0.12, 0.25),
          })
        : S.add('reverb', c.x + 1800, c.y, {
            type: pick(R, [1, 2]),
            size: between(R, 0.6, 0.9),
            decay: between(R, 4, 12),
            mix: between(R, 0.35, 0.55),
          });
    S.wire(input[0], input[1], rv, 'in');
    return type === 'wash'
      ? { ids: [rv], l: [rv, 'l'], r: [rv, 'r'], clocks: [] }
      : { ids: [rv], l: [rv, 'l'], clocks: [] };
  };

/**
 * A delay into a reverb. 'tight': each only sometimes (60 % / 40 %), clocked, mono out — the rhythmic styles.
 * 'wash': both always, a long feedback and a wide reverb, stereo out — the ambient ones.
 */
export const delayReverb =
  (mode: 'tight' | 'wash'): FxChain =>
  (c, input) => {
    const { S, R } = c;
    if (mode === 'tight') {
      const ids: string[] = [];
      const clocks: [string, string, number][] = [];
      let last = input;
      if (chance(R, 0.6)) {
        const d = delay(c, last);
        ids.push(...d.ids);
        clocks.push(...d.clocks);
        last = d.l;
      }
      if (chance(R, 0.4)) {
        const r = reverb('room')(c, last);
        ids.push(...r.ids);
        last = r.l;
      }
      return { ids, l: last, clocks };
    }
    const dl = S.add('delay', c.x + 1500, c.y, {
      time: between(R, 0.4, 1.2),
      feedback: between(R, 0.5, 0.75),
      mix: between(R, 0.3, 0.45),
      type: Math.floor(R() * 3),
      ping: 1,
    });
    S.wire(input[0], input[1], dl, 'in');
    const r = reverb('wash')(c, [dl, 'l']);
    return { ids: [dl, ...r.ids], l: r.l, ...(r.r ? { r: r.r } : {}), clocks: [] };
  };

/** a reverb of a kind: a room is mono and small, a plate and a hall are stereo */
export const reverbKind =
  (kind: 'room' | 'plate' | 'hall'): FxChain =>
  (c, input) => {
    if (kind === 'room') return reverb('room')(c, input);
    const { S, R } = c;
    const rv = S.add('reverb', c.x + 1800, c.y, {
      type: kind === 'plate' ? 1 : 2,
      size: between(R, 0.5, 0.85),
      decay: kind === 'plate' ? between(R, 1.5, 4) : between(R, 4, 10),
      mix: between(R, 0.25, 0.45),
    });
    S.wire(input[0], input[1], rv, 'in');
    return { ids: [rv], l: [rv, 'l'], r: [rv, 'r'], clocks: [] };
  };

/** An echo: a DELAY whose time is a pick of `beats` at the throw's tempo, then `then` (if any). `type` options: DIGI 0,
 * TAPE 1, SPRING 2. */
export const echo =
  (o: {
    beats: number[];
    feedback: [number, number];
    mix: [number, number];
    types: number[];
    ping?: 0 | 1;
    then?: FxChain;
  }): FxChain =>
  (c, input) => {
    const { S, R } = c;
    const dl = S.add('delay', c.x + 1500, c.y, {
      time: Math.min(2, (pick(R, o.beats) * 60) / c.bpm),
      feedback: between(R, ...o.feedback),
      mix: between(R, ...o.mix),
      type: pick(R, o.types),
      ping: o.ping ?? 0,
    });
    S.wire(input[0], input[1], dl, 'in');
    if (!o.then) return { ids: [dl], l: [dl, 'l'], clocks: [] };
    const next = o.then(c, [dl, 'l']);
    return { ids: [dl, ...next.ids], l: next.l, ...(next.r ? { r: next.r } : {}), clocks: next.clocks };
  };

// the styles' chains (spec §6)
/** dub: a long TAPE / SPRING echo, feedback high, into a plate */
export const dubEcho = echo({
  beats: [0.75, 1, 1.5],
  feedback: [0.6, 0.8],
  mix: [0.3, 0.45],
  types: [1, 2],
  then: reverbKind('plate'),
});
/** electro: a DIGI echo */
export const digiEcho = echo({ beats: [0.5, 0.75], feedback: [0.25, 0.45], mix: [0.15, 0.3], types: [0] });
/** acid: an echo (DIGI or TAPE) */
export const acidEcho = echo({ beats: [0.5, 0.75], feedback: [0.3, 0.5], mix: [0.15, 0.3], types: [0, 1] });
/** IDM: a short DIGI echo into a room */
export const glitchEcho = echo({
  beats: [0.25, 0.5, 0.75],
  feedback: [0.3, 0.5],
  mix: [0.2, 0.35],
  types: [0],
  then: reverbKind('room'),
});
/** Berlin school: a 3/16 echo (three sixteenths) into a hall */
export const berlinEcho = echo({
  beats: [0.75],
  feedback: [0.4, 0.6],
  mix: [0.25, 0.4],
  types: [0, 1],
  ping: 1,
  then: reverbKind('hall'),
});
/** drone: a long echo into a hall */
export const droneEcho = echo({
  beats: [3, 4, 6],
  feedback: [0.5, 0.75],
  mix: [0.3, 0.5],
  types: [0, 1, 2],
  ping: 1,
  then: reverbKind('hall'),
});

/** a drive to the edge into a room (industrial): DIST, FUZZ or RECT at a gain of 18–30 */
export const driveReverb: FxChain = (c, input) => {
  const { S, R } = c;
  const dr = S.add('drive', c.x + 1500, c.y, {
    gain: between(R, 18, 30),
    model: pick(R, [3, 4, 5]),
    mix: 0.6,
  });
  S.wire(input[0], input[1], dr, 'in');
  const r = reverb('room')(c, [dr, 'out']);
  return { ids: [dr, ...r.ids], l: r.l, clocks: [] };
};
