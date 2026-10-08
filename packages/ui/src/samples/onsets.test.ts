import { expect, test } from 'vitest';
import { onsets } from './onsets';

const RATE = 44100;

test('four clicks in silence give four onsets within ±5 ms, strong', () => {
  const x = new Float32Array(RATE);
  const at = [0.1, 0.35, 0.6, 0.85];
  for (const t of at) {
    const s = Math.round(t * RATE);
    for (let i = 0; i < 200; i++) x[s + i] = 0.8 * Math.exp(-i / 40) * (i % 2 ? -1 : 1);
  }
  const o = onsets([x], RATE);
  expect(o).toHaveLength(4);
  o.forEach((h, k) => {
    expect(Math.abs(h.at / RATE - at[k]!)).toBeLessThanOrEqual(0.005);
    expect(h.strength).toBeGreaterThanOrEqual(0.5);
  });
});

test('a steady sine has no onsets past its start', () => {
  const x = Float32Array.from({ length: RATE }, (_, i) => 0.5 * Math.sin((2 * Math.PI * 220 * i) / RATE));
  expect(onsets([x], RATE).filter((h) => h.at > 0.02 * RATE)).toEqual([]);
});
