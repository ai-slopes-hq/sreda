import { SPECS, starterDoc, type Doc } from '@sreda/core';
import { expect, test } from 'vitest';
import { mixStrips } from './strips';

function patch(): Doc {
  const base = starterDoc(SPECS);
  const out = (id: string, x: number, y: number, parent: string | null) => ({
    id,
    type: 'out',
    x,
    y,
    parent,
    params: {},
    atts: {},
    ratios: {},
  });
  const frame = (id: string, name: string, muted = false) => ({
    ...base.groups[0],
    id,
    name,
    muted,
    parent: null,
  });
  return {
    ...base,
    modules: [
      out('a', 0, 400, null),
      out('b', 0, 0, 'drums'),
      out('c', 300, 400, 'bass'),
      out('d', 600, 400, 'bass'),
    ],
    cables: [],
    groups: [frame('drums', 'DRUMS'), frame('bass', 'BASS', true)] as Doc['groups'],
  };
}

test('names: the frame holding only this OUT, else OUT n; reading order', () => {
  const strips = mixStrips(patch(), SPECS);
  expect(strips.map((s) => [s.id, s.name])).toEqual([
    ['b', 'DRUMS'],
    ['a', 'OUT 1'],
    ['c', 'OUT 3'],
    ['d', 'OUT 4'],
  ]);
});

test('an OUT in a muted frame is muted', () => {
  expect(mixStrips(patch(), SPECS).map((s) => s.muted)).toEqual([false, false, true, true]);
});

test('reading order: OUTs a few pixels apart vertically are one row, the left one first', () => {
  const doc = patch();
  const at = (id: string, x: number, y: number) => ({ ...doc.modules.find((m) => m.id === id)!, x, y, parent: null });
  const tilted: Doc = { ...doc, groups: [], modules: [at('a', 500, 400), at('b', 0, 404)] };
  expect(mixStrips(tilted, SPECS).map((s) => s.id)).toEqual(['b', 'a']);
});
