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
