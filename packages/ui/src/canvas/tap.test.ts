import { expect, test } from 'vitest';
import { createTapper } from './tap';

test('one tap gives nothing; two taps 0.5 s apart give 120', () => {
  const tap = createTapper();
  expect(tap('m1', 10).bpm).toBeNull();
  expect(tap('m1', 10.5).bpm).toBe(120);
});

test('each module keeps its own taps', () => {
  const tap = createTapper();
  tap('m1', 10);
  tap('m2', 10.25);
  expect(tap('m1', 11).bpm).toBe(60);
  expect(tap('m2', 10.5).bpm).toBe(240);
});

test('taps after the 2.5 s window start a new run, so each run is its own undo step', () => {
  const tap = createTapper();
  const a = tap('m1', 10);
  expect(tap('m1', 10.5).run).toBe(a.run);
  const b = tap('m1', 60);
  expect(b.run).not.toBe(a.run);
  expect(tap('m1', 60.4).run).toBe(b.run);
  // runs are per module: another module's run does not move this one's
  tap('m2', 61);
  expect(tap('m1', 61.2).run).toBe(b.run);
});
