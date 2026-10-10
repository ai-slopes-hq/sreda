import { expect, test } from 'vitest';
import { emptyDoc, type Doc } from './doc';
import { History } from './history';

const d = (n: number): Doc => ({ ...emptyDoc, nextId: n });

function clock() {
  let t = 0;
  return { now: () => t, wait: (ms: number) => (t += ms) };
}

test('the same key 300 ms apart merges into one step; 800 ms apart does not', () => {
  const c = clock();
  const h = new History(d(0), c.now);
  h.commit(d(1), { key: 'knob' });
  c.wait(300);
  h.commit(d(2), { key: 'knob' });
  expect(h.undo()).toEqual(d(0));
  h.redo();
  c.wait(800);
  h.commit(d(3), { key: 'knob' });
  expect(h.undo()).toEqual(d(2));
});

test('a stroke merges until another key, however long it takes', () => {
  const c = clock();
  const h = new History(d(0), c.now);
  h.commit(d(1), { key: 'drag', stroke: true });
  c.wait(5000);
  h.commit(d(2), { key: 'drag', stroke: true });
  h.commit(d(3), { key: 'other' });
  expect(h.undo()).toEqual(d(2));
  expect(h.undo()).toEqual(d(0));
  expect(h.undo()).toBeNull();
});

test('a commit after undo clears redo; replace adds no step', () => {
  const h = new History(d(0));
  h.commit(d(1));
  h.undo();
  h.commit(d(2));
  expect(h.redo()).toBeNull();
  h.replace(d(5));
  expect(h.current).toEqual(d(5));
  expect(h.undo()).toEqual(d(0));
});

test('a replace that keeps the merge leaves a stroke or a wheel run one step', () => {
  const c = clock();
  const h = new History(d(0), c.now);
  h.commit(d(1), { key: 'drag', stroke: true });
  h.replace(d(2), true); // the patch itself changed (MUTATE's write-back) mid-stroke
  h.commit(d(3), { key: 'drag', stroke: true });
  expect(h.current).toEqual(d(3));
  expect(h.undo()).toEqual(d(0));
  expect(h.undo()).toBeNull();
  h.commit(d(4), { key: 'knob' });
  c.wait(300);
  h.replace(d(5), true);
  c.wait(300);
  h.commit(d(6), { key: 'knob' });
  expect(h.undo()).toEqual(d(0));
});
