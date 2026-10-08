// Frames (spec §5): geometry, membership by containment, and the edits that make, unmake and resize them.
// Pure functions from a document to a new one, like ops.ts.
import type { Doc, Group } from './doc';
import { layoutPanel } from './panel';
import type { Specs } from './spec';

export const GHEAD = 28,
  GPAD = 16,
  RGAP = 32,
  TINTS = 7;
export const FRAME_MIN = { w: 352, h: 96 };

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface Pt {
  x: number;
  y: number;
}

export const isGroupId = (id: string): boolean => /^g\d+$/.test(id);

/** A frame's jacks, frame-relative: CLK IN on the header's left end, CLK OUT inside under the header. */
const FRAME_JACKS: Record<string, Pt> = { clkIn: { x: 0, y: GHEAD / 2 }, clkOut: { x: 12, y: GHEAD + 8 } };

export function rectOf(doc: Doc, specs: Specs, id: string): Rect {
  const g = doc.groups.find((x) => x.id === id);
  if (g) return { x: g.x, y: g.y, w: g.w, h: g.h };
  const m = doc.modules.find((x) => x.id === id);
  if (!m) throw new Error(`no object ${id}`);
  const L = layoutPanel(specs[m.type]!);
  return { x: m.x, y: m.y, w: L.w, h: L.h };
}

/** A jack's position on the canvas, for a module's port or a frame's `clkIn` / `clkOut`. */
export function jackAt(doc: Doc, specs: Specs, id: string, port: string): Pt {
  const g = doc.groups.find((x) => x.id === id);
  if (g) {
    const j = FRAME_JACKS[port]!;
    return { x: g.x + j.x, y: g.y + j.y };
  }
  const m = doc.modules.find((x) => x.id === id)!;
  const j = layoutPanel(specs[m.type]!).jacks[port]!;
  return { x: m.x + j.x, y: m.y + j.y };
}

const parentOf = (doc: Doc, id: string): string | null =>
  doc.groups.find((g) => g.id === id)?.parent ?? doc.modules.find((m) => m.id === id)?.parent ?? null;

/** Everything inside a frame, at any depth (modules and frames). */
export function descendants(doc: Doc, gid: string): string[] {
  const out: string[] = [];
  const frontier = [gid];
  const seen = new Set(frontier);
  while (frontier.length) {
    const p = frontier.pop()!;
    for (const g of doc.groups)
      if (g.parent === p && !seen.has(g.id)) {
        seen.add(g.id);
        out.push(g.id);
        frontier.push(g.id);
      }
    for (const m of doc.modules) if (m.parent === p) out.push(m.id);
  }
  return out;
}

/** The frames holding an object, innermost first; a frame holds itself. */
export function chainOf(doc: Doc, id: string): string[] {
  const out: string[] = [];
  let p: string | null = doc.groups.some((g) => g.id === id) ? id : parentOf(doc, id);
  while (p && out.length < 64 && !out.includes(p)) {
    out.push(p);
    p = parentOf(doc, p);
  }
  return out;
}

/** The ids plus everything inside the frames among them. */
export function withDescendants(doc: Doc, ids: readonly string[]): string[] {
  const all = new Set(ids);
  for (const id of ids) if (isGroupId(id)) for (const d of descendants(doc, id)) all.add(d);
  return [...all];
}

/** The ids that are not inside another of the ids. */
export function rootsOf(doc: Doc, ids: readonly string[]): string[] {
  const set = new Set(ids);
  return ids.filter((id) => !chainOf(doc, id).some((g) => g !== id && set.has(g)));
}

const contains = (r: Rect, p: Pt): boolean => p.x > r.x && p.x < r.x + r.w && p.y > r.y && p.y < r.y + r.h;
const centre = (r: Rect): Pt => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });

