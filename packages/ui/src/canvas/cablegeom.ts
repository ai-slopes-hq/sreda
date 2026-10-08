// Cable geometry (spec §5 WIRE FIX, §4 hover / insert): curves, orthogonal routes through a WIRE FIX frame's
// channels, and hit testing. Each cable's geometry is memoised on its end positions, so a move recomputes only the
// cables it touches.
import { jackAt, rectOf, type Cable, type Doc, type Role, type Specs } from '@sreda/core';
import { bez } from './glyphs';

type Pt = { x: number; y: number };

export interface CableGeom {
  key: string;
  cable: Cable;
  pts: Pt[];
  d: string;
  from: Role;
  to: Role;
  /** the WIRE FIX frame that routes it */
  routed: string | null;
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

/** A polyline with rounded corners (radius `r`, smaller where the segments are short). */
export function roundPath(pts: Pt[], r: number): string {
  let d = `M${pts[0]!.x} ${pts[0]!.y}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const [p0, p, p1] = [pts[i - 1]!, pts[i]!, pts[i + 1]!];
    const l0 = Math.hypot(p.x - p0.x, p.y - p0.y);
    const l1 = Math.hypot(p1.x - p.x, p1.y - p.y);
    const rr = Math.min(r, l0 / 2, l1 / 2);
    if (rr < 0.5) {
      d += ` L${p.x} ${p.y}`;
      continue;
    }
    const a = { x: p.x + ((p0.x - p.x) / l0) * rr, y: p.y + ((p0.y - p.y) / l0) * rr };
    const b = { x: p.x + ((p1.x - p.x) / l1) * rr, y: p.y + ((p1.y - p.y) / l1) * rr };
    d += ` L${a.x.toFixed(1)} ${a.y.toFixed(1)} Q${p.x} ${p.y} ${b.x.toFixed(1)} ${b.y.toFixed(1)}`;
  }
  const e = pts[pts.length - 1]!;
  return `${d} L${e.x} ${e.y}`;
}

/**
 * A cable between two direct children of a WIRE FIX frame (spec §5): to the next module to the right in the same row
 * straight through the gap (one step at mid-gap); otherwise out into the channel on the source's right, up into the
 * channel above its row, along the trunk (the frame's left channel) to the channel above the target's row, and down
 * the channel on the target's left into the jack (a knob's mod jack: straight down from the channel above).
 */
/** Is there a module of the frame in the same row between a cable's two ends? (Then it cannot go straight across.) */
function between(doc: Doc, specs: Specs, c: Cable, gid: string): boolean {
  const ra = rectOf(doc, specs, c.from[0]);
  const rb = rectOf(doc, specs, c.to[0]);
  return doc.modules.some(
    (m) =>
      m.parent === gid &&
      m.id !== c.from[0] &&
      m.id !== c.to[0] &&
      m.y === ra.y &&
      m.x >= ra.x + ra.w &&
      m.x < rb.x,
  );
}

function routePts(doc: Doc, specs: Specs, c: Cable, lane: number, gx: number, blocked: boolean): Pt[] {
  const a = jackAt(doc, specs, c.from[0], c.from[1]);
  const b = jackAt(doc, specs, c.to[0], c.to[1]);
  const ra = rectOf(doc, specs, c.from[0]);
  const rb = rectOf(doc, specs, c.to[0]);
  const x1 = ra.x + ra.w + lane;
  const ya = ra.y - lane;
  const yb = rb.y - lane;
  const mod = c.to[1].startsWith('@');
  const xEnd = mod ? b.x : rb.x - lane;
  if (!mod && ra.y === rb.y && rb.x >= ra.x + ra.w && !blocked) {
    if (a.y === b.y) return [a, b];
    const xm = (ra.x + ra.w + rb.x) / 2;
    return [a, { x: xm, y: a.y }, { x: xm, y: b.y }, b];
  }
  const pts = [a, { x: x1, y: a.y }, { x: x1, y: ya }];
  if (ra.y !== rb.y) {
    const xt = gx + lane;
    pts.push({ x: xt, y: ya }, { x: xt, y: yb });
  }
  pts.push({ x: xEnd, y: yb });
  if (!mod) pts.push({ x: xEnd, y: b.y });
  pts.push(b);
  return pts;
}

const memo = new Map<string, CableGeom>();

export function cableGeoms(doc: Doc, specs: Specs): CableGeom[] {
  // WIRE FIX frames and their direct child modules (a routed cable runs between two of them)
  const routes = doc.groups
    .filter((g) => g.layout === 'route')
    .map((g) => ({ g, set: new Set(doc.modules.filter((m) => m.parent === g.id).map((m) => m.id)) }));
  const lanes = new Map<string, number>();
  const used = new Set<string>();
  const out: CableGeom[] = [];
  for (const c of doc.cables) {
    const from = roleAt(doc, specs, c.from[0], c.from[1], 'out');
    const to = roleAt(doc, specs, c.to[0], c.to[1], 'in');
    if (!from || !to) continue;
    const route = routes.find((r) => r.set.has(c.from[0]) && r.set.has(c.to[0]));
    let lane = 0;
    if (route) {
      const n = (lanes.get(route.g.id) ?? 0) + 1;
      lanes.set(route.g.id, n);
      lane = 6 + ((n - 1) % 6) * 4;
    }
    const a = jackAt(doc, specs, c.from[0], c.from[1]);
    const b = jackAt(doc, specs, c.to[0], c.to[1]);
    // a route depends on where its two ends sit (their jacks), its lane, the frame's trunk and the row between them
    const blocked = route ? between(doc, specs, c, route.g.id) : false;
    const key = route
      ? `${c.from.join('.')}|${c.to.join('.')}|${a.x},${a.y}|${b.x},${b.y}|${route.g.id}@${route.g.x}|${lane}|${blocked}`
      : `${c.from.join('.')}|${c.to.join('.')}|${a.x},${a.y}|${b.x},${b.y}`;
    used.add(key);
    let geom = memo.get(key);
    if (!geom || geom.from !== from || geom.to !== to) {
      geomStats.computed++;
      const pts = route ? routePts(doc, specs, c, lane, route.g.x, blocked) : bezPts(a, b);
      geom = {
        key,
        cable: c,
        pts,
        d: route ? roundPath(pts, 6) : bez(a, b),
        from,
        to,
        routed: route?.g.id ?? null,
      };
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
