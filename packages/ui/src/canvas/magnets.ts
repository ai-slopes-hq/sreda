// Magnets (spec §4): a dragged box snaps flush to nearby modules' edges, side by side or stacked.
type Rect = { x: number; y: number; w: number; h: number };

export interface Snap {
  dx: number;
  dy: number;
  /** a vertical guide line at x, from y0 to y1 */
  gx: { x: number; y0: number; y1: number } | null;
  /** a horizontal guide line at y, from x0 to x1 */
  gy: { y: number; x0: number; x1: number } | null;
}

/** The nearest snap within `thr` (canvas px) on each axis; only boxes within 48 px of the dragged one count. */
export function magnet(box: Rect, others: Rect[], thr: number): Snap {
  let dx: number | null = null;
  let dy: number | null = null;
  let gx: Snap['gx'] = null;
  let gy: Snap['gy'] = null;
  for (const o of others) {
    const nearY = o.y < box.y + box.h + 48 && o.y + o.h > box.y - 48;
    const nearX = o.x < box.x + box.w + 48 && o.x + o.w > box.x - 48;
    if (nearY)
      for (const [d, x] of [
        [o.x + o.w - box.x, o.x + o.w], // to its right
        [o.x - (box.x + box.w), o.x], // to its left
        [o.x - box.x, o.x], // lefts aligned
        [o.x + o.w - (box.x + box.w), o.x + o.w], // rights aligned
      ] as const)
        if (Math.abs(d) < thr && (dx === null || Math.abs(d) < Math.abs(dx))) {
          dx = d;
          gx = { x, y0: Math.min(o.y, box.y), y1: Math.max(o.y + o.h, box.y + box.h) };
        }
    if (nearX)
      for (const [d, y] of [
        [o.y + o.h - box.y, o.y + o.h], // under it
        [o.y - (box.y + box.h), o.y], // above it
        [o.y - box.y, o.y], // tops aligned
        [o.y + o.h - (box.y + box.h), o.y + o.h], // bottoms aligned
      ] as const)
        if (Math.abs(d) < thr && (dy === null || Math.abs(d) < Math.abs(dy))) {
          dy = d;
          gy = { y, x0: Math.min(o.x, box.x), x1: Math.max(o.x + o.w, box.x + box.w) };
        }
  }
  return { dx: dx ?? 0, dy: dy ?? 0, gx, gy };
}
