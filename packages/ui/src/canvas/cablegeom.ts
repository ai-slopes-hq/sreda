// Cable geometry (spec §4 hover / insert): curves, stubs and hit testing. Each cable's geometry is memoised on its end
// positions, so a move recomputes only the cables it touches.
import { jackAt, type Cable, type Doc, type Role, type Specs } from '@sreda/core';
import { bez } from './glyphs';

type Pt = { x: number; y: number };

export interface CableGeom {
  key: string;
  cable: Cable;
  pts: Pt[];
  d: string;
  from: Role;
  to: Role;
}

/** how many geometries were computed (not taken from the memo), for tests */
export const geomStats = { computed: 0 };

/** The role of one end of a cable; a frame's CLK jacks are triggers. */
export function roleAt(doc: Doc, specs: Specs, id: string, port: string, dir: 'in' | 'out'): Role | null {
  if (doc.groups.some((g) => g.id === id)) return 'trigger';
  const m = doc.modules.find((x) => x.id === id);
  const spec = m && specs[m.type];
  if (!spec) return null;
  if (dir === 'out') return spec.outputs.find((p) => p.id === port)?.role ?? null;
  return port.startsWith('@') ? 'mod' : (spec.inputs.find((p) => p.id === port)?.role ?? null);
}

/** 25 points along the drawn curve (the same control points as `bez`). */
export function bezPts(a: Pt, b: Pt): Pt[] {
  const dx = Math.max(40, Math.abs(b.x - a.x) * 0.5);
  const c1 = { x: a.x + dx, y: a.y };
  const c2 = { x: b.x - dx, y: b.y };
  const pts: Pt[] = [];
  for (let i = 0; i <= 24; i++) {
    const t = i / 24;
    const u = 1 - t;
    pts.push({
      x: u * u * u * a.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * b.x,
      y: u * u * u * a.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * b.y,
    });
  }
  return pts;
}

const memo = new Map<string, CableGeom>();

export function cableGeoms(doc: Doc, specs: Specs): CableGeom[] {
  const used = new Set<string>();
  const out: CableGeom[] = [];
  for (const c of doc.cables) {
    const from = roleAt(doc, specs, c.from[0], c.from[1], 'out');
    const to = roleAt(doc, specs, c.to[0], c.to[1], 'in');
    if (!from || !to) continue;
    const a = jackAt(doc, specs, c.from[0], c.from[1]);
    const b = jackAt(doc, specs, c.to[0], c.to[1]);
    const key = `${c.from.join('.')}|${c.to.join('.')}|${a.x},${a.y}|${b.x},${b.y}`;
    used.add(key);
    let geom = memo.get(key);
    if (!geom || geom.from !== from || geom.to !== to) {
      geomStats.computed++;
      geom = { key, cable: c, pts: bezPts(a, b), d: bez(a, b), from, to };
      memo.set(key, geom);
    }
    out.push(geom.cable === c ? geom : { ...geom, cable: c });
  }
  // forget what is no longer drawn (the memo holds only the current cables)
  if (memo.size > used.size * 2 + 64) for (const k of memo.keys()) if (!used.has(k)) memo.delete(k);
  return out;
}

function segDist(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const l = dx * dx + dy * dy;
  const t = l ? Math.min(1, Math.max(0, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l)) : 0;
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
}

/** The cable nearest to `p` within `thr` (canvas px), or null. */
export function cableAt(geoms: CableGeom[], p: Pt, thr: number): number | null {
  let best: number | null = null;
  let bd = thr + 1e-9;
  geoms.forEach((g, i) => {
    for (let k = 0; k < g.pts.length - 1; k++) {
      const d = segDist(p, g.pts[k]!, g.pts[k + 1]!);
      if (d <= bd) {
        bd = d;
        best = i;
      }
    }
  });
  return best;
}

/** how long a stub is, along the cable's own path (canvas px) */
export const STUB_LEN = 14;

/** The first `len` px of a polyline (the last point is interpolated). */
function head(pts: Pt[], len: number): Pt[] {
  const out: Pt[] = [pts[0]!];
  let left = len;
  for (let k = 1; k < pts.length; k++) {
    const a = pts[k - 1]!;
    const b = pts[k]!;
    const l = Math.hypot(b.x - a.x, b.y - a.y);
    if (l >= left) {
      const t = l ? left / l : 0;
      out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
      return out;
    }
    out.push(b);
    left -= l;
  }
  return out;
}

/** The two stubs as point lists, each starting at its jack: the output end `a`, the input end `b`. */
export function stubPts(g: CableGeom): { a: Pt[]; b: Pt[] } {
  return { a: head(g.pts, STUB_LEN), b: head([...g.pts].reverse(), STUB_LEN) };
}

const path = (pts: Pt[]) => pts.map((p, i) => `${i ? 'L' : 'M'}${p.x} ${p.y}`).join(' ');

/** The first and last 14 px of the cable's own path, as two SVG paths (each from its jack inwards). */
export function stubs(g: CableGeom): { a: string; b: string } {
  const s = stubPts(g);
  return { a: path(s.a), b: path(s.b) };
}

/** The cable whose stub is nearest to `p` within `thr` (canvas px), or null. */
export function stubAt(geoms: CableGeom[], p: Pt, thr: number): number | null {
  let best: number | null = null;
  let bd = thr + 1e-9;
  geoms.forEach((g, i) => {
    const s = stubPts(g);
    for (const pts of [s.a, s.b])
      for (let k = 0; k < pts.length - 1; k++) {
        const d = segDist(p, pts[k]!, pts[k + 1]!);
        if (d <= bd) {
          bd = d;
          best = i;
        }
      }
  });
  return best;
}
