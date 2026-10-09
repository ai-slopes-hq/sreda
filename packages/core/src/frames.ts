// Frames (spec §5): geometry, membership by containment, and the edits that make, unmake and resize them.
// Pure functions from a document to a new one, like ops.ts.
import type { Cable, Doc, Group, Layout } from './doc';
import { layoutPanel } from './panel';
import { inputPorts, type Specs } from './spec';
import { portLabel } from './names';

export const GHEAD = 28,
  GPAD = 16,
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

/**
 * A jack's position on the canvas, for a module's port or a frame's `clkIn` / `clkOut`. A port under a collapsed frame
 * is where its block jack is; `blocks` caches the blocks of one document across many calls (a block scans all cables).
 */
export function jackAt(doc: Doc, specs: Specs, id: string, port: string, blocks?: Map<string, Block>): Pt {
  const owner = blockOwner(doc, id);
  if (owner) {
    const o = doc.groups.find((x) => x.id === owner)!;
    let block = blocks?.get(owner);
    if (!block) {
      block = blockOf(doc, specs, owner);
      blocks?.set(owner, block);
    }
    const j = block.jacks.find((b) => b.id === id && b.port === port);
    if (j) return { x: o.x + j.x, y: o.y + j.y };
    // an owned port without a crossing jack: its cables are hidden, so nothing is drawn there; fall through
  }
  const g = doc.groups.find((x) => x.id === id);
  if (g) {
    if (g.collapsed && port === 'clkOut') return { x: g.x + BLOCK_W, y: g.y + GHEAD / 2 };
    const j = FRAME_JACKS[port]!;
    return { x: g.x + j.x, y: g.y + j.y };
  }
  const m = doc.modules.find((x) => x.id === id)!;
  const j = layoutPanel(specs[m.type]!).jacks[port]!;
  return { x: m.x + j.x, y: m.y + j.y };
}

const BLOCK_W = FRAME_MIN.w;
const BLOCK_ROW = 24;

/** The outermost collapsed frame strictly containing a module or frame; null: it is visible. */
export function blockOwner(doc: Doc, id: string): string | null {
  let owner: string | null = null;
  for (const g of chainOf(doc, id)) if (g !== id && doc.groups.find((x) => x.id === g)?.collapsed) owner = g;
  return owner;
}

/** A jack of a collapsed frame's block, relative to the block's top-left. */
export interface BlockJack {
  id: string;
  port: string;
  label: string;
  dir: 'in' | 'out';
  x: number;
  y: number;
}

export interface Block {
  w: number;
  h: number;
  jacks: BlockJack[];
}

/** What is drawn of an object: a collapsed frame is its block, anything else its rectangle. */
export function shownRect(doc: Doc, specs: Specs, id: string, blocks?: ReadonlyMap<string, Block>): Rect {
  const g = doc.groups.find((x) => x.id === id);
  if (!g?.collapsed) return rectOf(doc, specs, id);
  const b = blocks?.get(id) ?? blockOf(doc, specs, id);
  return { x: g.x, y: g.y, w: b.w, h: b.h };
}

/**
 * A collapsed frame as a block: a jack per inner port whose cable leaves the frame (inputs left, outputs right,
 * in reading order of their objects, then spec order). The frame's own jacks are not listed here.
 */
export function blockOf(doc: Doc, specs: Specs, gid: string): Block {
  const inner = new Set(descendants(doc, gid));
  const crossing = { in: new Set<string>(), out: new Set<string>() };
  for (const c of doc.cables) {
    const a = inner.has(c.from[0]);
    const b = inner.has(c.to[0]);
    if (a && !b && c.to[0] !== gid) crossing.out.add(c.from.join('\0'));
    if (b && !a && c.from[0] !== gid) crossing.in.add(c.to.join('\0'));
  }
  const objects = sortReading(
    [...inner].map((id) => ({ id, r: rectOf(doc, specs, id) })),
    false,
  );
  const ins: BlockJack[] = [];
  const outs: BlockJack[] = [];
  const add = (list: BlockJack[], dir: 'in' | 'out', id: string, port: string, label: string) =>
    list.push({ id, port, label, dir, x: dir === 'in' ? 12 : BLOCK_W - 12, y: 0 });
  for (const { id } of objects) {
    const g = doc.groups.find((x) => x.id === id);
    const ports: { dir: 'in' | 'out'; port: string; label: string }[] = [];
    if (g)
      ports.push(
        { dir: 'in', port: 'clkIn', label: `${g.name} › CLK` },
        { dir: 'out', port: 'clkOut', label: `${g.name} › CLK` },
      );
    else {
      const spec = specs[doc.modules.find((m) => m.id === id)!.type]!;
      for (const p of inputPorts(spec))
        ports.push({ dir: 'in', port: p.id, label: portLabel(doc, specs, id, p.id) });
      for (const p of spec.outputs)
        ports.push({ dir: 'out', port: p.id, label: portLabel(doc, specs, id, p.id) });
    }
    for (const p of ports) {
      const key = `${id}\0${p.port}`;
      if (p.dir === 'in' ? crossing.in.has(key) : crossing.out.has(key))
        add(p.dir === 'in' ? ins : outs, p.dir, id, p.port, p.label);
    }
  }
  for (const list of [ins, outs]) list.forEach((j, i) => (j.y = GHEAD + 8 + BLOCK_ROW * i + 12));
  const h = Math.max(FRAME_MIN.h, GHEAD + 16 + BLOCK_ROW * Math.max(ins.length, outs.length));
  return { w: BLOCK_W, h, jacks: [...ins, ...outs] };
}