/** The smallest frame holding `p` that is larger than `minArea`, skipping `skip`. */
function innermost(doc: Doc, p: Pt, minArea: number, skip: ReadonlySet<string>): string | null {
  let best: string | null = null;
  let area = Infinity;
  for (const g of doc.groups) {
    const a = g.w * g.h;
    if (skip.has(g.id) || a <= minArea || !contains(g, p)) continue;
    if (a < area) {
      area = a;
      best = g.id;
    }
  }
  return best;
}

/**
 * Membership is containment (spec §5): an object's parent is the innermost frame holding its centre — for a frame,
 * a larger one that is neither itself nor inside it. Only `only` is recomputed when given; frames in `skip` are
 * never chosen (a moved frame never captures what it lands on).
 */
export function recomputeParents(
  doc: Doc,
  specs: Specs,
  only?: readonly string[],
  skip: readonly string[] = [],
): Doc {
  const want = only ? new Set(only) : null;
  const skipped = new Set(skip);
  const modules = doc.modules.map((m) => {
    if (want && !want.has(m.id)) return m;
    const parent = innermost(doc, centre(rectOf(doc, specs, m.id)), 0, skipped);
    return parent === m.parent ? m : { ...m, parent };
  });
  const groups = doc.groups.map((g) => {
    if (want && !want.has(g.id)) return g;
    const inside = new Set([g.id, ...descendants(doc, g.id), ...skipped]);
    const parent = innermost(doc, centre(g), g.w * g.h, inside);
    return parent === g.parent ? g : { ...g, parent };
  });
  return { ...doc, modules, groups };
}

