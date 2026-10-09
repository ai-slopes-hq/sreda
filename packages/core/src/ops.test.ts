import { expect, test } from 'vitest';
import { emptyDoc } from './doc';
import { nameOf } from './names';
import {
  addModule,
  canInsert,
  connect,
  duplicate,
  insertIntoCable,
  randomise,
  replaceModule,
  deleteObjects,
  moveObjects,
  removeCable,
  RuleError,
  setAtt,
  setParam,
  setRatio,
} from './ops';
import { SPECS } from './spec';
import { TEST_SPECS as S } from './testspecs';

function two() {
  const a = addModule(emptyDoc, S, 'src', 3, 5);
  const b = addModule(a.doc, S, 'fx', 203, 0);
  return { doc: b.doc, src: a.id, fx: b.id };
}

test('ids are never reused and positions snap to 8', () => {
  const { doc, src, fx } = two();
  expect([src, fx]).toEqual(['m1', 'm2']);
  expect(doc.modules[0]).toMatchObject({ x: 0, y: 8 });
  const gone = deleteObjects(doc, [fx]);
  expect(addModule(gone, S, 'src', 0, 0).id).toBe('m3');
  expect(moveObjects(doc, S, [src], 13, -2).modules[0]).toMatchObject({ x: 16, y: 8 });
});

test('an unknown type throws', () => {
  expect(() => addModule(emptyDoc, S, 'nope', 0, 0)).toThrow(RuleError);
});

test('two cables into one input are both kept; an identical third is ignored', () => {
  let { doc, src, fx } = two();
  const s2 = addModule(doc, S, 'src', 0, 200);
  doc = connect(s2.doc, S, [src, 'out'], [fx, 'in']);
  doc = connect(doc, S, [s2.id, 'out'], [fx, 'in']);
  const again = connect(doc, S, [src, 'out'], [fx, 'in']);
  expect(doc.cables).toHaveLength(2);
  expect(again).toBe(doc);
});

test('connect works from either end', () => {
  const { doc, src, fx } = two();
  expect(connect(doc, S, [fx, 'in'], [src, 'out']).cables).toEqual([{ from: [src, 'out'], to: [fx, 'in'] }]);
});

test('output to output and input to input throw', () => {
  const { doc, src, fx } = two();
  expect(() => connect(doc, S, [src, 'out'], [fx, 'out'])).toThrow(RuleError);
  expect(() => connect(doc, S, [fx, 'in'], [fx, 'cv'])).toThrow(RuleError);
  expect(() => connect(doc, S, [src, 'nope'], [fx, 'in'])).toThrow(RuleError);
});

test('a self-patch is allowed', () => {
  const { doc, fx } = two();
  expect(connect(doc, S, [fx, 'out'], [fx, 'in']).cables).toHaveLength(1);
});

test('deleting a module removes its cables; removeCable removes one', () => {
  const { doc: d0, src, fx } = two();
  const doc = connect(d0, S, [src, 'out'], [fx, 'in']);
  expect(deleteObjects(doc, [src]).cables).toEqual([]);
  expect(removeCable(doc, { from: [src, 'out'], to: [fx, 'in'] }).cables).toEqual([]);
});

test('params, attenuverters and ratios', () => {
  const { doc, fx } = two();
  expect(setParam(doc, S, fx, 'amt', 1.4).modules[1]!.params['amt']).toBe(1);
  expect(setParam(doc, S, fx, 'cyc', 5).modules[1]!.params['cyc']).toBe(1);
  expect(setAtt(doc, fx, 'cv', -0.25).modules[1]!.atts).toEqual({ cv: -0.25 });
  expect(setAtt(setAtt(doc, fx, 'cv', 0.3), fx, 'cv', null).modules[1]!.atts).toEqual({});
  expect(setRatio(doc, fx, 'clk', -3).modules[1]!.ratios).toEqual({ clk: -3 });
  expect(() => setRatio(doc, fx, 'clk', 0)).toThrow(RuleError);
  expect(() => setRatio(doc, fx, 'clk', 9)).toThrow(RuleError);
});

test('same-type modules are numbered in names', () => {
  const { doc, src, fx } = two();
  expect(nameOf(doc, S, src)).toBe('SRC');
  const b = addModule(doc, S, 'src', 0, 300);
  expect([nameOf(b.doc, S, src), nameOf(b.doc, S, b.id), nameOf(b.doc, S, fx)]).toEqual([
    'SRC 1',
    'SRC 2',
    'FX',
  ]);
});

test('a plain-object key is not a module type', () => {
  expect(() => addModule(emptyDoc, S, 'constructor', 0, 0)).toThrow(RuleError);
});

test('a frame clock cannot be added as a module', () => {
  expect(() => addModule(emptyDoc, S, 'clock', 0, 0)).toThrow(RuleError);
});

test('a free module inserted into a cable splits it: source → its input, its output → the old target', async () => {
  const { SPECS, starterDoc } = await import('./index');
  const added = addModule(starterDoc(SPECS), SPECS, 'filter', 600, 400);
  const cable = added.doc.cables[0]!;
  expect(canInsert(added.doc, SPECS, added.id)).toBe(true);
  const d = insertIntoCable(added.doc, SPECS, added.id, cable);
  expect(d.cables).toEqual([
    { from: ['m1', 'out'], to: [added.id, 'in'] },
    { from: [added.id, 'lp'], to: ['m2', 'l'] },
  ]);
  expect(canInsert(d, SPECS, added.id)).toBe(false);
  expect(canInsert(d, SPECS, 'm1')).toBe(false);
});

