import { expect, test } from 'vitest';
import { compile } from '../../compile';
import { validateDoc } from '../../doc';
import { SPECS } from '../../spec';
import { wireProblems } from '../../wires';
import { build } from '../build';
import { assemble } from './assemble';
import { dicePatch } from './index';
import { drumKit } from './parts/drums';
import { STYLES } from './styles';
import type { DiceCtx, DiceVoice } from './types';

test('every throw is a valid document with sound reaching OUT and no empty inputs; every style comes up', () => {
  const styles = new Set<string>();
  for (let seed = 1; seed <= 500; seed++) {
    const { doc, style } = dicePatch(SPECS, seed);
    styles.add(style);
    expect(validateDoc(JSON.parse(JSON.stringify(doc)), SPECS), `seed ${seed}`).toEqual(doc);
    const problems = wireProblems(doc, SPECS).filter((p) => !p.info);
    expect(
      problems.map((p) => p.text),
      `seed ${seed} (${style})`,
    ).toEqual([]);
    expect(doc.modules.filter((m) => m.type === 'out')).toHaveLength(1);
    expect(
      doc.modules.filter((m) => m.type === 'rhythm' || m.type === 'stages'),
      `seed ${seed}: sequenced by META-SEQ alone`,
    ).toEqual([]);
    expect(
      doc.groups.some((g) => g.clock.on),
      `seed ${seed}: a frame with its own clock`,
    ).toBe(true);
    expect(() => compile(doc, SPECS, 1)).not.toThrow();
  }
  expect([...styles].sort()).toEqual(Object.keys(STYLES).sort());
});

test('the same seed gives the same patch; another seed another', () => {
  expect(dicePatch(SPECS, 7)).toEqual(dicePatch(SPECS, 7));
  expect(dicePatch(SPECS, 7).doc).not.toEqual(dicePatch(SPECS, 8).doc);
});

test("the outer frame is the style's label in uppercase", () => {
  let seed = 1;
  while (dicePatch(SPECS, seed).style !== 'techno') seed++;
  const { doc, label } = dicePatch(SPECS, seed);
  expect(label).toBe('techno');
  expect(doc.groups.some((g) => g.name === 'TECHNO' && g.clock.on)).toBe(true);
});

test('assemble chains a second MIX past four voices', () => {
  const doc = build(SPECS, (S) => {
    const R = () => 0.5;
    const c: DiceCtx = { S, R, scale: 2, root: 0, bpm: 100, x: 0, y: 0 };
    const voices: DiceVoice[] = [0, 1, 2, 3, 4].map((i) => {
      const o = S.add('osc', 0, i * 200, {});
      return { ids: [o], out: [o, 'out'], clocks: [], name: `V${i}`, role: 'line', part: 'stub', level: 0.5 };
    });
    assemble(c, STYLES.techno!, voices, []);
  });
  const mixes = doc.modules.filter((m) => m.type === 'mix');
  expect(mixes).toHaveLength(2);
  const into = (id: string) => doc.cables.filter((w) => w.to[0] === id);
  const [m1, m2] = mixes.map((m) => m.id) as [string, string];
  expect(into(m1).find((w) => w.to[1] === 'd')?.from).toEqual([m2, 'out']);
  const oscs = doc.modules.filter((m) => m.type === 'osc').map((m) => m.id);
  for (const o of oscs) {
    expect(doc.cables.some((w) => w.from[0] === o && mixes.some((m) => m.id === w.to[0]))).toBe(true);
  }
});

test('drumKit builds 2 to 4 drum parts into one DRUMS voice', () => {
  const weights: [string, number][] = [
    ['kick-sine', 1],
    ['hats-noise', 1],
    ['snare', 1],
    ['clap', 1],
    ['perc-tom', 1],
  ];
  for (let seed = 1; seed <= 40; seed++) {
    let mixId = '';
    const doc = build(SPECS, (S) => {
      let s = seed;
      const R = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
      const c: DiceCtx = { S, R, scale: 2, root: 0, bpm: 120, x: 0, y: 0 };
      const v = drumKit(weights, [2, 4])(c);
      expect(v.role, `seed ${seed}`).toBe('drums');
      expect(v.name).toBe('DRUMS');
      expect(v.level).toBe(0.8);
      expect(v.gate).toBeDefined();
      mixId = v.out[0];
      expect(v.out[1]).toBe('out');
    });
    const mixes = doc.modules.filter((m) => m.type === 'mix');
    expect(mixes.map((m) => m.id), `seed ${seed}`).toEqual([mixId]);
    const parts = doc.cables.filter((w) => w.to[0] === mixId);
    expect(parts.length, `seed ${seed}`).toBeGreaterThanOrEqual(2);
    expect(parts.length).toBeLessThanOrEqual(4);
    expect(doc.modules.filter((m) => m.type === 'metaseq')).toHaveLength(parts.length);
  }
});