/** A cable inside a block, or between a collapsed frame's own jack and what it holds: not drawn. */
export function cableHidden(doc: Doc, c: Cable): boolean {
  const [a, b] = [c.from[0], c.to[0]];
  const oa = blockOwner(doc, a);
  if (oa && oa === blockOwner(doc, b)) return true;
  const own = (g: string, other: string) =>
    !!doc.groups.find((x) => x.id === g)?.collapsed && descendants(doc, g).includes(other);
  return own(a, b) || own(b, a);
}

/** The outermost collapsed frame a hidden cable sits inside (expanding it shows the cable); null: it is drawn. */
export function hiddenIn(doc: Doc, c: Cable): string | null {
  return cableHidden(doc, c) ? (blockOwner(doc, c.to[0]) ?? blockOwner(doc, c.from[0])) : null;
}

const setGroups = (doc: Doc, gids: readonly string[], f: (g: Group) => Group): Doc => ({
  ...doc,
  groups: doc.groups.map((g) => (gids.includes(g.id) ? f(g) : g)),
});

export const setCollapsed = (doc: Doc, gids: readonly string[], on: boolean): Doc =>
  setGroups(doc, gids, (g) => (g.collapsed === on ? g : { ...g, collapsed: on }));

/** Every frame collapsed when any is expanded, else every frame expanded. */
export function toggleCollapsedAll(doc: Doc): Doc {
  return setCollapsed(
    doc,
    doc.groups.map((g) => g.id),
    doc.groups.some((g) => !g.collapsed),
  );
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
function innermost(
  doc: Doc,
  p: Pt,
  minArea: number,
  skip: ReadonlySet<string>,
  objs: readonly string[],
): string | null {
  let best: string | null = null;
  let area = Infinity;
  for (const g of doc.groups) {
    const a = g.w * g.h;
    if (skip.has(g.id) || a <= minArea || !contains(g, p)) continue;
    // a collapsed frame's room (and anything under a block) is free: it only keeps what is already inside it
    if ((g.collapsed || blockOwner(doc, g.id)) && !objs.some((o) => chainOf(doc, o).includes(g.id))) continue;
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
    const parent = innermost(doc, centre(rectOf(doc, specs, m.id)), 0, skipped, [m.id]);
    return parent === m.parent ? m : { ...m, parent };
  });
  const groups = doc.groups.map((g) => {
    if (want && !want.has(g.id)) return g;
    const inside = new Set([g.id, ...descendants(doc, g.id), ...skipped]);
    const shown = shownRect(doc, specs, g.id);
    const parent = innermost(doc, centre(shown), shown.w * shown.h, inside, [g.id]);
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
    layout: 'free',
    muted: false,
    collapsed: false,
    clock: { on: false, bpm: 120 },
  };
  const set = new Set(roots);
  const framed: Doc = {
    ...doc,
    nextId: doc.nextId + 1,
    groups: [...doc.groups.map((g) => (set.has(g.id) ? { ...g, parent: id } : g)), group],
    modules: doc.modules.map((m) => (set.has(m.id) ? { ...m, parent: id } : m)),
  };
  // STACK is on by default: pack it, then the managed frames around it
  const packed = setLayout(framed, specs, id, 'stack');
  return { doc: repackManaged(growToHold(packed, id), specs, parent ? [parent] : []), id };
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
  const b = bounds(roots.map((id) => shownRect(doc, specs, id)));
  const area = roots.length === 1 && isGroupId(roots[0]!) ? b.w * b.h : 0;
  return innermost(
    doc,
    { x: b.x + b.w / 2 + dx, y: b.y + b.h / 2 + dy },
    area,
    new Set(withDescendants(doc, ids)),
    roots,
  );
}

/**
 * Drag an edge or corner: at least 352 × 96; everything is re-parented (growing over an object attaches it). A STACK
 * frame keeps its place and only its width counts: it re-packs to it.
 */
export function resizeFrame(doc: Doc, specs: Specs, gid: string, r: Rect): Doc {
  const managed = doc.groups.find((g) => g.id === gid)!.layout !== 'free';
  const w = Math.max(FRAME_MIN.w, r.w);
  const h = Math.max(FRAME_MIN.h, r.h);
  const groups = doc.groups.map((g) =>
    g.id === gid ? (managed ? { ...g, w } : { ...g, x: r.x, y: r.y, w, h }) : g,
  );
  const d = recomputeParents({ ...doc, groups }, specs);
  if (!managed) return d;
  // narrowing never throws a packed child out: it re-packs to the new width
  const keep = <T extends { id: string; parent: string | null }>(os: T[], was: T[]): T[] =>
    os.map((o) => (was.find((x) => x.id === o.id)?.parent === gid ? { ...o, parent: gid } : o));
  return packFrame(
    { ...d, modules: keep(d.modules, doc.modules), groups: keep(d.groups, doc.groups) },
    specs,
    gid,
  );
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

export interface Item {
  id: string;
  r: Rect;
}

/** Reading order: rows by position (a new row past half a 1U), then x. */
function sortReading(kids: Item[], strict = false): Item[] {
  const sorted = [...kids].sort((a, b) => a.r.y - b.r.y || a.r.x - b.r.x);
  if (strict) return sorted;
  const rows: { top: number; items: Item[] }[] = [];
  for (const k of sorted) {
    const cur = rows[rows.length - 1];
    if (!cur || k.r.y >= cur.top + U / 2) rows.push({ top: k.r.y, items: [k] });
    else cur.items.push(k);
  }
  return rows.flatMap((row) => row.items.sort((a, b) => a.r.x - b.r.x));
}

/** A frame's direct children in reading order. */
function readingOrder(doc: Doc, specs: Specs, gid: string, strict = false): Item[] {
  return sortReading(
    [
      ...doc.modules.filter((m) => m.parent === gid).map((m) => m.id),
      ...doc.groups.filter((g) => g.parent === gid).map((g) => g.id),
    ].map((id) => ({ id, r: rectOf(doc, specs, id) })),
    strict,
  );
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

/** Where each child goes, relative to the inner top-left, and the extent of the result. */
export interface Packed {
  at: Map<string, Pt>;
  w: number;
  h: number;
}

/**
 * Dense packing (STACK) into inner width `W`: a skyline of segments `{x, w, y}`; each child, in order, goes where
 * it sits lowest (then leftmost) among the segment starts it fits at.
 */
function skyline(order: Item[], W: number): Packed {
  let sky: { x: number; w: number; y: number }[] = [{ x: 0, w: W, y: 0 }];
  const at = new Map<string, Pt>();
  let w = 0;
  let h = 0;
  for (const k of order) {
    let bx = 0;
    let by = Infinity;
    for (const s of sky) {
      if (s.x + k.r.w > W) continue;
      let y = 0;
      for (const t of sky) if (t.x < s.x + k.r.w && t.x + t.w > s.x) y = Math.max(y, t.y);
      if (y < by || (y === by && s.x < bx)) {
        by = y;
        bx = s.x;
      }
    }
    if (by === Infinity) {
      // wider than the packing width (cannot happen with the width clamped): put it in a row of its own
      bx = 0;
      by = Math.max(...sky.map((s) => s.y));
    }
    at.set(k.id, { x: bx, y: by });
    w = Math.max(w, bx + k.r.w);
    h = Math.max(h, by + k.r.h);
    const top = by + snapUp(k.r.h);
    // what is left of a segment starts on the 8 px grid, whatever the child's width
    const right = snapUp(bx + k.r.w);
    const next: typeof sky = [];
    for (const s of sky) {
      if (s.x + s.w <= bx || s.x >= right) next.push(s);
      else {
        if (s.x < bx) next.push({ x: s.x, w: bx - s.x, y: s.y });
        if (s.x + s.w > right) next.push({ x: right, w: s.x + s.w - right, y: s.y });
      }
    }
    next.push({ x: bx, w: Math.min(right, W) - bx, y: top });
    sky = next.sort((a, b) => a.x - b.x);
  }
  return { at, w, h };
}

/**
 * The frame width STACK starts with: the inner width in [widest, Σw] (step 8) whose skyline pack minimises
 * area · (1 + 0.15 · |aspect − 1.6|), plus the padding.
 */
function autoWidth(order: Item[]): number {
  if (!order.length) return FRAME_MIN.w;
  const widest = Math.max(...order.map((k) => k.r.w));
  const total = order.reduce((s, k) => s + k.r.w, 0);
  let best = widest;
  let bestScore = Infinity;
  for (let W = widest; W <= Math.max(widest, total); W += 8) {
    const p = skyline(order, W);
    const score = p.w * p.h * (1 + 0.15 * Math.abs(p.w / p.h - 1.6));
    if (score < bestScore) {
      bestScore = score;
      best = W;
    }
  }
  return Math.max(FRAME_MIN.w, best + 2 * GPAD);
}

/**
 * A second press must change nothing: pack again until the reading order of the result is the order used. When the
 * rounds run out (an order and its pack chase each other) the order with the shortest pack is kept, the earliest on
 * a tie, so the result is still deterministic. `pack` is injectable for the test of that fallback.
 */
export function fixedOrder(
  order: Item[],
  inner: number,
  pack: (order: Item[], inner: number) => Packed = skyline,
  rounds = 8,
): { order: Item[]; packed: Packed } {
  let cur = order;
  let packed = pack(cur, inner);
  let best = { order: cur, packed };
  for (let i = 0; i < rounds; i++) {
    const next = sortReading(
      cur.map((k) => ({ id: k.id, r: { ...k.r, ...packed.at.get(k.id)! } })),
      true,
    );
    if (next.every((k, j) => k.id === cur[j]!.id)) return { order: cur, packed };
    cur = next.map((k) => order.find((o) => o.id === k.id)!);
    packed = pack(cur, inner);
    if (packed.h < best.packed.h) best = { order: cur, packed };
  }
  return best;
}

/**
 * Pack a frame by its own layout at its current width (at least the widest child plus the padding): children are
 * placed, then the frame fits them in height with the same margin on all sides. An empty frame is the minimum high.
 */
export function packFrame(doc: Doc, specs: Specs, gid: string, fresh = false): Doc {
  const g0 = doc.groups.find((g) => g.id === gid)!;
  if (g0.layout === 'free') return doc;
  const pad = GPAD;
  // a packed STACK reads strictly by position (the pack's own order), a loose frame in rows
  const order = readingOrder(doc, specs, gid, !fresh);
  if (!order.length)
    return {
      ...doc,
      groups: doc.groups.map((g) =>
        g.id === gid ? { ...g, w: Math.max(FRAME_MIN.w, g.w), h: FRAME_MIN.h } : g,
      ),
    };
  const widest = Math.max(...order.map((k) => k.r.w));
  const w = Math.max(FRAME_MIN.w, g0.w, widest + 2 * pad);
  const inner = w - 2 * pad;
  const { order: cur, packed } = fixedOrder(order, inner);
  let d = doc;
  for (const k of cur) {
    const p = packed.at.get(k.id)!;
    d = shift(d, k.id, g0.x + pad + p.x - k.r.x, g0.y + GHEAD + pad + p.y - k.r.y);
  }
  // the height is exact: the 28 px header is off the 8 px grid
  const h = Math.max(FRAME_MIN.h, GHEAD + 2 * pad + packed.h);
  return { ...d, groups: d.groups.map((g) => (g.id === gid ? { ...g, w, h } : g)) };
}

/**
 * Set a frame's layout. STACK from loose chooses the width and packs; the same layout again changes nothing; loose
 * only turns the packing off.
 */
export function setLayout(doc: Doc, specs: Specs, gid: string, layout: Layout): Doc {
  const g = doc.groups.find((x) => x.id === gid)!;
  if (g.layout === layout) return doc;
  const set = (patch: Partial<Group>): Doc => ({
    ...doc,
    groups: doc.groups.map((x) => (x.id === gid ? { ...x, ...patch } : x)),
  });
  if (layout === 'free') return set({ layout });
  const w = g.layout === 'free' ? autoWidth(readingOrder(doc, specs, gid)) : g.w;
  return packFrame(set({ layout, w }), specs, gid, g.layout === 'free');
}

/** Re-pack the STACK frames among `gids` and around them, innermost first. */
export function repackManaged(doc: Doc, specs: Specs, gids: readonly string[]): Doc {
  const all = new Set<string>();
  for (const gid of gids) for (const g of chainOf(doc, gid)) all.add(g);
  const depth = (id: string) => chainOf(doc, id).length;
  let d = doc;
  for (const gid of [...all].sort((a, b) => depth(b) - depth(a))) d = packFrame(d, specs, gid);
  return d;
}

/**
 * After an action: re-pack the STACK frames whose direct children changed between `before` and `after`,
 * and the frames in `also` (a module moved within one), with their managed parents.
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
  return changed.length ? repackManaged(after, specs, changed) : after;
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
