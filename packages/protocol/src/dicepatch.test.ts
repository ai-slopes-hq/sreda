import { dicePatch, SPECS, STYLE_IDS } from '@sreda/core';
import { expect, test } from 'vitest';
import { renderDoc } from './render';

test('every throw sounds: master RMS between −40 and −3 dBFS over 4 s, never above 0 dBFS, all finite', () => {
  const quiet: string[] = [];
  // 4 throws of every style: scan seeds from 1 until each has 4
  const count: Record<string, number> = Object.fromEntries(STYLE_IDS.map((id) => [id, 0]));
  for (let seed = 1; Object.values(count).some((n) => n < 4) && seed < 2000; seed++) {
    const { doc, style } = dicePatch(SPECS, seed);
    if (count[style]! >= 4) continue;
    count[style]!++;
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
      quiet.push(`seed ${seed} (${style}): rms ${rms.toFixed(1)} dBFS, peak ${peak.toFixed(2)}`);
  }
  expect(Object.values(count).every((n) => n === 4)).toBe(true);
  expect(quiet).toEqual([]);
}, 120_000);
