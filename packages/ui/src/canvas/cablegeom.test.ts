import {
  addModule,
  connect,
  emptyDoc,
  frameSelection,
  jackAt,
  moveObjects,
  setCollapsed,
  type Doc,
} from '@sreda/core';
import { expect, test } from 'vitest';
import { TEST_SPECS as S } from '../../../core/src/testspecs';
import { cableAt, cableGeoms, geomStats } from './cablegeom';

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
test('every cable is a curve, in a frame or not; moving one module recomputes only its cables', () => {
  const { doc: d0, ids } = mods(['src', 0, 0], ['fx', 400, 0], ['src', 0, 400], ['sink', 800, 400]);
  let doc = connect(d0, S, [ids[0]!, 'out'], [ids[1]!, 'in']);
  doc = connect(doc, S, [ids[2]!, 'out'], [ids[3]!, 'l']);
  doc = connect(doc, S, [ids[1]!, 'out'], [ids[3]!, 'r']);
  const first = cableGeoms(doc, S);
  expect(first.every((g) => g.d.includes('C'))).toBe(true);
  const before = geomStats.computed;
  cableGeoms(moveObjects(doc, S, [ids[0]!], 0, 80), S);
  expect(geomStats.computed - before).toBe(1);
});

test('a cable between modules of a STACK frame is a curve too', () => {
  const { doc: d0, ids } = mods(['src', 0, 0], ['fx', 400, 0]);
  const doc = frameSelection(connect(d0, S, [ids[0]!, 'out'], [ids[1]!, 'in']), S, ids).doc;
  expect(doc.groups[0]!.layout).toBe('stack');
  expect(cableGeoms(doc, S).every((g) => g.d.includes('C'))).toBe(true);
});

test('cableAt finds a cable within the threshold', () => {
  const { doc: d0, ids } = mods(['src', 0, 0], ['fx', 400, 0]);
  const doc = connect(d0, S, [ids[0]!, 'out'], [ids[1]!, 'in']);
  const geoms = cableGeoms(doc, S);
  const y = geoms[0]!.pts[0]!.y; // level jacks: a straight curve
  expect(cableAt(geoms, { x: 300, y: y + 6 }, 6)).toBe(0);
  expect(cableAt(geoms, { x: 300, y: y + 7 }, 6)).toBeNull();
});

test('in the 200-module patch, a move preview of one module recomputes only its own cables', async () => {
  const { bigPatch, SPECS } = await import('@sreda/core');
  const doc = bigPatch(SPECS);
  cableGeoms(doc, SPECS);
  const fold = doc.modules.find((m) => m.type === 'fold')!;
  const before = geomStats.computed;
  cableGeoms(moveObjects(doc, SPECS, [fold.id], 40, 16), SPECS);
  expect(geomStats.computed - before).toBeLessThanOrEqual(4);
});

test('collapsed frames: a cable inside the block has no geometry; a crossing one ends on the block jack', () => {
  const { doc: d0, ids } = mods(['src', 0, 0], ['fx', 400, 0], ['sink', 1200, 0]);
  let doc = connect(d0, S, [ids[0]!, 'out'], [ids[1]!, 'in']);
  doc = connect(doc, S, [ids[1]!, 'out'], [ids[2]!, 'l']);
  const framed = frameSelection(doc, S, [ids[0]!, ids[1]!]);
  const collapsed = setCollapsed(framed.doc, [framed.id], true);
  const geoms = cableGeoms(collapsed, S);
  expect(geoms).toHaveLength(1);
  expect(geoms[0]!.cable.to[0]).toBe(ids[2]);
  expect(geoms[0]!.d).toContain('C');
  const end = jackAt(collapsed, S, ids[1]!, 'out');
  expect(geoms[0]!.pts[0]).toEqual(end);
  expect(cableGeoms(framed.doc, S)).toHaveLength(2);
});
