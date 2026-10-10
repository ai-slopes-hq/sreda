import { laneParam, laneSteps, LANES, stepId, writeLane } from '@sreda/core';
import { expect, test } from 'vitest';
import { createRoot } from 'solid-js';
import { createStore } from 'solid-js/store';
import { MutationWatch, mutationChanges, writeBack } from './mutate';

/** pattern `p`'s lanes as the document holds them, in param units (what the trace reports when nothing mutated) */
const lanes = (params: Record<string, number>, p: number) => LANES.map((l) => laneSteps(params, p, l));

test('mutationChanges: nothing when the live steps match the document', () => {
  const params = { ...writeLane(2, 'n', [3, 7, 10]), ...writeLane(2, 'v', [0.7, 0.2]) };
  const live = lanes(params, 2);
  // VEL through the engine's f32: equal within float precision
  live[4]![0] = Math.fround(0.7);
  expect(mutationChanges(params, 2, live)).toEqual({});
});

test('mutationChanges returns only the differing ids, in document units', () => {
  const params = writeLane(1, 'n', [3, 7, 10]);
  const live = lanes(params, 1);
  live[0]![1] = 10; // NOTE step 2: 7 → 10 semitones
  live[1]![0] = 1; // GATE step 1 on
  live[3]![5] = 1; // ACC step 6 on
  live[4]![2] = Math.fround(0.8); // VEL step 3
  expect(mutationChanges(params, 1, live)).toEqual({
    [stepId(1, 'n', 2)]: 10 / 24,
    [stepId(1, 'g', 1)]: 1,
    [stepId(1, 'a', 6)]: 1,
    [stepId(1, 'v', 3)]: Math.fround(0.8),
  });
});

/** a readout buffer holding a META-SEQ trace at `at` */
function trace(at: number, pattern: number, gateCursor: number, gen: number, live: number[][]): Float32Array {
  const buf = new Float32Array(at + 104);
  buf[at] = pattern;
  buf[at + 2] = gateCursor;
  buf[at + 7] = gen;
  live.forEach((row, l) => row.forEach((v, k) => (buf[at + 8 + l * 16 + k] = v)));
  return buf;
}

function watch(params: Record<string, number>) {
  const doc = { params };
  const writes: Record<string, number>[] = [];
  const w = new MutationWatch(
    () => doc.params,
    (c) => {
      writes.push(c);
      doc.params = { ...doc.params, ...c };
    },
  );
  return { doc, writes, w };
}

test('the watch writes a mutation once the GATE lane wraps, as one batch', () => {
  const { doc, writes, w } = watch({});
  const live = lanes(doc.params, 0);
  w.frame(trace(10, 0, 5, 0, live), 10, 0);
  live[0]![0] = 14;
  live[3]![0] = 1;
  // the generation moved but the GATE lane has not wrapped: wait
  w.frame(trace(10, 0, 9, 2, live), 10, 1000);
  expect(writes).toEqual([]);
  w.frame(trace(10, 0, 0, 2, live), 10, 1016);
  expect(writes).toEqual([{ [stepId(0, 'n', 1)]: 14 / 24, [stepId(0, 'a', 1)]: 1 }]);
  // nothing new: no second write
  w.frame(trace(10, 0, 1, 2, live), 10, 1032);
  w.frame(trace(10, 0, 0, 2, live), 10, 1048);
  expect(writes.length).toBe(1);
});

test('an edit in the drawer wins: the edited step is not written back while fresh; the mutation is', () => {
  const { doc, writes, w } = watch({});
  const live = lanes(doc.params, 0);
  w.frame(trace(10, 0, 5, 0, live), 10, 0);
  // the user draws NOTE step 3 = 19; the engine's trace still has 12 there, and a mutation of ACC step 2
  doc.params = { ...doc.params, ...writeLane(0, 'n', [12, 12, 19]) };
  live[3]![1] = 1;
  w.frame(trace(10, 0, 0, 1, live), 10, 1000);
  expect(writes, 'ACC goes; NOTE step 3 is fresh: the trace may not have it yet').toEqual([
    { [stepId(0, 'a', 2)]: 1 },
  ]);
  expect(laneSteps(doc.params, 0, 'n')[2]).toBe(19);
  // still stale a frame later: NOTE step 3 is still not written over
  w.frame(trace(10, 0, 0, 1, live), 10, 1016);
  expect(writes.length).toBe(1);
  // the engine took the edit: nothing more to write once it settles
  live[0]![2] = 19;
  w.frame(trace(10, 0, 1, 1, live), 10, 1500);
  expect(writes.length).toBe(1);
  expect(laneSteps(doc.params, 0, 'n')[2]).toBe(19);
});

test('a step deferred as fresh is written once it settles, if the engine still differs', () => {
  const { doc, writes, w } = watch({});
  const live = lanes(doc.params, 0);
  w.frame(trace(10, 0, 5, 0, live), 10, 0);
  // VEL step 1 edited to 0.5 while the engine mutated it to 0.25 (it will take 0.5 — unless a later mutation moves it)
  doc.params = { ...doc.params, [stepId(0, 'v', 1)]: 0.5 };
  live[4]![0] = 0.25;
  w.frame(trace(10, 0, 0, 1, live), 10, 1000);
  expect(writes).toEqual([]);
  live[4]![0] = 0.375; // drifted again after taking the edit
  w.frame(trace(10, 0, 0, 2, live), 10, 1400);
  expect(writes).toEqual([{ [stepId(0, 'v', 1)]: 0.375 }]);
});

test('a GATE lane of LEN 1 writes on every generation', () => {
  const { doc, writes, w } = watch({ [laneParam(0, 'g', 'len')]: 0 });
  const live = lanes(doc.params, 0);
  w.frame(trace(0, 0, 0, 0, live), 0, 0);
  live[4]![0] = Math.fround(0.75);
  w.frame(trace(0, 0, 0, 1, live), 0, 1000);
  expect(writes).toEqual([{ [stepId(0, 'v', 1)]: Math.fround(0.75) }]);
});

test("the write-back follows the module's type: an id that becomes a META-SEQ in a replaced document writes back", () => {
  // a panel keeps its store proxy across a replaced document (reconciled by id): m1 was an OSC, now a META-SEQ
  const [mod, setMod] = createStore({ type: 'osc', params: {} as Record<string, number> });
  const writes: Record<string, number>[] = [];
  createRoot((dispose) => {
    const frame = writeBack(
      () => mod.type,
      () => mod.params,
      (c) => writes.push(c),
    );
    setMod({ type: 'metaseq', params: {} });
    const live = lanes(mod.params, 0);
    frame(trace(10, 0, 5, 0, live), 10, 0);
    live[0]![0] = 14;
    frame(trace(10, 0, 0, 2, live), 10, 1000);
    expect(writes).toEqual([{ [stepId(0, 'n', 1)]: 14 / 24 }]);
    // and none while it is something else
    setMod({ type: 'osc' });
    live[0]![1] = 15;
    frame(trace(10, 0, 0, 3, live), 10, 2000);
    expect(writes.length).toBe(1);
    dispose();
  });
});
