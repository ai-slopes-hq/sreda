import { expect, test } from 'vitest';
import { layoutPanel } from './panel';
import { SPECS, type ModuleSpec } from './spec';
import { k, mod, p } from './testspecs';

test('a 5×1 module with 3 knobs and a 3-value option follows the grammar', () => {
  const spec: ModuleSpec = mod('t', {
    size: [5, 1],
    inputs: [p('a', 'audio'), p('b', 'mod')],
    outputs: [p('o', 'audio')],
    params: [
      k('x'),
      k('y'),
      k('z'),
      { kind: 'option', id: 'm', label: 'M', options: ['A', 'B', 'C'], def: 0 },
    ],
  });
  const l = layoutPanel(spec);
  expect([l.w, l.h, l.lanes]).toEqual([280, 144, 3]);
  expect(['x', 'y', 'z'].map((id) => [l.cells[id]!.x, l.cells[id]!.y])).toEqual([
    [56, 38],
    [112, 38],
    [168, 38],
  ]);
  expect(l.cells['m']).toEqual({ x: 56, y: 102, w: 112, mode: true });
  expect(l.jacks['a']).toEqual({ x: 13, y: 54 });
  expect(l.jacks['b']).toEqual({ x: 13, y: 86 });
  expect(l.jacks['o']).toEqual({ x: 267, y: 54 });
  expect(l.jacks['@x']).toEqual({ x: 63, y: 45 });
  expect(l.display).toBeNull();
  expect(l.fits).toBe(true);
});

test('actions go right, glyph options take 1 HP, displays sit on top', () => {
  const spec: ModuleSpec = mod('t', {
    size: [6, 2],
    params: [
      k('x'),
      { kind: 'option', id: 'w', label: 'W', options: ['A', 'B', 'C'], def: 0, glyph: 'wave' },
      { kind: 'action', id: 'dice', label: 'DICE' },
    ],
    display: { lanes: 4, kind: 'scope' },
  });
  const l = layoutPanel(spec);
  expect(l.h).toBe(288);
  expect(l.display).toEqual({ x: 60, y: 40, w: 216, h: 122 });
  expect(l.cells['x']).toEqual({ x: 56, y: 38 + 4 * 32, w: 56, mode: false });
  expect(l.cells['w']).toEqual({ x: 56, y: 38 + 6 * 32, w: 56, mode: true });
  expect(l.cells['dice']).toEqual({ x: 56 + 3 * 56, y: 38 + 6 * 32, w: 56, mode: true });
});

test('a module that does not fit says so', () => {
  const spec = mod('t', { size: [3, 1], params: [k('a'), k('b')] });
  expect(layoutPanel(spec).fits).toBe(false);
});

test('every generated module fits its size', () => {
  for (const spec of Object.values(SPECS)) expect(layoutPanel(spec).fits, spec.type).toBe(true);
});

test('heights are exactly n × 1U, so stacked 1U modules line up with 2U and 3U', () => {
  const at = (u: number) => layoutPanel(mod('t' + u, { size: [3, u] }));
  expect([1, 2, 3].map((u) => [at(u).h, at(u).lanes])).toEqual([
    [144, 3],
    [288, 7],
    [432, 12],
  ]);
  for (const s of Object.values(SPECS)) expect(layoutPanel(s).h % 144).toBe(0);
});
