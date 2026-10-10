// The drawer's step grid (spec §7b): one window of clock steps, each lane's cells in clock time. A lane shorter than
// the window repeats as ghosts to its end; only the first cycle is edited.

/** clock steps per lane step, by RATE index (÷4 ÷3 ÷2 ×1 ×2 ×3 ×4) */
const FACTOR = [4, 3, 2, 1, 1 / 2, 1 / 3, 1 / 4];

export interface Cell {
  x: number;
  w: number;
  /** the lane step (0-based) this cell shows */
  step: number;
  /** past the first LEN: a repeat, not edited */
  ghost: boolean;
}

/** A lane's cells across `width` px showing `steps` clock steps; the last one is clipped to the window. */
export function cells(len: number, rate: number, steps: number, width: number): Cell[] {
  if (!(width > 0) || len < 1) return [];
  const w = (width / steps) * (FACTOR[rate] ?? 1);
  const n = Math.ceil(width / w - 1e-9);
  const out: Cell[] = [];
  for (let i = 0; i < n; i++) {
    const x = i * w;
    out.push({ x, w: Math.min(w, width - x), step: i % len, ghost: i >= len });
  }
  return out;
}

/** The width of one lane step in px. */
export function stepWidth(rate: number, steps: number, width: number): number {
  return (width / steps) * (FACTOR[rate] ?? 1);
}

/** The index of the cell under `x` px, or −1. */
export function cellAt(cs: Cell[], x: number): number {
  for (let i = 0; i < cs.length; i++) {
    const c = cs[i]!;
    if (x >= c.x && x < c.x + c.w) return i;
  }
  return -1;
}

/** A NOTE's bar: 10 % high, its top at (1 − v / 24) · 85 % + 5 %. */
export function noteBar(v: number): { y: number; h: number } {
  return { y: (1 - Math.min(24, Math.max(0, v)) / 24) * 0.85 + 0.05, h: 0.1 };
}

/** The semitone (0…24, unsnapped) whose bar is centred at `fy` (0 top … 1 bottom of the lane). */
export function noteAt(fy: number): number {
  return Math.min(24, Math.max(0, Math.round(24 * (1 - (fy - 0.1) / 0.85))));
}

/** A VEL / CHNC bar's value at `fy`: 1 at the top, 0 at the bottom. */
export function barAt(fy: number): number {
  return Math.min(1, Math.max(0, 1 - fy));
}
