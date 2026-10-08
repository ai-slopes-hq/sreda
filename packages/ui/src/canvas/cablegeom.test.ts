import {
  addModule,
  connect,
  emptyDoc,
  frameSelection,
  moveObjects,
  rectOf,
  RGAP,
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
const axisAligned = (pts: { x: number; y: number }[]) =>
  pts.slice(1).every((p, i) => Math.abs(p.x - pts[i]!.x) < 1e-9 || Math.abs(p.y - pts[i]!.y) < 1e-9);

test('in WIRE FIX, a cable to the next module in the row goes straight across, with a mid-gap step when jacks differ', () => {
  const { doc: d0, ids } = mods(['src', 0, 0], ['fx', 400, 0]);
  let doc = connect(d0, S, [ids[0]!, 'out'], [ids[1]!, 'in']);
  doc = connect(doc, S, [ids[0]!, 'out'], [ids[1]!, 'cv']);
  doc = frameSelection(doc, S, ids).doc;
  const [level, step] = cableGeoms(doc, S);
  expect(level!.routed).toBe(doc.groups[0]!.id);
  expect(level!.pts).toHaveLength(2);
  expect(step!.pts).toHaveLength(4);
  const a = rectOf(doc, S, ids[0]!);
  expect(step!.pts[1]!.x).toBe(a.x + a.w + RGAP / 2);
  expect(axisAligned(step!.pts)).toBe(true);
});

test('in WIRE FIX, a cable to the next row runs out right, up the channel, along the trunk and down into the jack', () => {
  const { doc: d0, ids } = mods(['src', 0, 0], ['fx', 400, 40], ['sink', 0, 400]);
  const doc = frameSelection(connect(d0, S, [ids[0]!, 'out'], [ids[2]!, 'l']), S, ids).doc;
  const g = doc.groups[0]!;
  const [geom] = cableGeoms(doc, S);
  const a = rectOf(doc, S, ids[0]!);
  const b = rectOf(doc, S, ids[2]!);
  expect(b.y).toBeGreaterThan(a.y); // the sink is on the second row
  const lane = 6;
  const p = geom!.pts;
  expect(p[1]).toEqual({ x: a.x + a.w + lane, y: p[0]!.y }); // out to the channel on its right
  expect(p[2]).toEqual({ x: a.x + a.w + lane, y: a.y - lane }); // up into the channel above its row
  expect(p[3]).toEqual({ x: g.x + lane, y: a.y - lane }); // along to the trunk
  expect(p[4]).toEqual({ x: g.x + lane, y: b.y - lane }); // down the trunk
  expect(p[5]).toEqual({ x: b.x - lane, y: b.y - lane }); // to the channel left of the target
  expect(axisAligned(p)).toBe(true);
  expect(geom!.d).toMatch(/^M[^C]*$/); // lines and rounded corners, no curves
});

test('a cable outside WIRE FIX is a curve; moving one module recomputes only its cables', () => {
  const { doc: d0, ids } = mods(['src', 0, 0], ['fx', 400, 0], ['src', 0, 400], ['sink', 800, 400]);
  let doc = connect(d0, S, [ids[0]!, 'out'], [ids[1]!, 'in']);
  doc = connect(doc, S, [ids[2]!, 'out'], [ids[3]!, 'l']);
  doc = connect(doc, S, [ids[1]!, 'out'], [ids[3]!, 'r']);
  const first = cableGeoms(doc, S);
  expect(first[0]!.routed).toBeNull();
  expect(first[0]!.d).toContain('C');
  const before = geomStats.computed;
  cableGeoms(moveObjects(doc, S, [ids[0]!], 0, 80), S);
  expect(geomStats.computed - before).toBe(1);
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
