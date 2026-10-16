// The old rhythmic patch's drum kit, kept as it was so techno sounds as it always did.
import { seqParams } from '../../../migrate/seq';
import { euclidRhythm } from '../../build';
import { between, chance } from '../random';
import type { DiceCtx, Part } from '../types';

// option indices
const LPG = { VCA: 0, LP: 1, BOTH: 2 };
const WAVE = { SIN: 0 };

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
