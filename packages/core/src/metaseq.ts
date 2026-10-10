// META-SEQ's hidden params (spec §7b): the id scheme, and reading / writing a lane as plain step values.
// The document stores knobs as positions 0…1 and options as indices; these helpers speak the param units.

export const PATTERNS = 8;
export const LANES = ['n', 'g', 't', 'a', 'v', 'c'] as const;
export type Lane = (typeof LANES)[number];

const NOTE_MAX = 24;
const LEN_MAX = 16;

/** `{pattern letter}{lane}{step}`, the step 1-based: `ag1`, `hc16`. */
export function stepId(p: number, l: Lane, k: number): string {
  return 'abcdefgh'[p]! + l + k;
}

const laneId = (p: number, l: Lane, what: string): string => 'abcdefgh'[p]! + l + what;

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
  const raw = params[laneId(p, l, 'len')];
  return raw === undefined ? LEN_MAX : 1 + Math.round(Math.min(1, Math.max(0, raw)) * (LEN_MAX - 1));
}

/** The RATE option index: ÷4 ÷3 ÷2 ×1 ×2 ×3 ×4 (3 = ×1). */
export function laneRate(params: Record<string, number>, p: number, l: Lane): number {
  return params[laneId(p, l, 'rate')] ?? 3;
}

export function laneLocked(params: Record<string, number>, p: number, l: Lane): boolean {
  return (params[laneId(p, l, 'lock')] ?? 0) === 1;
}

/** NOTE's mode: 0 PLAYED, 1 STEP. */
export function noteMode(params: Record<string, number>, p: number): 0 | 1 {
  return (params['abcdefgh'[p]! + 'nmode'] ?? 0) === 1 ? 1 : 0;
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
