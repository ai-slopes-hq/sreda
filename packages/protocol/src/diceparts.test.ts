import { build, DRUM_PARTS, PARTS, SPECS, validateDoc, wireProblems, type DiceCtx } from '@sreda/core';
import { expect, test } from 'vitest';
import { renderDoc } from './render';

// each drum part in a frame with a 120 BPM clock, into an OUT at 0.7, heard alone
function solo(part: string, seed: number) {
  return build(SPECS, (S) => {
    let s = seed;
    const R = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
    const c: DiceCtx = { S, R, scale: 2, root: 0, bpm: 120, x: 0, y: 0 };
    const v = PARTS[part]!(c);
    const o = S.add('out', 1800, 0, { level: 0.7 });
    S.wire(v.out[0], v.out[1], o, 'l');
    S.wire(v.out[0], v.out[1], o, 'r');
    const g = S.frame([...v.ids, o], part, { bpm: 120 });
    for (const [id, port, ratio] of v.clocks) {
      S.wire(g, 'clkOut', id, port);
      if (ratio !== 1) S.rat(id, port, ratio);
    }
  });
}

const PITCHED = [
  'bass-pulse',
  'bass-reese',
  'bass-fm',
  'bass-sub',
  'bass-acid',
  'pluck',
  'arp',
  'bells',
  'stab',
  'pad',
  'westcoast',
];
const TEXTURES = ['drone', 'wash', 'grains', 'chaos-bells', 'blips'];

test('every part builds a document with no problems that round-trips', () => {
  for (const part of Object.keys(PARTS)) {
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const doc = solo(part, seed);
      expect(
        wireProblems(doc, SPECS)
          .filter((p) => !p.info)
          .map((p) => p.text),
        `${part} (seed ${seed})`,
      ).toEqual([]);
      expect(validateDoc(JSON.parse(JSON.stringify(doc)), SPECS), `${part} (seed ${seed})`).toEqual(doc);
    }
  }
});

test('every drum, bass, line and texture part sounds on its own', () => {
  const bad: string[] = [];
  for (const part of [...Object.keys(DRUM_PARTS), ...PITCHED, ...TEXTURES]) {
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const { l, r } = renderDoc(solo(part, seed), SPECS, 4);
      let sum = 0;
      let peak = 0;
      let finite = true;
      for (let i = 0; i < l.length; i++) {
        for (const x of [l[i]!, r[i]!]) {
          if (!Number.isFinite(x)) finite = false;
          sum += x * x;
          peak = Math.max(peak, Math.abs(x));
        }
      }
      const rms = 10 * Math.log10(sum / (2 * l.length) + 1e-20);
      if (!finite || rms < -45 || rms > -3 || peak > 1)
        bad.push(`${part} (seed ${seed}): rms ${rms.toFixed(1)} dBFS, peak ${peak.toFixed(2)}, finite ${finite}`);
    }
  }
  expect(bad).toEqual([]);
}, 120_000);
