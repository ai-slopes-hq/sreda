import { expect, test } from 'vitest';
import { TEST_SPECS as S } from '../../../core/src/testspecs';
import { pickerItems, placeFor } from './patching';

test('the picker lists every module, filtered by name', () => {
  expect(pickerItems(S, '', null).map((i) => i.type)).toEqual(['fx', 'sink', 'src']);
  expect(pickerItems(S, 'si', null).map((i) => i.type)).toEqual(['sink']);
});

test('from an output: modules with an input (a knob mod jack counts), the same role first', () => {
  // a trigger output: fx has a trigger input (same role); sink has audio inputs; src only its knob's mod jack
  expect(pickerItems(S, '', { dir: 'out', role: 'trigger' }).map((i) => i.type)).toEqual([
    'fx',
    'sink',
    'src',
  ]);
  expect(placeFor(S, 'src', { dir: 'out', role: 'audio' }, { x: 0, y: 0 }).port).toBe('@lvl');
});

test('from an input: modules with an output', () => {
  expect(pickerItems(S, '', { dir: 'in', role: 'audio' }).map((i) => i.type)).toEqual(['fx', 'src']);
});

test('placing puts the chosen port at the drop point, preferring the same role', () => {
  const p = placeFor(S, 'fx', { dir: 'out', role: 'trigger' }, { x: 500, y: 300 });
  expect(p.port).toBe('clk');
  // clk is fx's third input: x 13, y 38 + 2·32 + 16 = 118
  expect([p.x, p.y]).toEqual([487, 182]);
  expect(placeFor(S, 'src', { dir: 'in', role: 'mod' }, { x: 0, y: 0 }).port).toBe('out');
  expect(placeFor(S, 'src', null, { x: 100, y: 100 })).toMatchObject({ port: null, x: 100, y: 100 });
});
