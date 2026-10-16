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

/** a drive into a reverb (used by the later styles) */
export const driveReverb: FxChain = (c, input) => {
  const { S, R } = c;
  const dr = S.add('drive', c.x + 1500, c.y, { gain: between(R, 3, 9), model: Math.floor(R() * 7), mix: 0.6 });
  S.wire(input[0], input[1], dr, 'in');
  const r = reverb('room')(c, [dr, 'out']);
  return { ids: [dr, ...r.ids], l: r.l, clocks: [] };
};
