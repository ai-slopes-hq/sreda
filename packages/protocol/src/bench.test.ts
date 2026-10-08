import { bigPatch, SPECS } from '@sreda/core';
import { expect, test } from 'vitest';
import { renderDoc } from './render';

test('10 s of the 200-module patch render through WASM in under half of real time', () => {
  const doc = bigPatch(SPECS);
  const t = performance.now();
  const { l } = renderDoc(doc, SPECS, 10);
  const took = (performance.now() - t) / 1000;
  console.log(`200 modules in WASM: 10 s of audio in ${took.toFixed(2)} s (${(took * 10).toFixed(1)} % of real time)`);
  expect(l.every(Number.isFinite)).toBe(true);
  expect(took).toBeLessThan(5);
}, 30_000);
