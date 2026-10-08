import { expect, test } from 'vitest';
import { emptyDoc } from './doc';
import { nameOf } from './names';
import {
  addModule,
  connect,
  deleteObjects,
  moveObjects,
  removeCable,
  RuleError,
  setAtt,
  setParam,
  setRatio,
} from './ops';
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
