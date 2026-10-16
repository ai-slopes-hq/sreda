import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';
import { compile } from '../../compile';
import { validateDoc } from '../../doc';
import { SCALES } from '../../generators';
import { laneLen, laneSteps } from '../../metaseq';
import { fromKnob, SPECS, toKnob, type KnobParam } from '../../spec';
import { wireProblems } from '../../wires';
import { build, buildWith } from '../build';
import { assemble } from './assemble';
import { dicePatch, dicePatchIn } from './index';
import { drumKit } from './parts/drums';
import { PARTS } from './parts';
import { STYLE_IDS, STYLES } from './styles';
import { TWISTS } from './twists';
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

const TWIST_IDS = ['chance', 'feedback', 'fm', 'grains', 'polymeter', 'shaper', 'snh', 'switch'];

test('every twist comes up and every throw stays valid', () => {
  const seen = new Set<string>();
  for (let seed = 1; seed <= 500; seed++) {
    const { doc, style, twists } = dicePatch(SPECS, seed);
    for (const t of twists) seen.add(t);
    expect(new Set(twists).size, `seed ${seed}: no repeats`).toBe(twists.length);
    expect(twists.length).toBeLessThanOrEqual(3);
    expect(validateDoc(JSON.parse(JSON.stringify(doc)), SPECS), `seed ${seed}`).toEqual(doc);
    expect(
      wireProblems(doc, SPECS)
        .filter((p) => !p.info)
        .map((p) => p.text),
      `seed ${seed} (${style}, ${twists})`,
    ).toEqual([]);
    expect(doc.modules.filter((m) => m.type === 'out')).toHaveLength(1);
    expect(() => compile(doc, SPECS, 1)).not.toThrow();
  }
  expect([...seen].sort()).toEqual(TWIST_IDS);
});

