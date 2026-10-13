// @vitest-environment happy-dom
import { addModule, emptyDoc, laneLocked, laneParam, LANES, laneSteps, SPECS, stepId } from '@sreda/core';
import { fireEvent, render } from '@solidjs/testing-library';
import { expect, test } from 'vitest';
import type { AudioHost } from '../audio/host';
import { frame } from '../live';
import { createSession } from '../store';
import { Drawer } from './Drawer';

function setup() {
  const s = createSession(SPECS, emptyDoc);
  s.commit(addModule(emptyDoc, SPECS, 'metaseq', 0, 0).doc);
  const r = render(() => <Drawer session={s} specs={SPECS} id="m1" />);
  const q = (sel: string) => r.container.querySelector(sel) as HTMLElement;
  const params = () => s.current().modules.find((m) => m.id === 'm1')!.params;
  return { s, r, q, params };
}

test('the lit tab follows the trace: pattern 2 plays, the edit stays on A', () => {
  const { s, q } = setup();
  const readouts = new Float32Array(4096);
  s.attach({
    readouts,
    post: () => {},
    onMessage: null,
    onError: null,
    sampleRate: 48000,
    events: { read: () => 0, dropped: () => 0 },
    outputTimestamp: () => ({ contextTime: 0, performanceTime: 0 }),
  } as unknown as AudioHost);
  const at = s.layout().nodes[0]!.trace!;
  readouts[0] = 1; // the first plan sent
  readouts[at] = 2;
  frame(performance.now());
  expect(q('[data-pattern=C]').classList.contains('play')).toBe(true);
  expect(q('[data-pattern=A]').classList.contains('play')).toBe(false);
  expect(q('[data-pattern=A]').classList.contains('on')).toBe(true);
  expect(q('[data-pattern=C]').classList.contains('on')).toBe(false);
});

test('COPY then PASTE into B is one undo step; PASTE is disabled until a copy', () => {
  const { s, q, params } = setup();
  expect((q('[data-act=paste]') as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(q('[data-act=copy]'));
  expect((q('[data-act=paste]') as HTMLButtonElement).disabled).toBe(false);
  fireEvent.click(q('[data-pattern=B]'));
  const before = s.current();
  fireEvent.click(q('[data-act=paste]'));
  expect(laneSteps(params(), 1, 'g')).toEqual(laneSteps({}, 0, 'g'));
  expect(params()[stepId(1, 'g', 1)]).toBe(1);
  s.undo();
  expect(s.current()).toEqual(before);
});

test('DICE with every lane locked writes nothing and adds no undo step', () => {
  const { s, q, params } = setup();
  const locks: Record<string, number> = {};
  for (const l of LANES) locks[laneParam(0, l, 'lock')] = 1;
  s.params('m1', locks, undefined);
  const before = params();
  fireEvent.click(q('[data-act=dice]'));
  expect(params()).toEqual(before);
  s.undo();
  expect(laneLocked(params(), 0, 'n')).toBe(false);
});

test('a pattern tab is not an undo step and leaves a saved project saved; EDIT is in the document', () => {
  const { s, q, params } = setup();
  s.markSaved();
  const note = params()['an1'];
  s.params('m1', { an1: 14 / 24 }, undefined);
  s.markSaved();
  fireEvent.click(q('[data-pattern=C]'));
  expect(params()['edit']).toBe(2);
  expect(q('[data-pattern=C]').classList.contains('on')).toBe(true);
  expect(s.state.dirty).toBe(false);
  // ⌘Z undoes the NOTE edit, not the tab
  s.undo();
  expect(params()['an1']).toBe(note);
});
