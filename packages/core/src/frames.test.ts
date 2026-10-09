import { expect, test } from 'vitest';
import { emptyDoc, validateDoc, type Doc } from './doc';
import { layoutPanel } from './panel';
import { SPECS } from './spec';
import {
  blockOf,
  blockOwner,
  cableHidden,
  setCollapsed,
  toggleCollapsedAll,
  descendants,
  extractGroup,
  mergeDoc,
  packFrame,
  setLayout,
  settle,
  effectiveMuted,
  fixedOrder,
  frameSelection,
  GHEAD,
  GPAD,
  jackAt,
  landingFrame,
  rectOf,
  resizeFrame,
  unframe,
  type Rect,
} from './frames';
import { addModule, connect, deleteObjects, moveObjects, RuleError } from './ops';
import { TEST_SPECS as S } from './testspecs';

// TEST_SPECS modules are 3 HP × 1U: 168 × 144
function mods(...at: [string, number, number][]): { doc: Doc; ids: string[] } {
  let doc = emptyDoc;
  const ids: string[] = [];
  for (const [type, x, y] of at) {
    const a = addModule(doc, S, type, x, y);
    doc = a.doc;
    ids.push(a.id);
  }
  return { doc, ids };
}
const parentOf = (doc: Doc, id: string) =>
  (doc.modules.find((m) => m.id === id) ?? doc.groups.find((g) => g.id === id))!.parent;

test('G frames the selection as a STACK: placed where it fits, packed densely with 16 px padding, GROUP n', () => {
  const { doc, ids } = mods(['src', 400, 400], ['fx', 800, 400]);
  const { doc: d, id } = frameSelection(doc, S, ids);
  const g = d.groups.find((x) => x.id === id)!;
  expect(id).toBe('g3');
  // the top-left where 16 px padding and the header fit the selection; then packed: one row, 16 px around and no gap between
  expect(g).toMatchObject({
    name: 'GROUP 1',
    x: 400 - GPAD,
    y: 400 - GPAD - GHEAD,
    w: GPAD + 168 + 168 + GPAD,
    h: GHEAD + GPAD + 144 + GPAD,
    parent: null,
    ratio: 1,
    tint: 0,
    layout: 'stack',
    muted: false,
    clock: { on: false, bpm: 120 },
  });
  expect(d.modules.map((m) => [m.x - g.x, m.y - g.y])).toEqual([
    [GPAD, GHEAD + GPAD],
    [GPAD + 168, GHEAD + GPAD],
  ]);
  expect(ids.map((m) => parentOf(d, m))).toEqual([id, id]);
  const more = addModule(d, S, 'src', 2000, 0);
  expect(frameSelection(more.doc, S, [more.id]).doc.groups[1]!.name).toBe('GROUP 2');
});

test('a frame is at least 352 × 96', () => {
  const { doc, ids } = mods(['src', 0, 0]);
  const g = frameSelection(doc, S, ids).doc.groups[0]!;
  expect(g.w).toBe(352);
  expect(g.h).toBe(144 + 2 * GPAD + GHEAD);
});

test('framing a module inside a frame nests the new frame; unframe gives its children back', () => {
  const { doc, ids } = mods(['src', 0, 0], ['fx', 400, 0]);
  const g1 = frameSelection(doc, S, ids);
  const g2 = frameSelection(g1.doc, S, [ids[1]!]);
  expect(parentOf(g2.doc, g2.id)).toBe(g1.id);
  expect(parentOf(g2.doc, ids[1]!)).toBe(g2.id);
  const back = unframe(g2.doc, S, [g2.id]);
  expect(back.groups.map((g) => g.id)).toEqual([g1.id]);
  expect(parentOf(back, ids[1]!)).toBe(g1.id);
});

test('moving a module into a frame attaches it, out of it detaches it; a frame moves its contents', () => {
  const { doc, ids } = mods(['src', 0, 0], ['fx', 1000, 0]);
  const g = frameSelection(doc, S, [ids[0]!]);
  const inside = moveObjects(g.doc, S, [ids[1]!], -1000 + 100, 0);
  expect(parentOf(inside, ids[1]!)).toBe(g.id);
  const out = moveObjects(inside, S, [ids[1]!], 2000, 0);
  expect(parentOf(out, ids[1]!)).toBeNull();
  const moved = moveObjects(g.doc, S, [g.id], 40, 80);
  expect(rectOf(moved, S, g.id)).toMatchObject({ x: -GPAD + 40, y: -GPAD - GHEAD + 80 });
  expect(moved.modules[0]).toMatchObject({ x: -GPAD + GPAD + 40, y: -GPAD + GPAD + 80, parent: g.id });
});

