import { expect, test } from 'vitest';
import { validateDoc, type Doc } from '../doc';
import { laneLen, laneSteps, noteMode, type Lane } from '../metaseq';
import { SPECS } from '../spec';
import { migrateSequencers } from './seq';

// Documents written in the old format by hand: knobs as positions 0…1, options as indices.
type Raw = {
  version: 1;
  modules: { id: string; type: string; x: number; y: number; parent: string | null; params: Record<string, number>; atts: Record<string, number>; ratios: Record<string, number> }[];
  cables: { from: [string, string]; to: [string, string] }[];
  groups: unknown[];
  master: number;
  nextId: number;
};
const mod = (id: string, type: string, x: number, params: Record<string, number> = {}, parent: string | null = null) => ({
  id,
  type,
  x,
  y: 0,
  parent,
  params,
  atts: {},
  ratios: {},
});
const lenPos = (n: number) => (n - 1) / 15;
/** volts −1…+1 as STAGES' v knob position */
const vPos = (v: number) => (v + 1) / 2;
const steps = (d: Doc, id: string, l: Lane) => laneSteps(d.modules.find((m) => m.id === id)!.params, 0, l);
const on = (xs: number[]) => xs.flatMap((x, i) => (x ? [i + 1] : []));

/** SLOPE → RHYTHM (grid, LEN 8) › GATE → STAGES › ADV (LEN 4), STAGES' CV → OSC, PLS → LPG, RHYTHM's ACC → CHANCE */
function acid(): Raw {
  const grid = { g1: 1, g2: 2, g3: 0, g4: 1, g5: 1, g6: 0, g7: 2, g8: 1 };
  return {
    version: 1,
    modules: [
      mod('m1', 'slope', 0),
      mod('m2', 'rhythm', 300, { ...grid, a1: 1, a5: 1, length: lenPos(8), mode: 1 }),
      { ...mod('m3', 'stages', 600, { v1: vPos(0.5), v2: vPos(-0.5), v3: vPos(1), g3: 1, length: lenPos(4), gen: 4, scale: 5, root: 3 / 11 }), y: 40 },
      mod('m4', 'osc', 900),
      mod('m5', 'lpg', 1200),
      mod('m6', 'chance', 1500),
      mod('m7', 'slope', 1800),
    ],
    cables: [
      { from: ['m1', 'eoc'], to: ['m2', 'clk'] },
      { from: ['m2', 'gate'], to: ['m3', 'adv'] },
      { from: ['m7', 'eoc'], to: ['m2', 'reset'] },
      { from: ['m1', 'eoc'], to: ['m3', 'reset'] },
      { from: ['m1', 'eoc'], to: ['m3', 'dice'] },
      { from: ['m3', 'cv'], to: ['m4', 'pitch'] },
      { from: ['m3', 'pulse'], to: ['m5', 'ping'] },
      { from: ['m2', 'acc'], to: ['m6', 'trig'] },
      { from: ['m2', 'eoc'], to: ['m7', 'trig'] },
    ],
    groups: [],
    master: 1,
    nextId: 8,
  };
}

test('the acid pair merges into one META-SEQ in the STAGES place, with its notes, gates, ties, accents and cables', () => {
  const notes: string[] = [];
  const d = validateDoc(migrateSequencers(acid(), notes), SPECS)!;
  expect(d).not.toBeNull();
  expect(d.modules.map((m) => [m.id, m.type])).toEqual([
    ['m1', 'slope'],
    ['m3', 'metaseq'],
    ['m4', 'osc'],
    ['m5', 'lpg'],
    ['m6', 'chance'],
    ['m7', 'slope'],
  ]);
  const seq = d.modules.find((m) => m.id === 'm3')!;
  expect([seq.x, seq.y]).toEqual([600, 40]);
  // notes: volts → semitones round(v·12 + 12), PLAYED, LEN 4
  expect(steps(d, 'm3', 'n').slice(0, 3)).toEqual([18, 6, 24]);
  expect(steps(d, 'm3', 'n')[3]).toBe(12);
  expect(noteMode(seq.params, 0)).toBe(0);
  expect(laneLen(seq.params, 0, 'n')).toBe(4);
  // pads: ● → GATE, — → TIE; STAGES' slide on stage 3 → TIE on RHYTHM's 3rd hit (step 5), where note 3 plays
  expect(on(steps(d, 'm3', 'g'))).toEqual([1, 4, 5, 8]);
  expect(on(steps(d, 'm3', 't'))).toEqual([2, 5, 7]);
  expect(on(steps(d, 'm3', 'a'))).toEqual([1, 5]);
  for (const l of ['g', 't', 'a'] as const) expect(laneLen(seq.params, 0, l)).toBe(8);
  // root and gen kept; 24 and 12 (C) are not in D♯ PMIN, so SCALE opens as CHR and the notes sound as they did
  expect(seq.params['scale']).toBe(0);
  expect(seq.params['root']).toBeCloseTo(3 / 11);
  expect(seq.params['gen']).toBe(4);
  // cables: CLK, RST from RHYTHM (its RST wins over STAGES'), DICE from STAGES; CV, PLS → GATE; ACC, EOC
  expect(d.cables).toEqual([
    { from: ['m1', 'eoc'], to: ['m3', 'clk'] },
    { from: ['m7', 'eoc'], to: ['m3', 'reset'] },
    { from: ['m1', 'eoc'], to: ['m3', 'dice'] },
    { from: ['m3', 'cv'], to: ['m4', 'pitch'] },
    { from: ['m3', 'gate'], to: ['m5', 'ping'] },
    { from: ['m3', 'acc'], to: ['m6', 'trig'] },
    { from: ['m3', 'eoc'], to: ['m7', 'trig'] },
  ]);
  expect(notes).toEqual([]);
});

