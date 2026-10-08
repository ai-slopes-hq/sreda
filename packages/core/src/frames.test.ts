import { expect, test } from 'vitest';
import { emptyDoc, type Doc } from './doc';
import {
  descendants,
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

test('G fits a frame around the selection: 16 px padding, the header above, named GROUP n', () => {
  const { doc, ids } = mods(['src', 400, 400], ['fx', 800, 400]);
  const { doc: d, id } = frameSelection(doc, S, ids);
  const g = d.groups.find((x) => x.id === id)!;
  expect(id).toBe('g3');
  expect(g).toMatchObject({
    name: 'GROUP 1',
    x: 400 - GPAD,
    y: 400 - GPAD - GHEAD,
    w: 968 - 400 + 2 * GPAD,
    h: 144 + 2 * GPAD + GHEAD,
    parent: null,
    ratio: 1,
    tint: 0,
    layout: 'free',
    muted: false,
    clock: { on: false, bpm: 120 },
  });
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
  expect(moved.modules[0]).toMatchObject({ x: 40, y: 80, parent: g.id });
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
  expect(rectOf(resizeFrame(g.doc, S, g.id, { ...r, w: 10, h: 10 }), S, g.id)).toMatchObject({ w: 352, h: 96 });
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