test('a moved frame never captures what it lands on, nor nests in its own child', () => {
  const { doc, ids } = mods(['src', 0, 0], ['fx', 3000, 0], ['src', 0, 2000]);
  const a = frameSelection(doc, S, [ids[0]!]);
  // a big frame B around the module far right
  const b = frameSelection(a.doc, S, [ids[1]!]);
  const big = resizeFrame(setLayout(b.doc, S, b.id, 'free'), S, b.id, { x: 2000, y: -500, w: 3000, h: 2000 });
  // A dropped onto the lone module at (0, 2000): the module stays loose
  const onModule = moveObjects(big, S, [a.id], 0, 2000);
  expect(parentOf(onModule, ids[2]!)).toBeNull();
  // A dropped inside B: A nests in B, B's module stays in B
  const intoB = moveObjects(big, S, [a.id], 2500, 0);
  expect(parentOf(intoB, a.id)).toBe(b.id);
  expect(parentOf(intoB, ids[1]!)).toBe(b.id);
  // B dropped onto A (smaller): A keeps no parent
  const bOnA = moveObjects(big, S, [b.id], -2500, 0);
  expect(parentOf(bOnA, a.id)).toBeNull();
  // a frame moved into its own child keeps its parent
  const child = frameSelection(big, S, [ids[1]!]);
  const self = moveObjects(child.doc, S, [b.id], 10, 10);
  expect(parentOf(self, b.id)).toBeNull();
  expect(parentOf(self, child.id)).toBe(b.id);
});

test('resizing a frame over a module attaches it; the size is clamped to 352 × 96', () => {
  const { doc, ids } = mods(['src', 0, 0], ['fx', 600, 0]);
  const g = frameSelection(doc, S, [ids[0]!]);
  g.doc = setLayout(g.doc, S, g.id, 'free'); // a loose frame: free resize
  const r = rectOf(g.doc, S, g.id);
  const grown = resizeFrame(g.doc, S, g.id, { ...r, w: 1000 });
  expect(parentOf(grown, ids[1]!)).toBe(g.id);
  expect(rectOf(resizeFrame(g.doc, S, g.id, { ...r, w: 10, h: 10 }), S, g.id)).toMatchObject({
    w: 352,
    h: 96,
  });
});

test('deleting a frame takes its contents and every cable touching them or its clock jacks', () => {
  const { doc, ids } = mods(['src', 0, 0], ['fx', 400, 0], ['fx', 2000, 0]);
  const g = frameSelection(doc, S, [ids[0]!, ids[1]!]);
  let d = connect(g.doc, S, [ids[0]!, 'out'], [ids[1]!, 'in']);
  d = connect(d, S, [g.id, 'clkOut'], [ids[2]!, 'clk']);
  d = connect(d, S, [ids[2]!, 'eoc'], [g.id, 'clkIn']);
  expect(descendants(d, g.id).sort()).toEqual([ids[0], ids[1]].sort());
  const gone = deleteObjects(d, [g.id]);
  expect(gone.groups).toEqual([]);
  expect(gone.modules.map((m) => m.id)).toEqual([ids[2]]);
  expect(gone.cables).toEqual([]);
});

test('a frame has CLK IN (an input) and CLK OUT (an output)', () => {
  const { doc, ids } = mods(['fx', 0, 0], ['fx', 1000, 0]);
  const g = frameSelection(doc, S, [ids[0]!]);
  const d = connect(g.doc, S, [g.id, 'clkOut'], [ids[0]!, 'clk']);
  expect(d.cables).toEqual([{ from: [g.id, 'clkOut'], to: [ids[0], 'clk'] }]);
  expect(() => connect(g.doc, S, [g.id, 'clkIn'], [ids[1]!, 'clk'])).toThrow(RuleError);
  const r = rectOf(g.doc, S, g.id);
  expect(jackAt(g.doc, S, g.id, 'clkIn')).toEqual({ x: r.x, y: r.y + 14 });
  expect(jackAt(g.doc, S, g.id, 'clkOut')).toEqual({ x: r.x + 12, y: r.y + 36 });
});

test('a frame inside a muted frame is muted', () => {
  const { doc, ids } = mods(['src', 0, 0], ['fx', 400, 0]);
  const g1 = frameSelection(doc, S, ids);
  const g2 = frameSelection(g1.doc, S, [ids[1]!]);
  const d = { ...g2.doc, groups: g2.doc.groups.map((g) => (g.id === g1.id ? { ...g, muted: true } : g)) };
  expect(effectiveMuted(d, g2.id)).toBe(true);
  expect(effectiveMuted(g2.doc, g2.id)).toBe(false);
});

test("framing a frame's only module grows the outer frame so the new one stays inside it, smaller", () => {
  const { doc, ids } = mods(['src', 0, 0]);
  const outer = frameSelection(doc, S, ids);
  const inner = frameSelection(outer.doc, S, ids);
  const o = rectOf(inner.doc, S, outer.id);
  const i = rectOf(inner.doc, S, inner.id);
  expect(i.x - o.x).toBeGreaterThanOrEqual(GPAD);
  expect(i.y - o.y).toBeGreaterThanOrEqual(GPAD + GHEAD);
  expect(o.x + o.w - (i.x + i.w)).toBeGreaterThanOrEqual(GPAD);
  expect(o.y + o.h - (i.y + i.h)).toBeGreaterThanOrEqual(GPAD);
  const moved = moveObjects(inner.doc, S, [inner.id], 0, 8);
  expect(parentOf(moved, inner.id)).toBe(outer.id);
});