test('every twist applies or returns null, and leaves nothing unconnected, on a drums-only throw', () => {
  expect(Object.keys(TWISTS).sort()).toEqual(TWIST_IDS);
  for (const id of TWIST_IDS) {
    for (const part of ['drums-techno', 'drums-acid', 'drums-dub', 'drums-industrial']) {
      for (let seed = 1; seed <= 10; seed++) {
        const doc = build(SPECS, (S) => {
          let s = seed;
          const R = () => (s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32;
          const c: DiceCtx = { S, R, scale: 2, root: 0, bpm: 120, x: 0, y: 0 };
          const voices = [PARTS[part]!(c)];
          const t = TWISTS[id as keyof typeof TWISTS]!(c, voices);
          assemble(c, STYLES.techno!, voices, t ? [t] : []);
        });
        expect(
          wireProblems(doc, SPECS)
            .filter((p) => !p.info)
            .map((p) => p.text),
          `${id} on ${part} (seed ${seed})`,
        ).toEqual([]);
      }
    }
  }
});

test('throws of one style are not near-copies', () => {
  // compared by what is built, not by cable ids (which differ between any two throws): the multisets of module
  // types and of part ids
  for (const id of STYLE_IDS) {
    const sigs = Array.from({ length: 10 }, (_, i) => {
      const { doc, parts } = dicePatchIn(SPECS, STYLES[id]!, 1000 + i);
      return (
        doc.modules
          .map((m) => m.type)
          .sort()
          .join() +
        ' | ' +
        [...parts].sort().join()
      );
    });
    let differ = 0;
    let pairs = 0;
    for (let i = 0; i < 10; i++)
      for (let j = i + 1; j < 10; j++) {
        pairs++;
        if (sigs[i] !== sigs[j]) differ++;
      }
    expect(differ / pairs, id).toBeGreaterThanOrEqual(0.8);
  }
});

test('acid, drone, ambient bells and Berlin school throw at least 15 distinct part combinations in 100 throws', () => {
  for (const id of ['acid', 'drone', 'bells', 'berlin'] as const) {
    const combos = new Set<string>();
    for (let i = 0; i < 100; i++)
      combos.add([...dicePatchIn(SPECS, STYLES[id]!, 1 + i).parts].sort().join('+'));
    expect(combos.size, id).toBeGreaterThanOrEqual(15);
  }
});

test('twists build what they say', () => {
  const kinds = (doc: ReturnType<typeof build>) => doc.modules.map((m) => m.type);
  const counts: Record<string, number> = {};
  for (let seed = 1; seed <= 500; seed++) {
    const { doc, twists } = dicePatch(SPECS, seed);
    const k = kinds(doc);
    const has = (t: string) => k.includes(t);
    for (const t of twists) counts[t] = (counts[t] ?? 0) + 1;
    if (twists.includes('snh')) expect(has('snh') && has('noise'), `seed ${seed}`).toBe(true);
    if (twists.includes('switch')) expect(has('spread'), `seed ${seed}`).toBe(true);
    if (twists.includes('grains')) expect(has('grains'), `seed ${seed}`).toBe(true);
  }
  for (const t of TWIST_IDS) expect(counts[t], t).toBeGreaterThan(5);
});

const freqOf = (type: string, params: Record<string, number>, id: string): number =>
  fromKnob(SPECS[type]!.params.find((p) => p.id === id) as KnobParam, params[id]!);
/** semitones above the nearest C below, 0…12 */
const aboveC = (f: number): number => (((12 * Math.log2(f / 261.6256)) % 12) + 12) % 12;
const centsFrom = (semis: number, target: number): number => {
  const d = Math.abs(semis - target) % 12;
  return Math.min(d, 12 - d) * 100;
};
const BONGOS = ['perc-bongo', 'idm-bongo', 'poly-bongo'];

test('one key: a pitched input is wired to an oscillator on a C; an unwired pitched one sits on the scale', () => {
  const bad: string[] = [];
  for (let seed = 1; seed <= 300; seed++) {
    const { doc, scale, root, voices, style } = dicePatch(SPECS, seed);
    const wired = (id: string) => doc.cables.some((w) => w.to[0] === id && w.to[1] === 'pitch');
    for (const m of doc.modules) {
      const pitched = m.type === 'osc' || m.type === 'complex' || (m.type === 'filter' && wired(m.id));
      if (!pitched || !wired(m.id)) continue;
      const f = freqOf(m.type, m.params, m.type === 'filter' ? 'cutoff' : 'freq');
      if (centsFrom(aboveC(f), 0) > 5)
        bad.push(`seed ${seed} (${style}) ${m.id} ${m.type} ${f.toFixed(2)} Hz is not a C`);
    }
    // the unwired ones in a pitched role (not the kits' kicks and hats) sit on a degree of the scale from the root
    for (const v of voices) {
      if (v.role === 'drums' && !BONGOS.includes(v.part)) continue;
      for (const id of v.ids) {
        const m = doc.modules.find((x) => x.id === id)!;
        if ((m.type !== 'osc' && m.type !== 'complex') || wired(id)) continue;
        const semis = aboveC(freqOf(m.type, m.params, 'freq'));
        const off = Math.min(...SCALES[scale]!.map((d) => centsFrom(semis, (root + d) % 12)));
        if (off > 5)
          bad.push(
            `seed ${seed} (${style}) ${v.part} ${id} ${freqOf(m.type, m.params, 'freq').toFixed(2)} Hz is off the scale by ${off.toFixed(0)} cents`,
          );
      }
    }
  }
  expect(bad).toEqual([]);
});

test('a kit has at most one kick; techno plays it on 1, 5, 9, 13, the others on 3 to 5 steps', () => {
  for (let seed = 1; seed <= 500; seed++) {
    const { parts } = dicePatch(SPECS, seed);
    expect(parts.filter((p) => p.startsWith('kick')).length, `seed ${seed}`).toBeLessThanOrEqual(1);
  }
  for (const kit of ['drums-techno', 'drums-acid', 'drums-dub', 'drums-industrial']) {
    for (let seed = 1; seed <= 100; seed++) {
      const { doc, value: v } = buildWith(SPECS, (S) => {
        let s = seed;
        const R = () => (s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32;
        return PARTS[kit]!({ S, R, scale: 2, root: 0, bpm: 120, x: 0, y: 0 });
      });
      expect(
        v.members!.filter((p) => p.startsWith('kick')),
        `${kit} seed ${seed}`,
      ).toHaveLength(1);
      const params = doc.modules.find((m) => m.id === v.seq)!.params;
      const gate = laneSteps(params, 0, 'g').slice(0, laneLen(params, 0, 'g'));
      const hits = gate.flatMap((x, i) => (x === 1 ? [i + 1] : []));
      if (kit === 'drums-techno') expect(hits, `seed ${seed}`).toEqual([1, 5, 9, 13]);
      else expect(hits.length, `${kit} seed ${seed}`).toBeGreaterThanOrEqual(3);
      if (kit !== 'drums-techno') expect(hits.length, `${kit} seed ${seed}`).toBeLessThanOrEqual(5);
    }
  }
});

test("every twist in a style's pool applies in that style at least once in 500 seeds", () => {
  const never: string[] = [];
  for (const id of STYLE_IDS) {
    const seen = new Set<string>();
    for (let seed = 1; seed <= 500; seed++)
      for (const t of dicePatchIn(SPECS, STYLES[id]!, seed).twists) seen.add(t);
    for (const [t] of STYLES[id]!.twists) if (!seen.has(t)) never.push(`${id}: ${t}`);
  }
  expect(never).toEqual([]);
}, 60_000);

test('no random comparator anywhere in the dice folder (a shuffle is Fisher–Yates over R)', () => {
  const dir = fileURLToPath(new URL('.', import.meta.url));
  const files = readdirSync(dir, { recursive: true, encoding: 'utf8' }).filter(
    (f) => f.endsWith('.ts') && !f.endsWith('.test.ts'),
  );
  expect(files.length).toBeGreaterThan(5);
  for (const f of files)
    expect(readFileSync(dir + f, 'utf8'), f).not.toMatch(
      /\.sort\(\s*\(\s*\)\s*=>|\.sort\(\([^)]*\)\s*=>[^)]*\bR\(/,
    );
});

test('switch: the SPREAD is two long, so both of its outputs play and no hit is lost', () => {
  for (let seed = 1; seed <= 100; seed++) {
    let sp = '';
    const doc = build(SPECS, (S) => {
      let s = seed;
      const R = () => (s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32;
      const c: DiceCtx = { S, R, scale: 2, root: 0, bpm: 120, x: 0, y: 0 };
      const voices = ['drums-techno', 'bass-sub', 'pluck'].map((id, i) => PARTS[id]!({ ...c, y: i * 900 }));
      TWISTS.switch(c, voices);
    });
    sp = doc.modules.find((m) => m.type === 'spread')!.id;
    const len = fromKnob(
      SPECS['spread']!.params.find((p) => p.id === 'len') as KnobParam,
      doc.modules.find((m) => m.id === sp)!.params['len']!,
    );
    expect(Math.round(len), `seed ${seed}`).toBe(2);
  }
});

test("snh on a cutoff keeps the filter's own envelope depth and goes through an ATT", () => {
  const make = (twist: boolean) => {
    let fl = '';
    const doc = build(SPECS, (S) => {
      const c: DiceCtx = { S, R: () => 0.1, scale: 2, root: 0, bpm: 120, x: 0, y: 0 };
      const kit = PARTS['drums-acid']!(c);
      const bass = PARTS['bass-pulse']!({ ...c, y: 900 });
      fl = bass.cutoff![0];
      if (twist) expect(TWISTS.snh(c, [kit, bass])).not.toBeNull();
    });
    return { doc, fl };
  };
  const plain = make(false);
  const { doc, fl } = make(true);
  const own = plain.doc.modules.find((m) => m.id === plain.fl)!.atts['@cutoff'];
  expect(own).toBeDefined();
  expect(doc.modules.find((m) => m.id === fl)!.atts['@cutoff']).toBe(own);
  const into = doc.cables.filter((w) => w.to[0] === fl && w.to[1] === '@cutoff');
  expect(into.some((w) => doc.modules.find((m) => m.id === w.from[0])!.type === 'att')).toBe(true);
  expect(into.some((w) => doc.modules.find((m) => m.id === w.from[0])!.type === 'snh')).toBe(false);
});