test('a_fan_out_is_not_merged: a RHYTHM GATE that also feeds something else converts each module alone', () => {
  const doc = acid();
  doc.cables.push({ from: ['m2', 'gate'], to: ['m6', 'trig'] });
  doc.cables = doc.cables.filter((c) => !(c.from[0] === 'm2' && c.from[1] === 'acc'));
  const d = validateDoc(migrateSequencers(doc, []), SPECS)!;
  expect(d.modules.filter((m) => m.type === 'metaseq').map((m) => m.id)).toEqual(['m2', 'm3']);
  // the STAGES alone: NOTE on STEP, GATE from its pulses (all ● by default), its LEN on its lanes; ADV → CLK
  const stages = d.modules.find((m) => m.id === 'm3')!;
  expect(noteMode(stages.params, 0)).toBe(1);
  expect(on(steps(d, 'm3', 'g'))).toEqual(Array.from({ length: 16 }, (_, i) => i + 1));
  expect(laneLen(stages.params, 0, 'g')).toBe(4);
  // its slide stays on its own step
  expect(on(steps(d, 'm3', 't'))).toEqual([3]);
  expect(d.cables).toContainEqual({ from: ['m2', 'gate'], to: ['m3', 'clk'] });
  expect(d.cables).toContainEqual({ from: ['m2', 'gate'], to: ['m6', 'trig'] });
  // the RHYTHM alone: GATE and TIE from its pads; NOTE holds the default
  expect(on(steps(d, 'm2', 'g'))).toEqual([1, 4, 5, 8]);
  expect(new Set(steps(d, 'm2', 'n'))).toEqual(new Set([12]));
});

test('slides land on the played hits, wrapping when STAGES has more stages than RHYTHM has hits; none without hits', () => {
  const doc = acid();
  // 4 hits per RHYTHM cycle (steps 1, 4, 5, 8); slides on stages 2 and 7 → hits 2 and 3 (7 wraps to the 3rd)
  doc.modules[2]!.params = { g2: 1, g7: 1, length: lenPos(8) };
  let d = validateDoc(migrateSequencers(doc, []), SPECS)!;
  expect(on(steps(d, 'm3', 't'))).toEqual([2, 4, 5, 7]);
  // a RHYTHM with no hits: the slides have nowhere to go
  const silent = acid();
  silent.modules[1]!.params = { mode: 1, length: lenPos(8) };
  silent.modules[1]!.params['g2'] = 2;
  d = validateDoc(migrateSequencers(silent, []), SPECS)!;
  expect(on(steps(d, 'm3', 'g'))).toEqual([]);
  expect(on(steps(d, 'm3', 't'))).toEqual([2]);
});

test('a STAGES advanced by two RHYTHMs merges with neither: three META-SEQs, both cables on its CLK', () => {
  const doc = acid();
  doc.modules.push(mod('m8', 'rhythm', 2100, { mode: 1 }));
  doc.cables.push({ from: ['m1', 'eoc'], to: ['m8', 'clk'] }, { from: ['m8', 'gate'], to: ['m3', 'adv'] });
  doc.nextId = 9;
  const d = validateDoc(migrateSequencers(doc, []), SPECS)!;
  expect(d.modules.filter((m) => m.type === 'metaseq').map((m) => m.id)).toEqual(['m2', 'm3', 'm8']);
  const clk = d.cables.filter((c) => c.to[0] === 'm3' && c.to[1] === 'clk');
  expect(clk).toEqual([
    { from: ['m2', 'gate'], to: ['m3', 'clk'] },
    { from: ['m8', 'gate'], to: ['m3', 'clk'] },
  ]);
  expect(d.cables).toHaveLength(doc.cables.length);
});

