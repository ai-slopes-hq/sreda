// What the bass, line and texture parts share: a generated line in META-SEQ's form, the row grid and the voice shell.
import { genNotes, SCALES, type Algo } from '../../../generators';
import { seqParams } from '../../../migrate/seq';
import { euclidRhythm, melodyLine } from '../../build';
import { pick } from '../random';
import type { DiceCtx, DiceVoice, PartId, Role } from '../types';

/** GEN's options, in order */
export const ALGOS: Algo[] = ['303', 'MOTIF', 'WALK', 'TURING', 'ARP', 'PHRASE', 'PEDAL'];

// option indices
export const LPG = { VCA: 0, LP: 1, BOTH: 2 };
export const WAVE = { SIN: 0, TRI: 1, SAW: 2, SQR: 3 };
export const FILTER = { SVF: 0, LADDER: 1, DIODE: 2, SK: 3, COMB: 4 };

/** A generated line in STAGES' saved form (for `seqParams`): `algos` picks the generator (any by default), the style's
 * scale and root, length, 16 notes, `slides` steps tied. */
export function line(c: DiceCtx, slides: number, algos: readonly Algo[] = ALGOS): Record<string, number> {
  const { R } = c;
  const algo = ALGOS.indexOf(pick(R, algos));
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

/** a pitched part's META-SEQ: a line over a gate (euclidean unless `gate` is given) */
export function pitchedSeq(
  c: DiceCtx,
  o: {
    hits?: [number, number];
    rot?: number;
    slides: number;
    algos?: readonly Algo[];
    gate?: Record<string, number>;
  },
): string {
  const { R } = c;
  const [lo, hi] = o.hits ?? [4, 4];
  const rhythm =
    o.gate ?? euclidRhythm(16, lo + Math.floor(R() * (hi - lo + 1)), o.rot ?? Math.floor(R() * 8));
  return c.S.seq(c.x, c.y, seqParams(rhythm, line(c, o.slides, o.algos)));
}

/** a part's grid: column `col`, rows 200 apart under the META-SEQ at `c.y` (a new row unless `same`) */
export function grid(c: DiceCtx) {
  let row = 0;
  return (col: number, same = false): [number, number] => {
    if (!same) row++;
    return [c.x + col * 300, c.y + row * 200];
  };
}

/** a cutoff / index envelope: a SLOPE on the gate into `target` at `depth` */
export function gateEnv(
  c: DiceCtx,
  seq: string,
  at: [number, number],
  target: [string, string],
  fall: number,
  depth: number,
): string {
  const env = c.S.add('slope', at[0], at[1], { rise: 0.002, fall });
  c.S.wire(seq, 'gate', env, 'trig');
  c.S.wire(env, 'out', target[0], target[1]);
  c.S.att(target[0], target[1], depth);
  return env;
}

/** the voice of a sequenced part: gate and seq always; with an `osc` (an oscillator module) its pitch, out and FM
 * ports; a part with no audio-rate oscillator passes null and sets `pitch` (or nothing) in `extra` */
export function pitchedVoice(
  seq: string,
  ids: string[],
  out: [string, string],
  name: string,
  role: Role,
  part: PartId,
  level: number,
  osc: string | null,
  extra: Partial<DiceVoice> = {},
  ratio = 4,
): DiceVoice {
  return {
    ids: [seq, ...ids],
    out,
    clocks: [[seq, 'clk', ratio]],
    name,
    role,
    part,
    level,
    seq,
    gate: [seq, 'gate'],
    ...(osc ? { pitch: [osc, 'pitch'], osc: [osc, 'out'], fm: [osc, 'fm'] } : {}),
    ...extra,
  };
}
