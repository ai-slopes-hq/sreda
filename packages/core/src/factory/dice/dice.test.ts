import { expect, test } from 'vitest';
import { compile } from '../../compile';
import { validateDoc } from '../../doc';
import { SPECS } from '../../spec';
import { wireProblems } from '../../wires';
import { build, buildWith } from '../build';
import { assemble } from './assemble';
import { dicePatch, dicePatchIn } from './index';
import { drumKit } from './parts/drums';
import { PARTS } from './parts';
import { STYLES } from './styles';
import { STYLE_IDS } from './styles';
import { toKnob, type KnobParam } from '../../spec';
import type { DiceCtx, DiceVoice, Part, Style } from './types';

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
  expect([...styles].sort()).toEqual([
    'acid',
    'bells',
    'berlin',
    'drone',
    'dub',
    'electro',
    'idm',
    'industrial',
    'polymeter',
    'techno',
    'westcoast',
  ]);
  expect([...STYLE_IDS].sort()).toEqual([...styles].sort());
});

test('every part in the library comes up in some throw', () => {
  const seen = new Set<string>();
  for (let seed = 1; seed <= 500; seed++) for (const p of dicePatch(SPECS, seed).parts) seen.add(p);
  expect(Object.keys(PARTS).filter((p) => !seen.has(p))).toEqual([]);
});

test('every style has its label, a BPM range, scales and a twist pool', () => {
  for (const id of STYLE_IDS) {
    const s = STYLES[id]!;
    expect(s.id).toBe(id);
    expect(s.bpm[0]).toBeLessThan(s.bpm[1]);
    expect(s.scales.length).toBeGreaterThan(0);
    expect(s.twistCount).toEqual([0, 3]);
    expect(s.twists.length, id).toBeGreaterThan(0);
    for (const r of s.roles) for (const [p] of r.parts) expect(PARTS[p], `${id}: ${p}`).toBeDefined();
  }
  expect(STYLE_IDS.map((id) => STYLES[id]!.label).sort()).toEqual(
    [
      'IDM / glitch',
      'Berlin school',
      'acid',
      'ambient bells',
      'drone',
      'dub',
      'electro',
      'industrial',
      'minimal polymeter',
      'techno',
      'west coast',
    ].sort(),
  );
});

/** a one-oscillator part that names itself, for the framework tests */
const stub =
  (name: string, level: number, role: DiceVoice['role'] = 'line'): Part =>
  (c) => {
    const o = c.S.add('osc', c.x, c.y, {});
    return { ids: [o], out: [o, 'out'], clocks: [], name, role, part: name, level };
  };
const stubStyle = (roles: Style['roles']): Style => ({
  id: 'techno',
  label: 'stub',
  bpm: [100, 100],
  scales: [2],
  roles,
  fx: [[(_c, input) => ({ ids: [], l: input, clocks: [] }), 1]],
  twists: [],
  twistCount: [0, 0],
});
const STUBS = { a: stub('A', 0.5), b: stub('B', 0.5), t: stub('T', 0.5, 'texture') };

test("a throw where no role was chosen plays the style's most likely role, not the first", () => {
  const style = stubStyle([
    { role: 'line', p: 0, parts: [['a', 1]] },
    { role: 'line', p: 1e-12, parts: [['b', 1]] },
  ]);
  for (let seed = 1; seed <= 20; seed++)
    expect(dicePatchIn(SPECS, style, seed, STUBS).parts, `seed ${seed}`).toEqual(['B']);
});

test('a role with a count plays that many voices', () => {
  const style = stubStyle([{ role: 'texture', p: 1, parts: [['t', 1]], count: [3, 3] }]);
  const { doc, parts } = dicePatchIn(SPECS, style, 1, STUBS);
  expect(parts).toEqual(['T', 'T', 'T']);
  expect(doc.modules.filter((m) => m.type === 'osc')).toHaveLength(3);
});

