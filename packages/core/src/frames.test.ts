import { expect, test } from 'vitest';
import { emptyDoc, validateDoc, type Doc } from './doc';
import { SPECS } from './spec';
import {
  descendants,
  extractGroup,
  mergeDoc,
  packFrame,
  RGAP,
  setLayout,
  settle,
  effectiveMuted,
  frameSelection,
  GHEAD,
  GPAD,
  jackAt,
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

test('G frames the selection in WIRE FIX: placed where it fits, packed in rows with 32 px channels, GROUP n', () => {
  const { doc, ids } = mods(['src', 400, 400], ['fx', 800, 400]);
  const { doc: d, id } = frameSelection(doc, S, ids);
  const g = d.groups.find((x) => x.id === id)!;
  expect(id).toBe('g3');
  // the top-left where 16 px padding and the header fit the selection; then packed: one row, 32 px around and between
  expect(g).toMatchObject({
    name: 'GROUP 1',
    x: 400 - GPAD,
    y: 400 - GPAD - GHEAD,
    w: RGAP + 168 + RGAP + 168 + RGAP,
    h: GHEAD + RGAP + 144 + RGAP,
    parent: null,
    ratio: 1,
    tint: 0,
    layout: 'route',
    muted: false,
    clock: { on: false, bpm: 120 },
  });
  expect(d.modules.map((m) => [m.x - g.x, m.y - g.y])).toEqual([
    [RGAP, GHEAD + RGAP],
    [RGAP + 168 + RGAP, GHEAD + RGAP],
  ]);
  expect(ids.map((m) => parentOf(d, m))).toEqual([id, id]);
  const more = addModule(d, S, 'src', 2000, 0);
  expect(frameSelection(more.doc, S, [more.id]).doc.groups[1]!.name).toBe('GROUP 2');
});

test('a frame is at least 352 × 96', () => {
  const { doc, ids } = mods(['src', 0, 0]);
  const g = frameSelection(doc, S, ids).doc.groups[0]!;
  expect(g.w).toBe(352);
  expect(g.h).toBe(144 + 2 * RGAP + GHEAD);
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
  expect(moved.modules[0]).toMatchObject({ x: -GPAD + RGAP + 40, y: -GPAD + RGAP + 80, parent: g.id });
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
const rectsOf = (doc: Doc, ids: string[]) => ids.map((id) => rectOf(doc, S, id));

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
  const r = rectsOf2(d, ids);
  for (let i = 0; i < r.length; i++)
    for (let j = i + 1; j < r.length; j++) expect(overlap(r[i]!, r[j]!)).toBe(false);
  const at = (i: number) => [r[i]!.x - g.x - GPAD, r[i]!.y - g.y - GHEAD - GPAD];
  expect(at(3)).toEqual([0, 144]);
  expect(at(4)).toEqual([560, 272]);
  expect(at(6)).toEqual([560, 416]);
  expect(at(7)).toEqual([0, 544]);
  expect(r.every((x) => (x.x - g.x) % 8 === 0 && (x.y - g.y - GHEAD) % 8 === 0)).toBe(true);
});
const rectsOf2 = (doc: Doc, ids: string[]) => ids.map((id) => rectOf(doc, SPECS, id));

test('stack again changes nothing; stack <-> fix keeps width and order', () => {
  const { doc, gid } = patch();
  const stacked = setLayout(doc, SPECS, gid, 'stack');
  expect(setLayout(stacked, SPECS, gid, 'stack')).toBe(stacked);
  const fixed = setLayout(stacked, SPECS, gid, 'route');
  expect(fixed.groups.find((g) => g.id === gid)!.layout).toBe('route');
  expect(rectOf(fixed, SPECS, gid).w).toBe(rectOf(stacked, SPECS, gid).w);
  expect(setLayout(fixed, SPECS, gid, 'route')).toBe(fixed);
  const back = setLayout(fixed, SPECS, gid, 'stack');
  expect(back).toEqual(stacked);
  expect(packFrame(stacked, SPECS, gid)).toEqual(stacked);
  // FIX off keeps the layout, only the mode goes
  const off = setLayout(fixed, SPECS, gid, 'free');
  expect(off.modules).toEqual(fixed.modules);
});

test('a resize of a stack or fix frame re-packs to the new width', () => {
  const { doc, ids, gid } = patch();
  for (const mode of ['stack', 'route'] as const) {
    const d = setLayout(doc, SPECS, gid, mode);
    const r = rectOf(d, SPECS, gid);
    const wide = resizeFrame(d, SPECS, gid, { ...r, w: 1700, x: r.x + 50, y: r.y + 50 });
    const rw = rectOf(wide, SPECS, gid);
    expect(rw).toMatchObject({ x: r.x, y: r.y, w: 1700 });
    expect(rw.h).toBeLessThan(r.h);
    const rs = rectsOf2(wide, ids);
    for (let i = 0; i < rs.length; i++)
      for (let j = i + 1; j < rs.length; j++) expect(overlap(rs[i]!, rs[j]!)).toBe(false);
    const widest = Math.max(...rectsOf2(d, ids).map((x) => x.w));
    const narrow = resizeFrame(d, SPECS, gid, { ...r, w: 100 });
    expect(rectOf(narrow, SPECS, gid).w).toBe(widest + 2 * (mode === 'stack' ? GPAD : RGAP));
  }
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
    for (const mode of ['stack', 'route'] as const) {
      const d = setLayout(free, SPECS, g.id, mode);
      const again = packFrame(d, SPECS, g.id);
      expect(again, `seed ${seed} ${mode}`).toEqual(d);
    }
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
    ['route', 0, 400, 200],
    ['free', 500, 400, 200],
  ]);
  expect(validateDoc(raw(['stack']), SPECS)!.groups[0]!.layout).toBe('stack');
  expect(validateDoc(raw(['spiral']), SPECS)!.groups[0]!.layout).toBe('free');
});

test('a WIRE FIX frame re-packs when a module is dropped into it, and when its last module leaves', () => {
  const { doc, ids } = mods(['src', 0, 0], ['fx', 2000, 0]);
  const g = frameSelection(doc, S, [ids[0]!]);
  // the width stays what it was: wide enough for two modules in a row
  const before = resizeFrame(g.doc, S, g.id, { ...rectOf(g.doc, S, g.id), w: 432 });
  const dropped = moveObjects(before, S, [ids[1]!], -1900, 0);
  const settled = settle(before, dropped, S);
  const r = rectsOf(settled, ids);
  expect(r[1]!.y).toBe(r[0]!.y); // packed into the row
  expect(r[1]!.x - (r[0]!.x + r[0]!.w)).toBe(RGAP);
  // the last module leaves: the empty frame is the minimum, and every number is a number
  const out = moveObjects(settled, S, ids, 0, 3000);
  const empty = rectOf(settle(settled, out, S), S, g.id);
  expect(empty).toMatchObject({ w: 432, h: 96 }); // the width stays
  expect(Object.values(empty).every(Number.isFinite)).toBe(true);
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
  const settled = settle(d, widened, S, [outer.id]);
  const o = rectOf(settled, S, outer.id);
  const kids = [inner.id, ids[2]!, ids[3]!].map((id) => rectOf(settled, S, id));
  for (let i = 0; i < kids.length; i++) {
    const a = kids[i]!;
    expect(a.x >= o.x && a.x + a.w <= o.x + o.w && a.y + a.h <= o.y + o.h).toBe(true);
    for (let j = i + 1; j < kids.length; j++) {
      const b = kids[j]!;
      expect(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y).toBe(true);
    }
  }
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
