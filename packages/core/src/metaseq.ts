// META-SEQ's hidden params (spec §7b): the id scheme, and reading / writing a lane as plain step values.
// The document stores knobs as positions 0…1 and options as indices; these helpers speak the param units.
import { euclid, genNotes, SCALES, type Algo } from './generators';

export const PATTERNS = 8;
export const LANES = ['n', 'g', 't', 'a', 'v', 'c'] as const;
export type Lane = (typeof LANES)[number];

const NOTE_MAX = 24;
const LEN_MAX = 16;

/** `{pattern letter}{lane}{step}`, the step 1-based: `ag1`, `hc16`. */
export function stepId(p: number, l: Lane, k: number): string {
  return 'abcdefgh'[p]! + l + k;
}

/** A lane setting's param id: `{pattern letter}{lane}{len | rate | lock}`, e.g. `anlen`, `hcrate`. */
export function laneParam(p: number, l: Lane, what: 'len' | 'rate' | 'lock'): string {
  return 'abcdefgh'[p]! + l + what;
}

function stepDefault(p: number, l: Lane, k: number): number {
  if (l === 'n') return 12;
  if (l === 'g') return p === 0 && k % 4 === 1 ? 1 : 0;
  if (l === 'v' || l === 'c') return 1;
  return 0;
}

/** The 16 steps of a lane in param units: NOTE semitones 0…24, GATE / TIE / ACC 0 or 1, VEL / CHNC 0…1. */
export function laneSteps(params: Record<string, number>, p: number, l: Lane): number[] {
  return Array.from({ length: 16 }, (_, i) => {
    const raw = params[stepId(p, l, i + 1)];
    if (raw === undefined) return stepDefault(p, l, i + 1);
    return l === 'n' ? Math.round(raw * NOTE_MAX) : raw;
  });
}

