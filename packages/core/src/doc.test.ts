import { expect, test } from 'vitest';
import { emptyDoc, starterDoc, validateDoc, type Doc } from './doc';
import { SPECS } from './spec';
import { TEST_SPECS } from './testspecs';

const good = (): Doc => ({
  version: 1,
  modules: [
    { id: 'm1', type: 'src', x: 0, y: 0, parent: null, params: { lvl: 0.3 }, atts: {}, ratios: {} },
    { id: 'm2', type: 'fx', x: 200, y: 0, parent: null, params: {}, atts: { cv: -0.5 }, ratios: { clk: 2 } },
  ],
  cables: [{ from: ['m1', 'out'], to: ['m2', 'in'] }],
  groups: [],
  nextId: 3,
});

test('a valid document comes back with missing params filled', () => {
  const d = validateDoc(good(), TEST_SPECS)!;
  expect(d).not.toBeNull();
  expect(d.modules[1]!.params).toEqual({ amt: 0.5, cyc: 0, h: 0.2 });
  expect(d.modules[1]!.atts).toEqual({ cv: -0.5 });
  expect(d.modules[1]!.ratios).toEqual({ clk: 2 });
  expect(d.modules[0]!.params).toEqual({ lvl: 0.3 });
});

test.each([
  ['version 2', (d: Doc) => Object.assign(d, { version: 2 })],
  ['an unknown type', (d: Doc) => (d.modules[0]!.type = 'nope')],
  ['a cable to a missing port', (d: Doc) => (d.cables[0]!.to = ['m2', 'nope'])],
  ['a cable to a missing module', (d: Doc) => (d.cables[0]!.from = ['m9', 'out'])],
  ['a cable from an input', (d: Doc) => (d.cables[0]!.from = ['m2', 'in'])],
  ['a duplicated id', (d: Doc) => (d.modules[1]!.id = 'm1')],
  ['frames (not yet supported)', (d: Doc) => Object.assign(d, { groups: [{ id: 'g1' }] })],
])('rejects %s', (_name, breakIt) => {
  const d = good();
  breakIt(d);
  expect(validateDoc(d, TEST_SPECS)).toBeNull();
});

test('rejects things that are not documents', () => {
  for (const x of [null, 3, 'doc', [], { version: 1 }]) expect(validateDoc(x, TEST_SPECS)).toBeNull();
});

test('a mod jack is a valid cable target', () => {
  const d = good();
  d.cables.push({ from: ['m1', 'out'], to: ['m2', '@amt'] });
  expect(validateDoc(d, TEST_SPECS)).not.toBeNull();
});

test('the starter patch is OSC (saw, 110 Hz) into OUT', () => {
  const d = starterDoc(SPECS);
  expect(validateDoc(d, SPECS)).toEqual(d);
  expect(d.modules.map((m) => m.type)).toEqual(['osc', 'out']);
  expect(d.modules[0]!.params['wave']).toBe(2);
  expect(d.cables).toEqual([{ from: [d.modules[0]!.id, 'out'], to: [d.modules[1]!.id, 'l'] }]);
  expect(emptyDoc.modules).toEqual([]);
});

test('names of plain-object keys are not module types', () => {
  for (const type of ['toString', 'constructor', '__proto__']) {
    const d = good();
    d.modules[0]!.type = type;
    expect(() => validateDoc(d, TEST_SPECS)).not.toThrow();
    expect(validateDoc(d, TEST_SPECS)).toBeNull();
  }
});

test('nextId never hands out an id already in use', () => {
  const d = good();
  d.modules[1]!.id = 'm7';
  d.cables[0]!.to[0] = 'm7';
  d.nextId = 1;
  expect(validateDoc(d, TEST_SPECS)!.nextId).toBe(8);
});

test('ratios outside the allowed set are dropped; attenuverters are clamped', () => {
  const d = good();
  d.modules[1]!.ratios = { clk: 2.5, other: 9 };
  d.modules[1]!.atts = { cv: 3, x: -7 };
  const v = validateDoc(d, TEST_SPECS)!;
  expect(v.modules[1]!.ratios).toEqual({});
  expect(v.modules[1]!.atts).toEqual({ cv: 1, x: -1 });
});