test('STAGES never quantised its stages: an off-scale line opens as CHR, an in-scale one keeps its SCALE', () => {
  const lone = (v: Record<string, number>, scale?: number) => {
    const doc = acid();
    doc.modules = [mod('m3', 'stages', 0, { ...v, length: lenPos(4), ...(scale === undefined ? {} : { scale }), root: 2 / 11 })];
    doc.cables = [];
    const d = validateDoc(migrateSequencers(doc, []), SPECS)!;
    return d.modules[0]!.params;
  };
  // D DOR: D E F G A B C — 14 (D), 16 (E), 17 (F), 24 (C) in scale; 13 (C♯) is not
  const inScale = { v1: vPos(2 / 12), v2: vPos(4 / 12), v3: vPos(5 / 12), v4: vPos(1) };
  expect(lone(inScale, 3)['scale']).toBe(3);
  expect(lone({ ...inScale, v2: vPos(1 / 12) }, 3)['scale']).toBe(0);
  // a stage past LEN never plays: it does not count
  expect(lone({ ...inScale, v5: vPos(1 / 12) }, 3)['scale']).toBe(3);
  // no SCALE saved: the default MIN (D minor: D E F G A A♯ C); E is in it, B is not
  expect(lone(inScale)['scale']).toBe(2);
  expect(lone({ ...inScale, v2: vPos(11 / 12) })['scale']).toBe(0);
});

test('a lone RHYTHM in EUCLID 16/5/0 writes its pattern out: GATE on steps 1, 5, 8, 11, 14', () => {
  const doc = acid();
  doc.modules = [mod('m2', 'rhythm', 0, { mode: 0, length: 1, hits: 5 / 16, rot: 0 })];
  doc.cables = [];
  const d = validateDoc(migrateSequencers(doc, []), SPECS)!;
  expect(on(steps(d, 'm2', 'g'))).toEqual([1, 5, 8, 11, 14]);
  expect(on(steps(d, 'm2', 't'))).toEqual([]);
  // its GEN is EUCLID; a GRID RHYTHM keeps the default
  const gen = SPECS['metaseq']!.params.find((p) => p.id === 'gen')!;
  expect(gen.kind === 'option' && gen.options[d.modules[0]!.params['gen']!]).toBe('EUCLID');
  doc.modules[0]!.params['mode'] = 1;
  const grid = validateDoc(migrateSequencers(doc, []), SPECS)!;
  expect(grid.modules[0]!.params['gen']).toBe(0);
});

test('a free-running STAGES gets its frame clock; outside a frame a cycling SLOPE 300 px to its left', () => {
  const doc = acid();
  doc.modules = [
    mod('m1', 'stages', 400, {}, 'g2'),
    mod('m3', 'stages', 500),
    mod('m4', 'osc', 900),
  ];
  doc.groups = [
    { id: 'g2', name: 'A', x: 300, y: -100, w: 800, h: 600, parent: null, ratio: 1, tint: 0, layout: 'free', muted: false, collapsed: false, clock: { on: true, bpm: 120 } },
  ];
  doc.modules[1]!.y = 1000;
  doc.cables = [
    { from: ['m4', 'out'], to: ['m1', 'addr'] },
    { from: ['m3', 'cv'], to: ['m4', 'pitch'] },
  ];
  doc.nextId = 5;
  const notes: string[] = [];
  const d = validateDoc(migrateSequencers(doc, notes), SPECS)!;
  expect(d.cables).toContainEqual({ from: ['g2', 'clkOut'], to: ['m1', 'clk'] });
  const slope = d.modules.find((m) => m.type === 'slope')!;
  expect(slope).toMatchObject({ id: 'm5', x: 200, y: 1000, parent: null });
  expect(slope.params['cycle']).toBe(1);
  expect(d.cables).toContainEqual({ from: ['m5', 'eoc'], to: ['m3', 'clk'] });
  expect(d.cables.some((c) => c.to[1] === 'addr')).toBe(false);
  expect(d.nextId).toBe(6);
  expect(notes).toContain('STAGES › free-running timing now follows a clock');
  expect(notes.some((n) => n.includes('ADDR'))).toBe(true);
  // each note once
  expect(new Set(notes).size).toBe(notes.length);
});

test('ids and nextId stay unique', () => {
  const doc = acid();
  doc.modules.push(mod('m9', 'stages', 0, {}, null));
  doc.nextId = 3; // stale: lower than ids in use
  const d = validateDoc(migrateSequencers(doc, []), SPECS)!;
  const ids = d.modules.map((m) => m.id);
  expect(new Set(ids).size).toBe(ids.length);
  expect(ids).toContain('m10');
  expect(d.nextId).toBe(11);
});

test('a document with no sequencers is returned as it is', () => {
  const doc = acid();
  doc.modules = doc.modules.filter((m) => m.type !== 'rhythm' && m.type !== 'stages');
  doc.cables = [];
  expect(migrateSequencers(doc, [])).toBe(doc);
  expect(migrateSequencers('junk', [])).toBe('junk');
});

test('validateDoc migrates and reports the notes', () => {
  const doc = acid();
  doc.modules = [mod('m3', 'stages', 0)];
  doc.cables = [];
  const notes: string[] = [];
  expect(validateDoc(doc, SPECS, notes)!.modules[0]!.type).toBe('metaseq');
  expect(notes).toEqual(['STAGES › free-running timing now follows a clock']);
});