test('inserting into a trigger cable prefers trigger ports', () => {
  const { doc, src, fx } = two();
  const third = addModule(doc, S, 'fx', 600, 0);
  const d0 = connect(third.doc, S, [fx, 'eoc'], [third.id, 'clk']);
  const mid = addModule(d0, S, 'fx', 300, 300);
  const d = insertIntoCable(mid.doc, S, mid.id, d0.cables[0]!);
  expect(d.cables).toEqual([
    { from: [fx, 'eoc'], to: [mid.id, 'clk'] },
    { from: [mid.id, 'eoc'], to: [third.id, 'clk'] },
  ]);
  void src;
});

test('replace: knobs keep their value by id, cables follow port id then role, the place and frame stay', async () => {
  const { SPECS, starterDoc, frameSelection, fromKnob } = await import('./index');
  const freq = (type: string) => SPECS[type]!.params.find((p) => p.id === 'freq')!;
  let doc = starterDoc(SPECS);
  doc = setParam(doc, SPECS, 'm1', 'freq', 0.6);
  const hz = fromKnob(freq('osc') as never, 0.6);
  const lfo = addModule(doc, SPECS, 'slope', 0, 400);
  doc = connect(lfo.doc, SPECS, [lfo.id, 'out'], ['m1', 'pitch']);
  doc = frameSelection(doc, SPECS, ['m1']).doc;
  const osc = doc.modules.find((m) => m.id === 'm1')!;
  const { doc: d, id } = replaceModule(doc, SPECS, 'm1', 'complex');
  const c = d.modules.find((m) => m.id === id)!;
  expect(c).toMatchObject({ type: 'complex', x: osc.x, y: osc.y, parent: osc.parent });
  expect(fromKnob(freq('complex') as never, c.params['freq']!)).toBeCloseTo(hz, 3);
  expect(d.cables).toContainEqual({ from: [lfo.id, 'out'], to: [id, 'pitch'] });
  expect(d.cables).toContainEqual({ from: [id, 'out'], to: ['m2', 'l'] });
  expect(d.modules.some((m) => m.id === 'm1')).toBe(false);
});

test('replace FILTER by FOLD: IN stays, LP moves to OUT, BP and HP have no match and go', async () => {
  const { SPECS } = await import('./index');
  let doc = addModule(emptyDoc, SPECS, 'noise', 0, 0).doc;
  doc = addModule(doc, SPECS, 'filter', 300, 0).doc;
  doc = addModule(doc, SPECS, 'mix', 600, 0).doc;
  doc = connect(doc, SPECS, ['m1', 'white'], ['m2', 'in']);
  for (const [o, i] of [
    ['lp', 'a'],
    ['bp', 'b'],
    ['hp', 'c'],
  ] as const)
    doc = connect(doc, SPECS, ['m2', o], ['m3', i]);
  const { doc: d, id } = replaceModule(doc, SPECS, 'm2', 'fold');
  expect(d.cables).toEqual([
    { from: ['m1', 'white'], to: [id, 'in'] },
    { from: [id, 'out'], to: ['m3', 'a'] },
  ]);
});

test('⌘D copies the selected modules with the cables between them, 32 px right and down, with fresh ids', () => {
  const { doc: d0, src, fx } = two();
  const third = addModule(d0, S, 'sink', 600, 0);
  let doc = connect(third.doc, S, [src, 'out'], [fx, 'in']);
  doc = connect(doc, S, [fx, 'out'], [third.id, 'l']);
  const { doc: d, ids } = duplicate(doc, S, [src, fx]);
  expect(ids).toEqual(['m4', 'm5']);
  expect(d.modules.find((m) => m.id === 'm4')).toMatchObject({ type: 'src', x: 32, y: 40 });
  expect(d.cables.filter((c) => ids.includes(c.from[0]) || ids.includes(c.to[0]))).toEqual([
    { from: ['m4', 'out'], to: ['m5', 'in'] },
  ]);
});

test('R sets every visible knob within its random range and leaves options and hidden params alone', async () => {
  const { SPECS, fromKnob } = await import('./index');
  const doc = addModule(emptyDoc, SPECS, 'osc', 0, 0).doc;
  const before = doc.modules[0]!.params;
  let n = 0;
  const d = randomise(doc, SPECS, 'm1', () => [0, 0.999, 0.5][n++ % 3]!);
  const after = d.modules[0]!.params;
  for (const p of SPECS['osc']!.params) {
    if (p.kind !== 'knob' || p.hidden) {
      if (p.kind !== 'action') expect(after[p.id]).toBe(before[p.id]);
      continue;
    }
    const [lo, hi] = p.randomRange ?? [p.min, p.max];
    const v = fromKnob(p, after[p.id]!);
    expect(v).toBeGreaterThanOrEqual(lo - 1e-9);
    expect(v).toBeLessThanOrEqual(hi + 1e-9);
  }
  expect(after['freq']).not.toBe(before['freq']);
});

test('replacing a SAMPLER by GRAINS keeps its sample; by OSC drops it', () => {
  const added = addModule(emptyDoc, SPECS, 'sampler', 0, 0);
  const doc = { ...added.doc, modules: added.doc.modules.map((m) => ({ ...m, sample: 'pads/air.wav' })) };
  const g = replaceModule(doc, SPECS, added.id, 'grains');
  expect(g.doc.modules.find((m) => m.id === g.id)!.sample).toBe('pads/air.wav');
  const o = replaceModule(doc, SPECS, added.id, 'osc');
  expect(o.doc.modules.find((m) => m.id === o.id)!.sample).toBeUndefined();
});
