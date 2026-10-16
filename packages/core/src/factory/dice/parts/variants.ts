// Parts tuned after they are built: a style's own rhythm on a part's META-SEQ (off-beat grids, ÷3 / ×3 lanes, lane
// lengths 5 / 7 / 9 / 16). Each is `tuned(base, id, settings)`: the base part, then `settings` written onto its seq.
import { seqParams } from '../../../migrate/seq';
import { laneParam } from '../../../metaseq';
import { euclidRhythm, gridRhythm } from '../../build';
import { chance, intIn, pick } from '../random';
import type { DiceCtx, DiceVoice, Part, PartId } from '../types';
import { DRUM_PARTS } from './drums';

export const tuned =
  (base: Part, id: PartId, settings: (c: DiceCtx, v: DiceVoice) => Record<string, number>): Part =>
  (c) => {
    const v = base(c);
    if (!v.seq) throw new Error(`${id}: ${v.part} has no seq to tune`);
    c.S.seqSet(v.seq, settings(c, v));
    return { ...v, part: id };
  };

/** a gate pattern on 16 steps, no accents */
const grid = (gates: string) => seqParams(gridRhythm(gates, '.'.repeat(16)), null);

// electro: kicks and snares off the beat
const KICKS = ['x..x..x...x.....', 'x....x..x..x....', 'x..x...x..x..x..', 'x..x..x...x.x...'];
const SNARES = ['....x.......x..x', '....x..x....x...', '....x.....x.x...'];
const kickAny: Part = (c) => pick(c.R, [DRUM_PARTS['kick-sine']!, DRUM_PARTS['kick-fm']!])(c);

// IDM: a ÷3 or ×3 gate lane (RATE option indices: ÷4 ÷3 ÷2 ×1 ×2 ×3 ×4 = 0…6)
const odd = (c: DiceCtx) => (chance(c.R, 0.75) ? { [laneParam(0, 'g', 'rate')]: pick(c.R, [1, 5]) } : {});

// polymeter: a short gate lane (5 / 7 / 9 / 16 steps) with its own hits, so the voices drift against each other
const LENGTHS = [5, 7, 9, 16];
const short = (c: DiceCtx) => {
  const len = pick(c.R, LENGTHS);
  return seqParams(
    euclidRhythm(len, intIn(c.R, 2, Math.max(2, Math.ceil(len / 2))), intIn(c.R, 0, len - 1)),
    null,
  );
};

export const VARIANT_PARTS: Record<PartId, Part> = {
  'kick-broken': tuned(kickAny, 'kick-broken', (c) => grid(pick(c.R, KICKS))),
  'snare-broken': tuned(DRUM_PARTS['snare']!, 'snare-broken', (c) => grid(pick(c.R, SNARES))),
  'idm-bongo': tuned(DRUM_PARTS['perc-bongo']!, 'idm-bongo', odd),
  'idm-tom': tuned(DRUM_PARTS['perc-tom']!, 'idm-tom', odd),
  'idm-ping': tuned(DRUM_PARTS['perc-ping']!, 'idm-ping', odd),
  'idm-hats': tuned(DRUM_PARTS['hats-metal']!, 'idm-hats', odd),
  'poly-bongo': tuned(DRUM_PARTS['perc-bongo']!, 'poly-bongo', short),
  'poly-ping': tuned(DRUM_PARTS['perc-ping']!, 'poly-ping', short),
  'poly-tom': tuned(DRUM_PARTS['perc-tom']!, 'poly-tom', short),
  'poly-hats': tuned(DRUM_PARTS['hats-comb']!, 'poly-hats', short),
};