function bounds(rects: Rect[]): Rect {
  const x0 = Math.min(...rects.map((r) => r.x));
  const y0 = Math.min(...rects.map((r) => r.y));
  const x1 = Math.max(...rects.map((r) => r.x + r.w));
  const y1 = Math.max(...rects.map((r) => r.y + r.h));
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** G / ⌘G: a new frame fitted around the selection (16 px padding, header above), nested in its innermost common parent. */
export function frameSelection(doc: Doc, specs: Specs, ids: readonly string[]): { doc: Doc; id: string } {
  const roots = rootsOf(doc, ids);
  if (!roots.length) throw new Error('nothing to frame');
  const b = bounds(roots.map((id) => rectOf(doc, specs, id)));
  const chains = roots.map((id) => chainOf(doc, id).filter((g) => g !== id));
  const parent = chains[0]!.find((g) => chains.every((c) => c.includes(g))) ?? null;
  const n = Math.max(0, ...doc.groups.map((g) => Number(/^GROUP (\d+)$/.exec(g.name)?.[1] ?? 0))) + 1;
  const id = `g${doc.nextId}`;
  const group: Group = {
    id,
    name: `GROUP ${n}`,
    x: b.x - GPAD,
    y: b.y - GPAD - GHEAD,
    w: Math.max(FRAME_MIN.w, b.w + 2 * GPAD),
    h: Math.max(FRAME_MIN.h, b.h + 2 * GPAD + GHEAD),
    parent,
    ratio: 1,
    tint: 0,
    layout: 'route',
    muted: false,
    clock: { on: false, bpm: 120 },
  };
  const set = new Set(roots);
  const framed: Doc = {
    ...doc,
    nextId: doc.nextId + 1,
    groups: [...doc.groups.map((g) => (set.has(g.id) ? { ...g, parent: id } : g)), group],
    modules: doc.modules.map((m) => (set.has(m.id) ? { ...m, parent: id } : m)),
  };
  // WIRE FIX is on by default: pack it, then the WIRE FIX frames around it
  const packed = packFrame(framed, specs, id, 'route');
  return { doc: repackRoutes(growToHold(packed, id), specs, parent ? [parent] : []), id };
}

/**
 * The frames around `gid` grow, innermost first, until each holds what is inside it with 16 px to spare (under its
 * header): a parent stays larger than its child, so containment keeps the nesting.
 */
function growToHold(doc: Doc, gid: string): Doc {
  let groups = doc.groups;
  let child = groups.find((g) => g.id === gid)!;
  while (child.parent) {
    const p = groups.find((g) => g.id === child.parent);
    if (!p) break;
    const x0 = Math.min(p.x, child.x - GPAD);
    const y0 = Math.min(p.y, child.y - GPAD - GHEAD);
    const x1 = Math.max(p.x + p.w, child.x + child.w + GPAD);
    const y1 = Math.max(p.y + p.h, child.y + child.h + GPAD);
    const grown = { ...p, x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
    groups = groups.map((g) => (g.id === p.id ? grown : g));
    child = grown;
  }
  return { ...doc, groups };
}

/** G on frames / ⇧⌘G: remove the frames; their children move to their parent; cables on their clock jacks go. */
export function unframe(doc: Doc, _specs: Specs, gids: readonly string[]): Doc {
  const gone = new Set(gids);
  const up = (p: string | null): string | null => {
    while (p && gone.has(p)) p = parentOf(doc, p);
    return p;
  };
  return {
    ...doc,
    groups: doc.groups.filter((g) => !gone.has(g.id)).map((g) => ({ ...g, parent: up(g.parent) })),
    modules: doc.modules.map((m) => (m.parent && gone.has(m.parent) ? { ...m, parent: up(m.parent) } : m)),
    cables: doc.cables.filter((c) => !gone.has(c.from[0]) && !gone.has(c.to[0])),
  };
}

/** The frame a moved selection would land in (for the drop highlight): what its moved roots' centre falls in. */
export function landingFrame(
  doc: Doc,
  specs: Specs,
  ids: readonly string[],
  dx: number,
  dy: number,
): string | null {
  const roots = rootsOf(doc, ids);
  if (!roots.length) return null;
  const b = bounds(roots.map((id) => rectOf(doc, specs, id)));
  const area = roots.length === 1 && isGroupId(roots[0]!) ? b.w * b.h : 0;
  return innermost(
    doc,
    { x: b.x + b.w / 2 + dx, y: b.y + b.h / 2 + dy },
    area,
    new Set(withDescendants(doc, ids)),
  );
}

/** Drag an edge or corner: at least 352 × 96; everything is re-parented (growing over an object attaches it). */
export function resizeFrame(doc: Doc, specs: Specs, gid: string, r: Rect): Doc {
  const w = Math.max(FRAME_MIN.w, r.w);
  const h = Math.max(FRAME_MIN.h, r.h);
  const groups = doc.groups.map((g) => (g.id === gid ? { ...g, x: r.x, y: r.y, w, h } : g));
  return recomputeParents({ ...doc, groups }, specs);
}

export function editFrame(
  doc: Doc,
  gid: string,
  patch: Partial<Pick<Group, 'name' | 'tint' | 'muted' | 'ratio' | 'clock'>>,
): Doc {
  if (!doc.groups.some((g) => g.id === gid)) throw new Error(`no frame ${gid}`);
  return { ...doc, groups: doc.groups.map((g) => (g.id === gid ? { ...g, ...patch } : g)) };
}

/** Muted itself or inside a muted frame. */
export function effectiveMuted(doc: Doc, gid: string): boolean {
  return chainOf(doc, gid).some((id) => doc.groups.find((g) => g.id === id)?.muted);
}

const snapUp = (v: number): number => Math.ceil(v / 8) * 8;
/** the height of 1U: a row holds what starts within half of it */
const U = 144;

/** A frame's direct children in reading order: rows by position (a new row past half a 1U), then x. */
function readingOrder(doc: Doc, specs: Specs, gid: string): { id: string; r: Rect }[] {
  const kids = [
    ...doc.modules.filter((m) => m.parent === gid).map((m) => m.id),
    ...doc.groups.filter((g) => g.parent === gid).map((g) => g.id),
  ]
    .map((id) => ({ id, r: rectOf(doc, specs, id) }))
    .sort((a, b) => a.r.y - b.r.y || a.r.x - b.r.x);
  const rows: { top: number; items: { id: string; r: Rect }[] }[] = [];
  for (const k of kids) {
    const cur = rows[rows.length - 1];
    if (!cur || k.r.y >= cur.top + U / 2) rows.push({ top: k.r.y, items: [k] });
    else cur.items.push(k);
  }
  return rows.flatMap((row) => row.items.sort((a, b) => a.r.x - b.r.x));
}

/**
 * The width a frame packs into depends only on what it holds (so repeated presses give the same result): about 1.6 ×
 * the side of a square of the children's area with WIRE FIX's channels, at least the widest child.
 */
function packWidth(order: { r: Rect }[]): number {
  let area = 0;
  let widest = 0;
  for (const k of order) {
    area += (k.r.w + RGAP) * (k.r.h + RGAP);
    widest = Math.max(widest, k.r.w);
  }
  return Math.max(widest, snapUp(Math.sqrt(area) * 1.6));
}

/** Move an object and, for a frame, everything inside it. */
function shift(doc: Doc, id: string, dx: number, dy: number): Doc {
  if (!dx && !dy) return doc;
  const set = new Set([id, ...(isGroupId(id) ? descendants(doc, id) : [])]);
  return {
    ...doc,
    modules: doc.modules.map((m) => (set.has(m.id) ? { ...m, x: m.x + dx, y: m.y + dy } : m)),
    groups: doc.groups.map((g) => (set.has(g.id) ? { ...g, x: g.x + dx, y: g.y + dy } : g)),
  };
}

/**
 * STACK and WIRE FIX pack the same rows (breaks at `packWidth`): `gap` between children and `pad` around them, rows
 * top-aligned; then the frame fits its content with the same margin on all four sides. An empty frame is the minimum.
 */
function packRows(doc: Doc, specs: Specs, gid: string, gap: number, pad: number): Doc {
  const g0 = doc.groups.find((g) => g.id === gid)!;
  const order = readingOrder(doc, specs, gid);
  if (!order.length)
    return { ...doc, groups: doc.groups.map((g) => (g.id === gid ? { ...g, ...FRAME_MIN } : g)) };
  const inner = packWidth(order);
  const rows: (typeof order)[] = [[]];
  let used = 0;
  for (const k of order) {
    if (used > 0 && used + k.r.w > inner) {
      rows.push([]);
      used = 0;
    }
    rows[rows.length - 1]!.push(k);
    used += k.r.w + RGAP;
  }
  let d = doc;
  let y = g0.y + GHEAD + pad;
  for (const row of rows) {
    let x = g0.x + pad;
    let rowH = 0;
    for (const k of row) {
      d = shift(d, k.id, x - k.r.x, y - k.r.y);
      x += k.r.w + gap;
      rowH = Math.max(rowH, k.r.h);
    }
    y += rowH + gap;
  }
  // fit: the same margin on the right and at the bottom as on the left and at the top (the height is exact: the
  // 28 px header is off the 8 px grid)
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const id of descendants(d, gid)) {
    const r = rectOf(d, specs, id);
    x1 = Math.max(x1, r.x + r.w);
    y1 = Math.max(y1, r.y + r.h);
  }
  const w = Math.max(FRAME_MIN.w, snapUp(x1 + pad - g0.x));
  const h = Math.max(FRAME_MIN.h, y1 + pad - g0.y);
  return { ...d, groups: d.groups.map((g) => (g.id === gid ? { ...g, w, h } : g)) };
}

/** STACK (flush inside 16 px; WIRE FIX off) or WIRE FIX (32 px channels around and between; routed wires). */
export function packFrame(doc: Doc, specs: Specs, gid: string, mode: 'stack' | 'route'): Doc {
  const packed =
    mode === 'stack' ? packRows(doc, specs, gid, 0, GPAD) : packRows(doc, specs, gid, RGAP, RGAP);
  const layout = mode === 'stack' ? 'free' : 'route';
  return { ...packed, groups: packed.groups.map((g) => (g.id === gid ? { ...g, layout } : g)) };
}

/** FIX on packs the frame; FIX off keeps the layout and returns to curves. */
export function setLayout(doc: Doc, specs: Specs, gid: string, layout: 'free' | 'route'): Doc {
  if (layout === 'route') return packFrame(doc, specs, gid, 'route');
  return { ...doc, groups: doc.groups.map((g) => (g.id === gid ? { ...g, layout } : g)) };
}

/** Re-pack the WIRE FIX frames among `gids` and around them, innermost first. */
export function repackRoutes(doc: Doc, specs: Specs, gids: readonly string[]): Doc {
  const all = new Set<string>();
  for (const gid of gids) for (const g of chainOf(doc, gid)) all.add(g);
  const depth = (id: string) => chainOf(doc, id).length;
  let d = doc;
  for (const gid of [...all].sort((a, b) => depth(b) - depth(a)))
    if (d.groups.find((g) => g.id === gid)?.layout === 'route') d = packFrame(d, specs, gid, 'route');
  return d;
}

/**
 * After an action: re-pack the WIRE FIX frames whose direct children changed between `before` and `after`, and the
 * frames in `also` (a module moved within one), with their WIRE FIX parents.
 */
export function settle(before: Doc, after: Doc, specs: Specs, also: readonly string[] = []): Doc {
  const kids = (doc: Doc) => {
    const out = new Map<string, string[]>();
    for (const o of [...doc.modules, ...doc.groups])
      if (o.parent) out.set(o.parent, [...(out.get(o.parent) ?? []), o.id]);
    return out;
  };
  const [a, b] = [kids(before), kids(after)];
  const changed = after.groups
    .map((g) => g.id)
    .filter((id) => also.includes(id) || (a.get(id) ?? []).sort().join() !== (b.get(id) ?? []).sort().join());
  return changed.length ? repackRoutes(after, specs, changed) : after;
}

/** A frame with everything inside it and the cables among those (cables from outside stay behind); as a document. */
export function extractGroup(doc: Doc, gid: string): Doc {
  const ids = new Set([gid, ...descendants(doc, gid)]);
  return {
    version: 1,
    modules: doc.modules.filter((m) => ids.has(m.id)),
    groups: doc.groups.filter((g) => ids.has(g.id)).map((g) => (g.id === gid ? { ...g, parent: null } : g)),
    cables: doc.cables.filter((c) => ids.has(c.from[0]) && ids.has(c.to[0])),
    nextId: doc.nextId,
  };
}

/** Copy a document into `doc` with fresh ids, moved by (dx, dy). Returns the new ids by old id. */
export function mergeDoc(
  doc: Doc,
  src: Doc,
  dx: number,
  dy: number,
): { doc: Doc; map: Record<string, string> } {
  let next = doc.nextId;
  const map: Record<string, string> = {};
  for (const m of src.modules) map[m.id] = `m${next++}`;
  for (const g of src.groups) map[g.id] = `g${next++}`;
  const re = (id: string | null) => (id === null ? null : (map[id] ?? null));
  return {
    doc: {
      ...doc,
      nextId: next,
      modules: [
        ...doc.modules,
        ...src.modules.map((m) => ({ ...m, id: map[m.id]!, x: m.x + dx, y: m.y + dy, parent: re(m.parent) })),
      ],
      groups: [
        ...doc.groups,
        ...src.groups.map((g) => ({ ...g, id: map[g.id]!, x: g.x + dx, y: g.y + dy, parent: re(g.parent) })),
      ],
      cables: [
        ...doc.cables,
        ...src.cables
          .filter((c) => map[c.from[0]] && map[c.to[0]])
          .map((c) => ({
            from: [map[c.from[0]]!, c.from[1]] as [string, string],
            to: [map[c.to[0]]!, c.to[1]] as [string, string],
          })),
      ],
    },
    map,
  };
}
