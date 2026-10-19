import { expect, test } from 'vitest';
import { createTapper } from './tap';

test('one tap gives nothing; two taps 0.5 s apart give 120', () => {
  const tap = createTapper();
  expect(tap('m1', 10)).toBeNull();
  expect(tap('m1', 10.5)).toBe(120);
});

test('each module keeps its own taps', () => {
  const tap = createTapper();
  tap('m1', 10);
  tap('m2', 10.25);
  expect(tap('m1', 11)).toBe(60);
  expect(tap('m2', 10.5)).toBe(240);
});
