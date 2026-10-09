import { dicePatch, SPECS } from '@sreda/core';
import { expect, test } from 'vitest';
import { renderDoc } from './render';

test('every throw sounds: master RMS between −40 and −3 dBFS over 4 s, never above 0 dBFS, all finite', () => {
  const quiet: string[] = [];
  for (let seed = 1; seed <= 40; seed++) {
    const { doc, kind } = dicePatch(SPECS, seed);
    const { l, r } = renderDoc(doc, SPECS, 4);
    let sum = 0;
    let peak = 0;
    for (let i = 0; i < l.length; i++) {
      for (const x of [l[i]!, r[i]!]) {
        expect(Number.isFinite(x)).toBe(true);
        sum += x * x;
        peak = Math.max(peak, Math.abs(x));
      }
    }
    const rms = 10 * Math.log10(sum / (2 * l.length) + 1e-20);
    if (rms < -40 || rms > -3 || peak > 1)
      quiet.push(`seed ${seed} (${kind}): rms ${rms.toFixed(1)} dBFS, peak ${peak.toFixed(2)}`);
  }
  expect(quiet).toEqual([]);
}, 120_000);