test('assemble: four voices share one MIX; five chain a second on its D, levels on the right inputs', () => {
  const mixOf = (n: number) =>
    build(SPECS, (S) => {
      const c: DiceCtx = { S, R: () => 0.5, scale: 2, root: 0, bpm: 100, x: 0, y: 0 };
      const voices: DiceVoice[] = Array.from({ length: n }, (_, i) =>
        stub(`V${i}`, 0.1 * (i + 1))({ ...c, y: i * 200 }),
      );
      assemble(c, STYLES.techno!, voices, []);
    });
  const lvl = (v: number) => toKnob(SPECS['mix']!.params.find((p) => p.id === 'la') as KnobParam, v);
  const oscs = (doc: ReturnType<typeof mixOf>) =>
    doc.modules.filter((m) => m.type === 'osc').map((m) => m.id);

  const four = mixOf(4);
  const m4 = four.modules.filter((m) => m.type === 'mix');
  expect(m4).toHaveLength(1);
  oscs(four).forEach((o, i) => {
    expect(four.cables.some((w) => w.from[0] === o && w.to[0] === m4[0]!.id && w.to[1] === 'abcd'[i])).toBe(
      true,
    );
    expect(m4[0]!.params['l' + 'abcd'[i]]).toBeCloseTo(lvl(0.1 * (i + 1)));
  });

  const five = mixOf(5);
  const [m1, m2] = five.modules.filter((m) => m.type === 'mix') as [
    { id: string; params: Record<string, number> },
    (typeof m4)[0],
  ];
  expect(five.cables.some((w) => w.from[0] === m2!.id && w.to[0] === m1.id && w.to[1] === 'd')).toBe(true);
  const o5 = oscs(five);
  o5.forEach((o, i) => {
    const [mix, input] = i < 3 ? [m1.id, 'abc'[i]!] : [m2!.id, 'abcd'[i - 3]!];
    expect(
      five.cables.some((w) => w.from[0] === o && w.to[0] === mix && w.to[1] === input),
      `voice ${i}`,
    ).toBe(true);
    const params = (i < 3 ? m1 : m2!).params;
    expect(params['l' + input]).toBeCloseTo(lvl(0.1 * (i + 1)));
  });
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
      const R = () => (s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32;
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
    expect(
      mixes.map((m) => m.id),
      `seed ${seed}`,
    ).toEqual([mixId]);
    const parts = doc.cables.filter((w) => w.to[0] === mixId);
    expect(parts.length, `seed ${seed}`).toBeGreaterThanOrEqual(2);
    expect(parts.length).toBeLessThanOrEqual(4);
    expect(doc.modules.filter((m) => m.type === 'metaseq')).toHaveLength(parts.length);
  }
});

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

test('pitched parts fill pitch, osc, gate and seq', () => {
  for (const id of PITCHED) {
    for (let seed = 1; seed <= 20; seed++) {
      build(SPECS, (S) => {
        let s = seed;
        const R = () => (s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32;
        const v = PARTS[id]!({ S, R, scale: 2, root: 0, bpm: 120, x: 0, y: 0 });
        const at = `${id} (seed ${seed})`;
        expect(v.part, at).toBe(id);
        expect(['bass', 'line'], at).toContain(v.role);
        for (const k of ['pitch', 'gate', 'seq'] as const) expect(v[k], `${at}: ${k}`).toBeDefined();
        // every pitched part has an oscillator, except bells' COMB (the gate rings a filter)
        if (!(id === 'bells' && v.osc === undefined)) expect(v.osc, `${at}: osc`).toBeDefined();
      });
    }
  }
});

test('every voice field names a real port of its module, in the right direction', () => {
  let comb = 0;
  for (const id of Object.keys(PARTS)) {
    for (let seed = 1; seed <= 30; seed++) {
      const { doc, value: v } = buildWith(SPECS, (S) => {
        let s = seed;
        const R = () => (s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32;
        return PARTS[id]!({ S, R, scale: 2, root: 0, bpm: 120, x: 0, y: 0 });
      });
      const at = `${id} (seed ${seed})`;
      const spec = (mid: string) => SPECS[doc.modules.find((m) => m.id === mid)!.type]!;
      const has = (ports: { id: string }[], p: string) => ports.some((x) => x.id === p);
      const input = ([m, p]: [string, string]) => has(spec(m).inputs, p);
      const output = ([m, p]: [string, string]) => has(spec(m).outputs, p);
      expect(output(v.out), `${at}: out`).toBe(true);
      if (v.pitch) expect(input(v.pitch), `${at}: pitch`).toBe(true);
      if (v.fm) expect(input(v.fm), `${at}: fm`).toBe(true);
      if (v.osc) expect(output(v.osc), `${at}: osc`).toBe(true);
      if (v.gate) {
        expect(output(v.gate), `${at}: gate`).toBe(true);
        expect(doc.modules.find((m) => m.id === v.gate![0])!.type, `${at}: gate`).toBe('metaseq');
      }
      if (v.cutoff) {
        expect(v.cutoff[1], at).toBe('@cutoff');
        expect(has(spec(v.cutoff[0]).params, 'cutoff'), `${at}: cutoff`).toBe(true);
      }
      for (const [cid, port] of v.clocks) expect(input([cid, port]), `${at}: clock`).toBe(true);
      if (id === 'bells' && v.osc === undefined) comb++;
    }
  }
  expect(comb, 'the COMB bells branch was hit').toBeGreaterThan(0);
});
