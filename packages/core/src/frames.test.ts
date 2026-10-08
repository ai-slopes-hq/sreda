import { expect, test } from 'vitest';
import { emptyDoc, type Doc } from './doc';
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
  const big = resizeFrame(b.doc, S, b.id, { x: 2000, y: -500, w: 3000, h: 2000 });
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

test('STACK packs flush rows 16 px inside the frame and fits the frame with equal margins; FIX goes off', () => {
  const { doc, ids, gid } = three();
  const d = packFrame(doc, S, gid, 'stack');
  const g = rectOf(d, S, gid);
  const r = rectsOf(d, ids);
  expect(d.groups[0]!.layout).toBe('free');
  // one row of three would be wider than packWidth (√(3·200·176)·1.6 → 520): two, then one
  expect(r.map((x) => [x.x - g.x, x.y - g.y])).toEqual([
    [GPAD, GHEAD + GPAD],
    [GPAD + 168, GHEAD + GPAD],
    [GPAD, GHEAD + GPAD + 144],
  ]);
  expect(g.w).toBe(GPAD + 2 * 168 + GPAD);
  expect(g.x + g.w - (r[1]!.x + r[1]!.w)).toBe(GPAD);
  expect(g.y + g.h - (r[2]!.y + r[2]!.h)).toBe(GPAD);
});

test('pressing STACK or FIX again changes nothing; switching keeps the rows and their order', () => {
  const { doc, ids, gid } = three();
  const stacked = packFrame(doc, S, gid, 'stack');
  expect(packFrame(stacked, S, gid, 'stack')).toEqual(stacked);
  const fixed = setLayout(stacked, S, gid, 'route');
  expect(fixed.groups[0]!.layout).toBe('route');
  expect(setLayout(fixed, S, gid, 'route')).toEqual(fixed);
  const order = (d: Doc) =>
    [...ids].sort((a, b) => rectOf(d, S, a).y - rectOf(d, S, b).y || rectOf(d, S, a).x - rectOf(d, S, b).x);
  expect(order(fixed)).toEqual(order(stacked));
  const back = packFrame(fixed, S, gid, 'stack');
  expect(back).toEqual(stacked);
  // FIX off keeps the layout, only the routing goes
  const off = setLayout(fixed, S, gid, 'free');
  expect(off.modules).toEqual(fixed.modules);
});

test('a WIRE FIX frame re-packs when a module is dropped into it, and when its last module leaves', () => {
  const { doc, ids } = mods(['src', 0, 0], ['fx', 2000, 0]);
  const g = frameSelection(doc, S, [ids[0]!]);
  const before = g.doc;
  const dropped = moveObjects(before, S, [ids[1]!], -1900, 0);
  const settled = settle(before, dropped, S);
  const r = rectsOf(settled, ids);
  expect(r[1]!.y).toBe(r[0]!.y); // packed into the row
  expect(r[1]!.x - (r[0]!.x + r[0]!.w)).toBe(RGAP);
  // the last module leaves: the empty frame is the minimum, and every number is a number
  const out = moveObjects(settled, S, ids, 0, 3000);
  const empty = rectOf(settle(settled, out, S), S, g.id);
  expect(empty).toMatchObject({ w: 352, h: 96 });
  expect(Object.values(empty).every(Number.isFinite)).toBe(true);
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