/** three 1U modules (168 × 144) in a frame, laid out loosely */
function three() {
  const { doc, ids } = mods(['src', 0, 0], ['fx', 400, 40], ['sink', 0, 400]);
  const g = frameSelection(doc, S, ids);
  return { doc: setLayout(g.doc, S, g.id, 'free'), ids, gid: g.id };
}
const rectsOf = (doc: Doc, ids: string[], specs: typeof S | typeof SPECS = S) =>
  ids.map((id) => rectOf(doc, specs, id));

test('STACK packs densely with no gaps, 16 px inside, and sets the mode', () => {
  const { doc, ids, gid } = three();
  const d = setLayout(doc, S, gid, 'stack');
  const g = rectOf(d, S, gid);
  const r = rectsOf(d, ids);
  expect(d.groups[0]!.layout).toBe('stack');
  expect(r.every((x) => x.x - g.x >= GPAD && x.y - g.y >= GHEAD + GPAD)).toBe(true);
  expect(g.x + g.w - Math.max(...r.map((x) => x.x + x.w))).toBeGreaterThanOrEqual(GPAD);
  expect(g.y + g.h - Math.max(...r.map((x) => x.y + x.h))).toBe(GPAD);
});

/** the user's patch: eight modules in this reading order in a free frame */
function patch() {
  const types = ['osc', 'osc', 'rhythm', 'stages', 'complex', 'lpg', 'att', 'delay'];
  let doc = emptyDoc;
  const ids: string[] = [];
  types.forEach((t, i) => {
    const a = addModule(doc, SPECS, t, 0, i * 400);
    doc = a.doc;
    ids.push(a.id);
  });
  const g = frameSelection(doc, SPECS, ids);
  return { doc: setLayout(g.doc, SPECS, g.id, 'free'), ids, gid: g.id };
}
const overlap = (a: Rect, b: Rect) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

test('stack packs densely in reading order', () => {
  const { doc, ids, gid } = patch();
  const d = setLayout(doc, SPECS, gid, 'stack');
  const g = rectOf(d, SPECS, gid);
  expect(g.w).toBe(1152);
  expect(g.h).toBe(GHEAD + GPAD + 688 + GPAD);
  const r = rectsOf(d, ids, SPECS);
  for (let i = 0; i < r.length; i++)
    for (let j = i + 1; j < r.length; j++) expect(overlap(r[i]!, r[j]!)).toBe(false);
  const at = (i: number) => [r[i]!.x - g.x - GPAD, r[i]!.y - g.y - GHEAD - GPAD];
  expect(at(3)).toEqual([0, 144]);
  expect(at(4)).toEqual([560, 272]);
  expect(at(6)).toEqual([560, 416]);
  expect(at(7)).toEqual([0, 544]);
  expect(r.every((x) => (x.x - g.x) % 8 === 0 && (x.y - g.y - GHEAD) % 8 === 0)).toBe(true);
});

test('stack again changes nothing; stack off keeps the placement and on again keeps it packed', () => {
  const { doc, gid } = patch();
  const stacked = setLayout(doc, SPECS, gid, 'stack');
  expect(setLayout(stacked, SPECS, gid, 'stack')).toBe(stacked);
  expect(packFrame(stacked, SPECS, gid)).toEqual(stacked);
  const off = setLayout(stacked, SPECS, gid, 'free');
  expect(off.groups.find((g) => g.id === gid)!.layout).toBe('free');
  expect(off.modules).toEqual(stacked.modules);
  const back = setLayout(off, SPECS, gid, 'stack');
  expect(back.groups.find((g) => g.id === gid)!.layout).toBe('stack');
  expect(packFrame(back, SPECS, gid)).toEqual(back);
});

test('a resize of a stack frame re-packs to the new width', () => {
  const { doc, ids, gid } = patch();
  const d = setLayout(doc, SPECS, gid, 'stack');
  const r = rectOf(d, SPECS, gid);
  const wide = resizeFrame(d, SPECS, gid, { ...r, w: 1700, x: r.x + 50, y: r.y + 50 });
  const rw = rectOf(wide, SPECS, gid);
  expect(rw).toMatchObject({ x: r.x, y: r.y, w: 1700 });
  expect(rw.h).toBeLessThan(r.h);
  const rs = rectsOf(wide, ids, SPECS);
  for (let i = 0; i < rs.length; i++)
    for (let j = i + 1; j < rs.length; j++) expect(overlap(rs[i]!, rs[j]!)).toBe(false);
  const widest = Math.max(...rectsOf(d, ids, SPECS).map((x) => x.w));
  const narrow = resizeFrame(d, SPECS, gid, { ...r, w: 100 });
  expect(rectOf(narrow, SPECS, gid).w).toBe(widest + 2 * GPAD);
  const sw = rectOf(setLayout(doc, SPECS, gid, 'stack'), SPECS, gid);
  expect(sw.w).toBe(1152);
  // a free frame resized keeps its children where they were
  const free = resizeFrame(doc, SPECS, gid, { ...rectOf(doc, SPECS, gid), w: 1700 });
  expect(free.modules.map((m) => [m.x, m.y])).toEqual(doc.modules.map((m) => [m.x, m.y]));
});