/** The document changes that write a lane's 16 steps (param units in, knob positions / indices out). */
export function writeLane(p: number, l: Lane, values: number[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (let k = 1; k <= 16; k++) {
    const v = values[k - 1] ?? stepDefault(p, l, k);
    out[stepId(p, l, k)] = l === 'n' ? Math.min(1, Math.max(0, v / NOTE_MAX)) : v;
  }
  return out;
}

export function laneLen(params: Record<string, number>, p: number, l: Lane): number {
  const raw = params[laneParam(p, l, 'len')];
  return raw === undefined ? LEN_MAX : 1 + Math.round(Math.min(1, Math.max(0, raw)) * (LEN_MAX - 1));
}

/** The RATE option index: ÷4 ÷3 ÷2 ×1 ×2 ×3 ×4 (3 = ×1). */
export function laneRate(params: Record<string, number>, p: number, l: Lane): number {
  return params[laneParam(p, l, 'rate')] ?? 3;
}

export function laneLocked(params: Record<string, number>, p: number, l: Lane): boolean {
  return (params[laneParam(p, l, 'lock')] ?? 0) === 1;
}

/** NOTE's STEP / PLAYED param id: `{pattern letter}nmode`. */
export function noteModeParam(p: number): string {
  return 'abcdefgh'[p]! + 'nmode';
}

/** NOTE's mode: 0 PLAYED, 1 STEP. */
export function noteMode(params: Record<string, number>, p: number): 0 | 1 {
  return (params[noteModeParam(p)] ?? 0) === 1 ? 1 : 0;
}

/** The nearest pitch to `semi` in scale `scale` (an index into SCALES) from `root`, all in semitones; the lower one
 * on a tie. The engine's `snap` (engine/src/modules/metaseq.rs), ported exactly. */
export function snap(semi: number, scale: number, root: number): number {
  const degrees = SCALES[Math.min(Math.max(0, scale), SCALES.length - 1)]!;
  const octave = Math.floor((semi - root) / 12);
  let best = semi;
  let bestDist = Infinity;
  for (let o = octave - 1; o <= octave + 1; o++) {
    for (const d of degrees) {
      const c = root + 12 * o + d;
      const dist = Math.abs(c - semi);
      if (dist < bestDist || (dist === bestDist && c < best)) {
        best = c;
        bestDist = dist;
      }
    }
  }
  return best;
}

/** `snap`, kept within the NOTE lane's 0…24: past an end, the nearest scale pitch inside it. */
export function snapInRange(semi: number, scale: number, root: number): number {
  const s = snap(semi, scale, root);
  if (s >= 0 && s <= NOTE_MAX) return s;
  const inScale = (k: number) => snap(k, scale, root) === k;
  if (s < 0) {
    for (let k = 0; k <= NOTE_MAX; k++) if (inScale(k)) return k;
  } else {
    for (let k = NOTE_MAX; k >= 0; k--) if (inScale(k)) return k;
  }
  return Math.min(NOTE_MAX, Math.max(0, s));
}

/** The META-SEQ trace at `at`: playing pattern, six lane cursors (−1 before the first step), mutation generation, and the
 * playing pattern's live steps lane-major. */
export function seqTrace(
  trace: Float32Array,
  at: number,
): { pattern: number; cursors: number[]; gen: number; live: number[][] } {
  return {
    pattern: trace[at] ?? 0,
    cursors: Array.from({ length: 6 }, (_, l) => trace[at + 1 + l] ?? -1),
    gen: trace[at + 7] ?? 0,
    live: Array.from({ length: 6 }, (_, l) =>
      Array.from({ length: 16 }, (_, k) => trace[at + 8 + l * 16 + k] ?? 0),
    ),
  };
}

/** A pattern as a clip, keyed by lane rather than by pattern letter: `{lane}{step}`, `{lane}len`, `{lane}rate`,
 * `{lane}lock` and `nmode`, in the document's units. Values absent from `params` take the spec defaults, so copying a
 * default pattern and pasting it over a drawn one resets it. */
export function copyPattern(params: Record<string, number>, from: number): Record<string, number> {
  const clip: Record<string, number> = {};
  for (const l of LANES) {
    const steps = writeLane(from, l, laneSteps(params, from, l));
    for (let k = 1; k <= 16; k++) clip[l + k] = steps[stepId(from, l, k)]!;
    clip[l + 'len'] = params[laneParam(from, l, 'len')] ?? 1;
    clip[l + 'rate'] = laneRate(params, from, l);
    clip[l + 'lock'] = laneLocked(params, from, l) ? 1 : 0;
  }
  clip['nmode'] = noteMode(params, from);
  return clip;
}

/** The document changes that write a clip into pattern `to`. */
export function pastePattern(clip: Record<string, number>, to: number): Record<string, number> {
  const out: Record<string, number> = {};
  for (const l of LANES) {
    for (let k = 1; k <= 16; k++) out[stepId(to, l, k)] = clip[l + k]!;
    for (const w of ['len', 'rate', 'lock'] as const) out[laneParam(to, l, w)] = clip[l + w]!;
  }
  out[noteModeParam(to)] = clip['nmode']!;
  return out;
}

/** DICE (spec §7b): the document changes that write pattern `pattern`'s unlocked lanes, or only lane `only` (locked or
 * not: ⚄ is explicit), in GEN style `algo`. `scale` is an index into SCALES, `root` semitones 0…11 (callers convert the
 * ROOT knob). LEN and RATE stay; only the first LEN steps of a lane are written. Every lane is generated (so the draws,
 * and the result, do not depend on the locks); TIE, ACC and VEL follow the GATE that will sound: the new one when GATE is
 * written, the drawn one when it is not. */
export function diceLanes(
  params: Record<string, number>,
  pattern: number,
  algo: Algo,
  scale: number,
  root: number,
  R: () => number,
  only?: Lane,
): Record<string, number> {
  const p = pattern;
  const len = (l: Lane) => laneLen(params, p, l);
  const writes = (l: Lane) => (only === undefined ? !laneLocked(params, p, l) : only === l);
  /** the lane's current steps with its first LEN replaced by `fresh` */
  const merged = (l: Lane, fresh: number[]) =>
    laneSteps(params, p, l).map((x, k) => (k < len(l) ? fresh[k]! : x));

  const notes = genNotes(algo === 'EUCLID' ? 'PEDAL' : algo, len('n'), SCALES[scale] ?? SCALES[2]!, root, R);

  // GATE: euclid-spread hits at a random rotation; DENS → 4…16 hits per 16 steps (scaled to the lane's LEN)
  const gl = len('g');
  let hits: number;
  if (algo === 'EUCLID') hits = 3 + Math.floor(R() * (gl - 3));
  else {
    const dens = Math.min(1, Math.max(0, params['dens'] ?? 0.5));
    hits = Math.round(((4 + 12 * dens) * gl) / 16);
  }
  // a short lane (LEN 1–2) still gets a hit
  hits = Math.min(gl, Math.max(1, hits));
  const act = euclid(gl, hits, Math.floor(R() * gl)).map((x) => (x ? 1 : 0));
  const gate = writes('g') ? merged('g', act) : laneSteps(params, p, 'g');

  // TIE: long notes (a rest after a hit holds it, odds as RHYTHM's DICE), slides of 303 / MOTIF (20 % of hits after a hit)
  const idx = Math.max(0, Math.min(15, Math.round((hits * 16) / Math.max(1, gl))));
  const t1 = 5 + (idx / 15) * 45;
  const t2 = 10 + Math.pow(idx / 15, 1.2) * 30;
  const slides = algo === '303' || algo === 'MOTIF';
  const tie: number[] = [];
  for (let k = 0; k < 16; k++) {
    const after = k > 0 && gate[k - 1] === 1;
    const long = (R() * 100 < t1 ? 1 : 0) + (R() * 100 < t2 ? 1 : 0) === 2;
    const slide = R() < 0.2;
    tie.push(algo !== 'EUCLID' && after && (gate[k] === 1 ? slides && slide : long) ? 1 : 0);
  }
  const acc: number[] = [];
  const vel: number[] = [];
  for (let k = 0; k < 16; k++) {
    const a = R() < 0.3;
    const v = 0.6 + 0.4 * R();
    acc.push(gate[k] === 1 && a ? 1 : 0);
    vel.push(gate[k] === 1 ? v : 1);
  }

  const fresh: Record<Lane, number[]> = { n: notes, g: act, t: tie, a: acc, v: vel, c: Array(16).fill(1) };
  const out: Record<string, number> = {};
  for (const l of LANES) {
    if (!writes(l)) continue;
    const w = writeLane(p, l, merged(l, fresh[l]));
    for (let k = 1; k <= len(l); k++) out[stepId(p, l, k)] = w[stepId(p, l, k)]!;
  }
  return out;
}
