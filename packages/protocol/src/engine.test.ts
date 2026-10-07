import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';
import { loadEngine } from './engine';

// built by `pnpm wasm` (pnpm check runs it before the tests)
const wasm = new WebAssembly.Module(
  readFileSync(fileURLToPath(new URL('../../../engine/pkg/sreda_engine.wasm', import.meta.url))),
);

function render(sampleRate: number, blocks: number): Float32Array {
  const engine = loadEngine(wasm, sampleRate, 1);
  engine.setTone(220);
  const out = new Float32Array(blocks * 128);
  for (let b = 0; b < blocks; b++) out.set(engine.process().l, b * 128);
  return out;
}

for (const sampleRate of [48_000, 44_100]) {
  test(`the WASM test tone is 220 Hz at ${sampleRate}`, () => {
    const s = render(sampleRate, Math.ceil((0.5 * sampleRate) / 128));
    const crossings: number[] = [];
    for (let i = Math.floor(0.1 * sampleRate) + 1; i < s.length; i++)
      if (s[i - 1]! < 0 && s[i]! >= 0) crossings.push(i);
    expect(crossings.length).toBeGreaterThan(50);
    const period = sampleRate / 220;
    for (let i = 1; i < crossings.length; i++)
      expect(Math.abs(crossings[i]! - crossings[i - 1]! - period)).toBeLessThanOrEqual(1);
    const peak = s.subarray(Math.floor(0.1 * sampleRate)).reduce((a, x) => Math.max(a, Math.abs(x)), 0);
    expect(peak).toBeCloseTo(0.2, 2);
  });
}

test('process returns the same views every block (no allocation in the worklet)', () => {
  const engine = loadEngine(wasm, 48_000, 1);
  const a = engine.process();
  const b = engine.process();
  expect(b).toBe(a);
  expect(b.l).toBe(a.l);
});