test('a drop into a stack frame re-packs it', () => {
  const { doc, gid } = patch();
  const stacked = setLayout(doc, SPECS, gid, 'stack');
  const extra = addModule(stacked, SPECS, 'lpg', 5000, 5000);
  const g = rectOf(extra.doc, SPECS, gid);
  const moved = moveObjects(extra.doc, SPECS, [extra.id], g.x + 5 - 5000, g.y + GHEAD + 5 - 5000);
  expect(parentOf(moved, extra.id)).toBe(gid);
  const settled = settle(extra.doc, moved, SPECS);
  const r = rectOf(settled, SPECS, extra.id);
  const gg = rectOf(settled, SPECS, gid);
  expect([r.x - gg.x, r.y - gg.y]).toEqual([GPAD, GHEAD + GPAD]);
});

function mulberry32(a: number) {
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

test('packing is a fixed point', () => {
  for (let seed = 1; seed <= 50; seed++) {
    const rnd = mulberry32(seed);
    const pick = <T>(xs: T[]): T => xs[Math.floor(rnd() * xs.length)]!;
    const n = 3 + Math.floor(rnd() * 10);
    let doc = emptyDoc;
    const loose: string[] = [];
    const add = (t: string) => {
      const a = addModule(doc, SPECS, t, Math.floor(rnd() * 100) * 40, Math.floor(rnd() * 80) * 40);
      doc = a.doc;
      return a.id;
    };
    for (let i = 0; i < n; i++) {
      if (rnd() < 0.2) {
        const inner = Array.from({ length: 1 + Math.floor(rnd() * 3) }, () =>
          add(pick(['osc', 'lpg', 'stages'])),
        );
        const f = frameSelection(doc, SPECS, inner);
        doc = setLayout(f.doc, SPECS, f.id, 'stack');
        loose.push(f.id);
      } else loose.push(add(pick(['osc', 'lpg', 'stages', 'rhythm'])));
    }
    const g = frameSelection(doc, SPECS, loose);
    const free = setLayout(g.doc, SPECS, g.id, 'free');
    const d = setLayout(free, SPECS, g.id, 'stack');
    expect(packFrame(d, SPECS, g.id), `seed ${seed}`).toEqual(d);
  }
});

test('old documents keep their frames', () => {
  const frame = (id: string, layout: string, x: number): unknown => ({
    id,
    name: id,
    x,
    y: 0,
    w: 400,
    h: 200,
    parent: null,
    ratio: 1,
    tint: 0,
    layout,
    muted: false,
    clock: { on: false, bpm: 120 },
  });
  const raw = (layouts: string[]) => ({
    version: 1,
    modules: [],
    cables: [],
    groups: layouts.map((l, i) => frame(`g${i}`, l, i * 500)),
    nextId: 9,
  });
  const old = validateDoc(raw(['route', 'free']), SPECS);
  expect(old!.groups.map((g) => [g.layout, g.x, g.w, g.h])).toEqual([
    ['stack', 0, 400, 96], // an empty former WIRE FIX frame is a minimum-height STACK
    ['free', 500, 400, 200],
  ]);
  expect(validateDoc(raw(['stack']), SPECS)!.groups[0]!.layout).toBe('stack');
  expect(validateDoc(raw(['spiral']), SPECS)!.groups[0]!.layout).toBe('free');
});

test('a STACK frame re-packs when a module is dropped into it, and when its last module leaves', () => {
  const { doc, ids } = mods(['src', 0, 0], ['fx', 2000, 0]);
  const g = frameSelection(doc, S, [ids[0]!]);
  // the width stays what it was: wide enough for two modules in a row
  const before = resizeFrame(g.doc, S, g.id, { ...rectOf(g.doc, S, g.id), w: 432 });
  const dropped = moveObjects(before, S, [ids[1]!], -1900, 0);
  const settled = settle(before, dropped, S);
  const r = rectsOf(settled, ids);
  expect(r[1]!.y).toBe(r[0]!.y); // packed into the row
  expect(r[1]!.x).toBe(r[0]!.x + r[0]!.w); // flush
  // the last module leaves: the empty frame is the minimum, and every number is a number
  const out = moveObjects(settled, S, ids, 0, 3000);
  const empty = rectOf(settle(settled, out, S), S, g.id);
  expect(empty).toMatchObject({ w: 432, h: 96 }); // the width stays
  expect(Object.values(empty).every(Number.isFinite)).toBe(true);
});

test('a Plan 3 WIRE FIX document opens as STACK frames, packed densely in the same reading order', () => {
  const { w, h } = layoutPanel(SPECS['osc']!);
  const m = (id: string, x: number, y: number) => ({
    id,
    type: 'osc',
    x,
    y,
    parent: 'g2',
    params: {},
    atts: {},
    ratios: {},
  });
  // two rows with 32 px channels, in a WIRE FIX frame nested in another
  const raw = {
    version: 1,
    modules: [m('m1', 32, 60), m('m2', 32 + w + 32, 60), m('m3', 32, 60 + h + 32)],
    cables: [],
    groups: [
      { id: 'g1', name: 'A', x: 0, y: 0, w: 1200, h: 600, parent: null, layout: 'route' },
      { id: 'g2', name: 'B', x: 0, y: 0, w: 1000, h: 500, parent: 'g1', layout: 'route' },
    ],
    nextId: 9,
  };
  const v = validateDoc(raw, SPECS)!;
  expect(v.groups.map((g) => g.layout)).toEqual(['stack', 'stack']);
  expect(v.modules.map((x) => x.parent)).toEqual(['g2', 'g2', 'g2']);
  const rs = rectsOf(v, ['m1', 'm2', 'm3'], SPECS);
  for (let i = 0; i < rs.length; i++)
    for (let j = i + 1; j < rs.length; j++) expect(overlap(rs[i]!, rs[j]!)).toBe(false);
  const g2 = rectOf(v, SPECS, 'g2');
  expect([rs[0]!.x - g2.x, rs[0]!.y - g2.y]).toEqual([GPAD, GHEAD + GPAD]);
  expect(rs[1]!.x).toBe(rs[0]!.x + w); // dense: no channel
  // reading order kept: the pre-migration order (rows by y, then x) is the order after
  const order = (pts: { x: number; y: number }[]) =>
    pts
      .map((p, i) => ({ i, k: p.x + p.y * 1e6 }))
      .sort((p, q) => p.k - q.k)
      .map((x) => x.i);
  expect(order(rs)).toEqual(order(raw.modules));
  expect(g2.h).toBeLessThan(500);
  for (const id of ['g1', 'g2']) expect(packFrame(v, SPECS, id)).toEqual(v);
});

test('widening a STACK frame nested in a STACK parent re-packs the parent too', () => {
  const { doc, ids } = mods(['src', 0, 0], ['fx', 300, 0], ['sink', 600, 0], ['src', 900, 0]);
  const inner = frameSelection(doc, S, [ids[0]!, ids[1]!]);
  const outer = frameSelection(inner.doc, S, [inner.id, ids[2]!, ids[3]!]);
  let d = setLayout(outer.doc, S, inner.id, 'stack');
  d = setLayout(d, S, outer.id, 'stack');
  // narrowest: the others sit below the inner frame, so widening it covers nothing new
  d = resizeFrame(d, S, outer.id, { ...rectOf(d, S, outer.id), w: 0 });
  const gi = d.groups.find((g) => g.id === inner.id)!;
  const widened = resizeFrame(d, S, inner.id, { ...rectOf(d, S, inner.id), w: gi.w + 200 });
  // the parent holds its children without overlap
  const fits = (doc: Doc) => {
    const o = rectOf(doc, S, outer.id);
    const kids = [inner.id, ids[2]!, ids[3]!].map((id) => rectOf(doc, S, id));
    return kids.every(
      (a, i) =>
        a.x >= o.x &&
        a.x + a.w <= o.x + o.w &&
        a.y + a.h <= o.y + o.h &&
        kids.slice(i + 1).every((b) => !overlap(a, b)),
    );
  };
  // the re-pack of the parent comes from `also`: without it the widened child overlaps its siblings
  expect(fits(settle(d, widened, S))).toBe(false);
  expect(fits(settle(d, widened, S, [outer.id]))).toBe(true);
});

test('narrowing a STACK frame keeps its children and re-packs them to the width', () => {
  const { doc, ids } = mods(['src', 0, 0], ['fx', 300, 0], ['sink', 600, 0]);
  const g = frameSelection(doc, S, ids);
  const wide = setLayout(g.doc, S, g.id, 'stack');
  const narrow = resizeFrame(wide, S, g.id, { ...rectOf(wide, S, g.id), w: 0 });
  expect(ids.map((id) => parentOf(narrow, id))).toEqual([g.id, g.id, g.id]);
});

test('extractGroup takes a frame with everything inside and the cables among them; mergeDoc places it with fresh ids', () => {
  const { doc: d0, ids } = mods(['src', 0, 0], ['fx', 400, 0], ['sink', 3000, 0]);
  let doc = connect(d0, S, [ids[0]!, 'out'], [ids[1]!, 'in']);
  doc = connect(doc, S, [ids[1]!, 'out'], [ids[2]!, 'l']); // leaves the frame
  const g1 = frameSelection(doc, S, [ids[0]!, ids[1]!]);
  const g2 = frameSelection(g1.doc, S, [ids[1]!]);
  const group = extractGroup(g2.doc, g1.id);
  expect(group.modules.map((m) => m.id).sort()).toEqual([ids[0], ids[1]].sort());
  expect(group.groups.map((g) => g.id).sort()).toEqual([g1.id, g2.id].sort());
  expect(group.cables).toEqual([{ from: [ids[0], 'out'], to: [ids[1], 'in'] }]);
  expect(group.groups.find((g) => g.id === g1.id)!.parent).toBeNull();

  const { doc: twice, map } = mergeDoc(g2.doc, group, 5000, 0);
  const fresh = Object.values(map);
  expect(fresh).toHaveLength(4);
  const before = new Set([...g2.doc.modules.map((m) => m.id), ...g2.doc.groups.map((g) => g.id)]);
  expect(fresh.some((id) => before.has(id))).toBe(false);
  expect(new Set(fresh).size).toBe(4);
  expect(twice.cables).toContainEqual({ from: [map[ids[0]!], 'out'], to: [map[ids[1]!], 'in'] });
  expect(twice.groups.find((g) => g.id === map[g2.id])!.parent).toBe(map[g1.id]);
  expect(rectOf(twice, S, map[g1.id]!).x).toBe(rectOf(g2.doc, S, g1.id).x + 5000);
  expect(twice.nextId).toBeGreaterThan(Math.max(...fresh.map((id) => Number(id.slice(1)))));
});

// Collapsed frames (spec §5): blocks, their jacks, hidden cables
function collapsedFixture() {
  let doc = emptyDoc;
  const add = (type: string, x: number, y: number) => {
    const a = addModule(doc, SPECS, type, x, y);
    doc = a.doc;
    return a.id;
  };
  const osc = add('osc', 0, 0);
  const filter = add('filter', 400, 0);
  const out = add('out', 1600, 0);
  const lfo = add('osc', 0, 1200);
  doc = connect(doc, SPECS, [osc, 'out'], [filter, 'in']);
  doc = connect(doc, SPECS, [filter, 'lp'], [out, 'l']);
  doc = connect(doc, SPECS, [lfo, 'out'], [filter, '@cutoff']);
  const f = frameSelection(doc, SPECS, [osc, filter]);
  return { doc: setCollapsed(f.doc, [f.id], true), g: f.id, osc, filter, out, lfo };
}

test('a collapsed frame lists its crossing ports', () => {
  const { doc, g, filter } = collapsedFixture();
  const b = blockOf(doc, SPECS, g);
  expect(b.w).toBe(352);
  expect(b.h).toBe(96);
  expect(b.jacks.filter((j) => j.dir === 'in').map((j) => [j.id, j.port, j.label])).toEqual([
    [filter, '@cutoff', 'FILTER › CUT'],
  ]);
  const outs = b.jacks.filter((j) => j.dir === 'out');
  expect(outs.map((j) => j.label)).toEqual(['FILTER › LP']);
  expect(outs[0]).toMatchObject({ x: 340, y: 28 + 8 + 12 });
  // a second cable from the same port is the same jack
  const extra = addModule(doc, SPECS, 'out', 1600, 400);
  const d2 = connect(extra.doc, SPECS, [filter, 'lp'], [extra.id, 'l']);
  expect(blockOf(d2, SPECS, g).jacks.filter((j) => j.dir === 'out')).toHaveLength(1);
});

test('cables end on the block; the ones inside are hidden', () => {
  const { doc, g, osc, filter, out } = collapsedFixture();
  const gr = doc.groups.find((x) => x.id === g)!;
  const j = blockOf(doc, SPECS, g).jacks.find((x) => x.dir === 'out')!;
  expect(jackAt(doc, SPECS, filter, 'lp')).toEqual({ x: gr.x + j.x, y: gr.y + j.y });
  const [c1, c2] = [doc.cables.find((c) => c.from[0] === osc)!, doc.cables.find((c) => c.to[0] === out)!];
  expect(cableHidden(doc, c1)).toBe(true);
  expect(cableHidden(doc, c2)).toBe(false);
});

test('two collapsed frames cabled together keep that cable; a frame CLK OUT into itself is hidden', () => {
  const { doc, g, osc, filter, out } = collapsedFixture();
  const f2 = frameSelection(doc, SPECS, [out]);
  const d = setCollapsed(f2.doc, [f2.id], true);
  const c = d.cables.find((x) => x.to[0] === out)!;
  expect(cableHidden(d, c)).toBe(false);
  const mine = blockOf(d, SPECS, g).jacks.find((x) => x.id === filter && x.port === 'lp')!;
  const theirs = blockOf(d, SPECS, f2.id).jacks.find((x) => x.id === out)!;
  expect(jackAt(d, SPECS, filter, 'lp')).toEqual({
    x: d.groups.find((x) => x.id === g)!.x + mine.x,
    y: d.groups.find((x) => x.id === g)!.y + mine.y,
  });
  expect(jackAt(d, SPECS, out, 'l')).toEqual({
    x: d.groups.find((x) => x.id === f2.id)!.x + theirs.x,
    y: d.groups.find((x) => x.id === f2.id)!.y + theirs.y,
  });
  const patched = {
    ...d,
    cables: [...d.cables, { from: [g, 'clkOut'] as [string, string], to: [osc, 'sync'] as [string, string] }],
  };
  expect(cableHidden(patched, patched.cables.at(-1)!)).toBe(true);
  const gr = d.groups.find((x) => x.id === g)!;
  expect(jackAt(d, SPECS, g, 'clkOut')).toEqual({ x: gr.x + 352, y: gr.y + 14 });
  expect(jackAt(d, SPECS, g, 'clkIn')).toEqual({ x: gr.x, y: gr.y + 14 });
});

test('nested collapsed frames: the outermost owns', () => {
  const { doc, g, filter, osc } = collapsedFixture();
  const outer = frameSelection(doc, SPECS, [g]);
  const d = setCollapsed(outer.doc, [outer.id], true);
  expect(blockOwner(d, filter)).toBe(outer.id);
  expect(blockOwner(d, g)).toBe(outer.id);
  expect(blockOwner(d, outer.id)).toBeNull();
  expect(blockOwner(setCollapsed(d, [outer.id], false), osc)).toBe(g);
  expect(blockOf(d, SPECS, outer.id).jacks.map((j) => j.label)).toEqual(['FILTER › CUT', 'FILTER › LP']);
});

test('toggleCollapsedAll collapses all when any is expanded, else expands all', () => {
  const { doc } = collapsedFixture();
  const two = frameSelection(doc, SPECS, ['m3']);
  expect(toggleCollapsedAll(two.doc).groups.every((x) => x.collapsed)).toBe(true);
  const all = toggleCollapsedAll(two.doc);
  expect(toggleCollapsedAll(all).groups.some((x) => x.collapsed)).toBe(false);
});

test('collapsed survives a save and extractGroup; absent means expanded', () => {
  const { doc, g } = collapsedFixture();
  const back = validateDoc(JSON.parse(JSON.stringify(doc)), SPECS)!;
  expect(back.groups.find((x) => x.id === g)!.collapsed).toBe(true);
  expect(extractGroup(doc, g).groups[0]!.collapsed).toBe(true);
  const plain = JSON.parse(JSON.stringify(doc));
  delete plain.groups[0].collapsed;
  expect(validateDoc(plain, SPECS)!.groups[0]!.collapsed).toBe(false);
});

// A collapsed frame's room stays free (spec §5: neighbours do not move)
function roomFixture() {
  let doc = emptyDoc;
  const ids: string[] = [];
  for (const [x, y] of [
    [0, 0],
    [400, 0],
    [0, 300],
    [400, 300],
  ] as const) {
    const a = addModule(doc, SPECS, 'osc', x, y);
    doc = a.doc;
    ids.push(a.id);
  }
  const o = addModule(doc, SPECS, 'out', 1600, 1200);
  const f = frameSelection(o.doc, SPECS, ids);
  const doc2 = setCollapsed(f.doc, [f.id], true);
  const g = doc2.groups.find((x) => x.id === f.id)!;
  const block = blockOf(doc2, SPECS, f.id);
  return { doc: doc2, g, out: o.id, block, ids };
}

test('moving a module into the room under a collapsed block does not join the frame', () => {
  const { doc, g, out, block } = roomFixture();
  expect(g.h).toBeGreaterThan(block.h + 200);
  const m = doc.modules.find((x) => x.id === out)!;
  const moved = moveObjects(doc, SPECS, [out], g.x + 40 - m.x, g.y + block.h + 100 - m.y);
  const mo = moved.modules.find((x) => x.id === out)!;
  expect(mo.parent).toBeNull();
  expect(blockOwner(moved, out)).toBeNull();
});

test('a module added in the room under a collapsed block stays outside it', () => {
  const { doc, g, block } = roomFixture();
  const a = addModule(doc, SPECS, 'osc', g.x + 40, g.y + block.h + 100);
  const moved = moveObjects(a.doc, SPECS, [a.id], 0, 0);
  expect(moved.modules.find((x) => x.id === a.id)!.parent).toBeNull();
  expect(blockOwner(moved, a.id)).toBeNull();
});

test('a frame dropped into the room under a collapsed block does not nest, and landingFrame agrees', () => {
  const { doc, g, block } = roomFixture();
  const f = frameSelection(doc, SPECS, [doc.modules.find((m) => m.type === 'out')!.id]);
  const dx = g.x + 40 - rectOf(f.doc, SPECS, f.id).x;
  const dy = g.y + block.h + 100 - rectOf(f.doc, SPECS, f.id).y;
  expect(landingFrame(f.doc, SPECS, [f.id], dx, dy)).toBeNull();
  const moved = moveObjects(f.doc, SPECS, [f.id], dx, dy);
  expect(moved.groups.find((x) => x.id === f.id)!.parent).toBeNull();
});

test('a collapsed frame moved inside another frame by its block joins it', () => {
  const { doc, g } = roomFixture();
  const o = addModule(doc, SPECS, 'out', 3000, 0);
  const big = frameSelection(o.doc, SPECS, [o.id]);
  const F = big.doc.groups.find((x) => x.id === big.id)!;
  // F is smaller than the collapsed frame's full rect, but larger than its block
  const withF: Doc = {
    ...big.doc,
    groups: big.doc.groups.map((x) => (x.id === F.id ? { ...x, x: 3000, y: 2000, w: 600, h: 400 } : x)),
  };
  const dx = 3100 - g.x;
  const dy = 2100 - g.y;
  expect(landingFrame(withF, SPECS, [g.id], dx, dy)).toBe(F.id);
  const moved = moveObjects(withF, SPECS, [g.id], dx, dy);
  expect(moved.groups.find((x) => x.id === g.id)!.parent).toBe(F.id);
});

test('the re-pack loop that runs out of rounds keeps the shortest pack, and a stable order is returned as it is', () => {
  const item = (id: string) => ({ id, r: { x: 0, y: 0, w: 100, h: 100 } });
  const [a, b] = [item('a'), item('b')];
  // a forced two-cycle: whichever child comes first is placed lower, so the next reading order is the reverse
  const chase = (order: { id: string }[]) => ({
    at: new Map(order.map((k, i) => [k.id, { x: 0, y: i === 0 ? 100 : 0 }])),
    w: 100,
    h: order[0]!.id === 'a' ? 50 : 60,
  });
  const res = fixedOrder([b, a], 400, chase);
  expect(res.order.map((k) => k.id)).toEqual(['a', 'b']);
  expect(res.packed.h).toBe(50);
  expect(fixedOrder([a, b], 400, chase).order.map((k) => k.id)).toEqual(['a', 'b']);
  // a pack that agrees with its order is a fixed point at once
  const calm = (order: { id: string }[]) => ({
    at: new Map(order.map((k, i) => [k.id, { x: 0, y: i * 100 }])),
    w: 100,
    h: 200,
  });
  expect(fixedOrder([a, b], 400, calm).order.map((k) => k.id)).toEqual(['a', 'b']);
});

test('a free child frame of an off-grid width leaves the next child on the 8 px grid in a STACK', () => {
  const m = addModule(emptyDoc, SPECS, 'osc', 0, 0);
  const inner = frameSelection(m.doc, SPECS, [m.id]);
  const o = addModule(inner.doc, SPECS, 'osc', 4000, 4000);
  const outer = frameSelection(o.doc, SPECS, [inner.id, o.id]);
  let d = setLayout(outer.doc, SPECS, inner.id, 'free');
  d = {
    ...d,
    groups: d.groups.map((g) =>
      g.id === inner.id ? { ...g, w: 357 } : g.id === outer.id ? { ...g, w: 1200 } : g,
    ),
  };
  const packed = packFrame(d, SPECS, outer.id);
  const og = rectOf(packed, SPECS, outer.id);
  const ri = rectOf(packed, SPECS, inner.id);
  const rm = rectOf(packed, SPECS, o.id);
  expect(ri.w).toBe(357);
  for (const r of [ri, rm]) expect((r.x - og.x - GPAD) % 8).toBe(0);
  expect(Math.abs(rm.x - ri.x) >= 357 || Math.abs(rm.y - ri.y) >= ri.h).toBe(true);
});

test('opening a document re-fits a STACK parent around a former WIRE FIX child', () => {
  const { w, h } = layoutPanel(SPECS['osc']!);
  const m = (id: string, x: number, y: number, parent: string) => ({
    id,
    type: 'osc',
    x,
    y,
    parent,
    params: {},
    atts: {},
    ratios: {},
  });
  const raw = {
    version: 1,
    modules: [m('m1', 32, 60, 'g2'), m('m2', 32 + w + 32, 60, 'g2'), m('m3', 32, 60 + h + 32, 'g2')],
    cables: [],
    groups: [
      { id: 'g1', name: 'A', x: 0, y: 0, w: 1200, h: 900, parent: null, layout: 'stack' },
      { id: 'g2', name: 'B', x: 16, y: 44, w: 1000, h: 800, parent: 'g1', layout: 'route' },
    ],
    nextId: 9,
  };
  const v = validateDoc(raw, SPECS)!;
  const [g1, g2] = ['g1', 'g2'].map((id) => rectOf(v, SPECS, id));
  expect(g2!.h).toBeLessThan(800);
  expect(g1!.h).toBe(GHEAD + 2 * GPAD + g2!.h); // fitted around the shrunken child, nothing else in it
  expect(g1!.h).toBeLessThan(900);
  for (const id of ['g1', 'g2']) expect(packFrame(v, SPECS, id)).toEqual(v);
});

test('a block with four jacks a side grows with them: rows at 48, 72, 96, 120', () => {
  let doc = emptyDoc;
  const add = (type: string, x: number, y: number) => {
    const a = addModule(doc, SPECS, type, x, y);
    doc = a.doc;
    return a.id;
  };
  const att = add('att', 600, 0);
  const oscs = [0, 1, 2, 3].map((i) => add('osc', 0, i * 200));
  const outs = [add('out', 1600, 0), add('out', 1600, 400)];
  oscs.forEach((o, i) => (doc = connect(doc, SPECS, [o, 'out'], [att, `in${i + 1}`])));
  [outs[0]!, outs[0]!, outs[1]!, outs[1]!].forEach((o, i) => {
    doc = connect(doc, SPECS, [att, `out${i + 1}`], [o, i % 2 ? 'r' : 'l'], );
  });
  const f = frameSelection(doc, SPECS, [att]);
  const b = blockOf(setCollapsed(f.doc, [f.id], true), SPECS, f.id);
  expect(b.h).toBe(GHEAD + 16 + 96);
  expect(b.jacks.filter((j) => j.dir === 'in').map((j) => j.y)).toEqual([48, 72, 96, 120]);
  expect(b.jacks.filter((j) => j.dir === 'out').map((j) => j.y)).toEqual([48, 72, 96, 120]);
});
