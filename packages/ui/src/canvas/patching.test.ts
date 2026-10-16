import { expect, test } from 'vitest';
import { TEST_SPECS as S } from '../../../core/src/testspecs';
import { fitInside, pickerItems, placeFor, TABS, type LibEntry, type PickerTab } from './patching';

const LIB: LibEntry[] = [
  { kind: 'project', path: 'FACTORY/acid', factory: true },
  { kind: 'group', path: 'FACTORY/303 voice', factory: true },
  { kind: 'group', path: 'drums/kit', factory: false },
];
const o = (tab: PickerTab = 'MODULES', replace = false) => ({ tab, replace, library: LIB });
const types = (items: ReturnType<typeof pickerItems>) =>
  items.map((i) => (i.kind === 'module' ? i.type : i.path));

test('the picker lists every module, filtered by name', () => {
  expect(types(pickerItems(S, '', null, o()))).toEqual(['fx', 'sink', 'src']);
  expect(types(pickerItems(S, 'si', null, o()))).toEqual(['sink']);
});

test('from an output: modules with an input (a knob mod jack counts), the same role first', () => {
  // a trigger output: fx has a trigger input (same role); sink has audio inputs; src only its knob's mod jack
  expect(types(pickerItems(S, '', { dir: 'out', role: 'trigger' }, o()))).toEqual(['fx', 'sink', 'src']);
  expect(placeFor(S, 'src', { dir: 'out', role: 'audio' }, { x: 0, y: 0 }).port).toBe('@lvl');
});

test('from an input: modules with an output', () => {
  expect(types(pickerItems(S, '', { dir: 'in', role: 'audio' }, o()))).toEqual(['fx', 'src']);
});

test('placing puts the chosen port at the drop point, preferring the same role', () => {
  const p = placeFor(S, 'fx', { dir: 'out', role: 'trigger' }, { x: 500, y: 300 });
  expect(p.port).toBe('clk');
  // clk is fx's third input: x 15, y 38 + 2·32 + 16 = 118
  expect([p.x, p.y]).toEqual([485, 182]);
  expect(placeFor(S, 'src', { dir: 'in', role: 'mod' }, { x: 0, y: 0 }).port).toBe('out');
  expect(placeFor(S, 'src', null, { x: 100, y: 100 })).toMatchObject({ port: null, x: 100, y: 100 });
});

test('tabs: ALL lists modules and groups, GROUPS only groups; there is no PROJECTS tab (⌘O opens files)', () => {
  expect(TABS).toEqual(['ALL', 'MODULES', 'GROUPS']);
  expect(types(pickerItems(S, '', null, o('ALL')))).toEqual([
    'fx',
    'sink',
    'src',
    'FACTORY/303 voice',
    'drums/kit',
  ]);
  expect(types(pickerItems(S, '', null, o('GROUPS')))).toEqual(['FACTORY/303 voice', 'drums/kit']);
  const kit = pickerItems(S, '', null, o('GROUPS'))[1]!;
  expect(kit).toMatchObject({ kind: 'group', label: 'kit', folder: 'drums', factory: false });
});

test('the query searches names and folders', () => {
  expect(types(pickerItems(S, 'acid', null, o('ALL')))).toEqual([]);
  expect(types(pickerItems(S, 'factory', null, o('ALL')))).toEqual(['FACTORY/303 voice']);
  expect(types(pickerItems(S, 'drums', null, o('GROUPS')))).toEqual(['drums/kit']);
});

test('from a jack: modules and groups, never projects; REPLACE: modules only', () => {
  const from = { dir: 'out' as const, role: 'trigger' as const };
  expect(types(pickerItems(S, '', from, o('ALL')))).toEqual([
    'fx',
    'sink',
    'src',
    'FACTORY/303 voice',
    'drums/kit',
  ]);
  expect(types(pickerItems(S, '', null, o('ALL', true)))).toEqual(['fx', 'sink', 'src']);
});

test('a popup stays inside the window with an 8 px margin, wherever it opens', () => {
  // fits: stays where it opened
  expect(fitInside({ x: 100, y: 100 }, { w: 280, h: 360 }, { w: 1600, h: 1000 })).toEqual({ x: 100, y: 100 });
  // opened near the bottom right: moves up and left until its far edges are 8 px inside
  expect(fitInside({ x: 1500, y: 900 }, { w: 280, h: 360 }, { w: 1600, h: 1000 })).toEqual({ x: 1312, y: 632 });
  // taller than the window: its top stays 8 px inside
  expect(fitInside({ x: 0, y: 50 }, { w: 280, h: 900 }, { w: 1600, h: 600 })).toEqual({ x: 8, y: 8 });
});
