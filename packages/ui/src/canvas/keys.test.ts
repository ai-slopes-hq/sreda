// @vitest-environment happy-dom
import { cableHidden, frameSelection, SPECS, starterDoc } from '@sreda/core';
import { expect, test } from 'vitest';
import { createSession } from '../store';
import { handleKey, type KeyCtx } from './keys';

function setup() {
  const s = createSession(SPECS, starterDoc(SPECS));
  const c = s.current().cables.find((x) => !x.from[0].startsWith('g') && !x.to[0].startsWith('g'))!;
  const framed = frameSelection(s.current(), SPECS, [c.from[0], c.to[0]]);
  s.commit(framed.doc);
  s.collapse([framed.id], true);
  s.setState('sidebar', { open: true, tab: 'WIRES' });
  const k = { s, specs: SPECS } as unknown as KeyCtx;
  const key = (name: string) => handleKey(new KeyboardEvent('keydown', { key: name }), k);
  const collapsed = () => s.current().groups.find((g) => g.id === framed.id)!.collapsed;
  const hidden = s.current().cables.findIndex((x) => cableHidden(s.current(), x));
  return { s, key, collapsed, hidden };
}

test('WIRES arrows only pick a row: the frame stays collapsed', () => {
  const { s, key, collapsed, hidden } = setup();
  expect(hidden).toBeGreaterThanOrEqual(0);
  for (let i = 0; i < s.current().cables.length + 1; i++) {
    key('ArrowDown');
    expect(collapsed()).toBe(true);
  }
  expect(s.state.sidebar.picked).not.toBeNull();
});

test('Enter on a picked wire hidden in a collapsed frame expands it', () => {
  const { s, key, collapsed, hidden } = setup();
  s.pickRow(hidden);
  expect(collapsed()).toBe(true);
  key('Enter');
  expect(collapsed()).toBe(false);
});

test('S does nothing: samples are chosen with LOAD, not the picker', () => {
  const s = createSession(SPECS, starterDoc(SPECS));
  const opened: unknown[] = [];
  const k = { s, specs: SPECS, openPicker: (...a: unknown[]) => opened.push(a) } as unknown as KeyCtx;
  handleKey(new KeyboardEvent('keydown', { key: 's' }), k);
  expect(opened).toEqual([]);
});
