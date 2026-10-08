import { expect, test } from 'vitest';
import { emptyDoc, starterDoc, validateDoc, type Doc, type Group } from './doc';
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
  ['a frame with a non-numeric x', (d: Doc) => Object.assign(d, { groups: [{ ...frame('g5'), x: 'a' }] })],
])('rejects %s', (_name, breakIt) => {
  const d = good();
  breakIt(d);
  expect(validateDoc(d, TEST_SPECS)).toBeNull();
});

const frame = (id: string, o: Partial<Group> = {}): Group => ({
  id,
  name: 'DRUMS',
  x: -100,
  y: -100,
  w: 800,
  h: 600,
  parent: null,
  ratio: -2,
  tint: 3,
  layout: 'route',
  muted: true,
  clock: { on: true, bpm: 128 },
  ...o,
});
const framed = (...gs: Group[]): Doc => {
  const d = good();
  d.groups = gs;
  d.nextId = 9;
  return d;
};

test('a well-formed frame is kept as it is', () => {
  const d = framed(frame('g5'));
  d.modules.forEach((m) => (m.parent = 'g5'));
  d.cables.push({ from: ['g5', 'clkOut'], to: ['m2', 'clk'] }, { from: ['m2', 'eoc'], to: ['g5', 'clkIn'] });
  const v = validateDoc(d, TEST_SPECS)!;
  expect(v.groups).toEqual([frame('g5')]);
  expect(v.modules.map((m) => m.parent)).toEqual(['g5', 'g5']);
  expect(v.cables).toHaveLength(3);
});

test('parents naming no frame, or a parent cycle, are recomputed by containment', () => {
  const d = framed(frame('g5', { parent: 'g6' }), frame('g6', { parent: 'g5', x: 2000 }));
  d.modules[0]!.parent = 'g9';
  const v = validateDoc(d, TEST_SPECS)!;
  expect(v.groups.map((g) => g.parent)).toEqual([null, null]);
  expect(v.modules.map((m) => m.parent)).toEqual(['g5', 'g5']);
});

test('cables to the jacks of a missing frame are dropped; tiny frames grow to the minimum', () => {
  const d = framed(frame('g5', { w: 0, h: 0 }));
  d.cables.push({ from: ['g8', 'clkOut'], to: ['m2', 'clk'] });
  const v = validateDoc(d, TEST_SPECS)!;
  expect(v.cables).toHaveLength(1);
  expect(v.groups[0]).toMatchObject({ w: 352, h: 96 });
});

test('a document without groups (older saves) reads as having none', () => {
  const d: Partial<Doc> = good();
  delete d.groups;
  expect(validateDoc(d, TEST_SPECS)!.groups).toEqual([]);
});

test('nextId stays above frame ids too', () => {
  const d = framed(frame('g7'));
  d.nextId = 1;
  expect(validateDoc(d, TEST_SPECS)!.nextId).toBeGreaterThanOrEqual(8);
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

test('a module saved under its old type name opens as S&H (snh)', () => {
  const d = validateDoc(
    {
      version: 1,
      modules: [{ id: 'm1', type: 'sah', x: 0, y: 0, parent: null, params: {}, atts: {}, ratios: {} }],
      cables: [],
      groups: [],
      nextId: 2,
    },
    SPECS,
  )!;
  expect(d.modules[0]!.type).toBe('snh');
});
