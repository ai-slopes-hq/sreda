import { expect, test } from 'vitest';
import { validateDoc, type ModuleDoc } from '../doc';
import { packFrame, rectOf } from '../frames';
import { laneLen, laneSteps, noteMode, type Lane } from '../metaseq';
import { SPECS, toKnob, type KnobParam } from '../spec';
import { FACTORY } from './index';

const entry = (name: string) => FACTORY.find((e) => e.name === name)!;
const knob = (type: string, id: string) => SPECS[type]!.params.find((p) => p.id === id) as KnobParam;

test('the factory: ten projects and seventeen groups', () => {
  expect(FACTORY.filter((e) => e.kind === 'project').map((e) => e.name)).toEqual([
    'pulse',
    'drone',
    'self-clocked',
    'polymeter',
    'ratchet',
    'acid',
    'techno',
    'ambient bells',
    'dub',
    'generative',
  ]);
  expect(FACTORY.filter((e) => e.kind === 'group').map((e) => e.name)).toEqual([
    '303 voice',
    'complex vco',
    'bleep-bloop',
    'vca-lpg',
    'kick',
    'snare',
    'hats',
    'clap',
    'noisy techno drums',
    'fm bass',
    'reese',
    'pluck',
    'chaotic bells',
    'pad',
    'drone',
    'grain cloud',
    'frozen space',
  ]);
});

test.each(FACTORY.map((e) => [e.name, e] as const))(
  '%s is a valid document, its frames packed as STACK',
  (_n, e) => {
    const doc = e.build(SPECS);
    expect(validateDoc(JSON.parse(JSON.stringify(doc)), SPECS)).toEqual(doc);
    // sequenced by META-SEQ alone
    expect(doc.modules.filter((m) => m.type === 'rhythm' || m.type === 'stages')).toEqual([]);
    for (const g of doc.groups) {
      expect(g.layout).toBe('stack');
      expect(packFrame(doc, SPECS, g.id)).toEqual(doc);
    }
    if (e.kind === 'group') {
      const tops = doc.groups.filter((g) => g.parent === null);
      expect(tops).toHaveLength(1);
      expect(doc.modules.every((m) => m.parent !== null)).toBe(true);
    }
  },
);

test('Acid: one META-SEQ — x.x-..x.x.xx-.x. with accents on 12 and 15, ×4 on the clock, 16 notes in C minor with four slides on their hits, frame ACID at 128 BPM', () => {
  const doc = entry('acid').build(SPECS);
  const seqs = doc.modules.filter((m) => m.type === 'metaseq');
  expect(seqs).toHaveLength(1);
  const seq = seqs[0]!;
  const on = (l: Lane) => laneSteps(seq.params, 0, l).flatMap((x, i) => (x ? [i + 1] : []));
  // hits on 1 3 7 9 11 12 15; TIE pads on 4 and 13; the slides of stages 3, 6, 11, 14 on hits 3, 6, 4, 7 (wrapping)
  expect(on('g')).toEqual([1, 3, 7, 9, 11, 12, 15]);
  expect(on('t')).toEqual([4, 7, 9, 12, 13, 15]);
  expect(on('a')).toEqual([12, 15]);
  expect(laneSteps(seq.params, 0, 'n')).toEqual([0, 0, 12, 3, 7, 0, 10, 5, 0, 12, 3, 3, 7, 10, 0, 15]);
  expect(noteMode(seq.params, 0)).toBe(0);
  for (const l of ['n', 'g', 't', 'a'] as const) expect(laneLen(seq.params, 0, l)).toBe(16);
  expect(seq.params['scale']).toBe(2);
  expect(seq.ratios['clk']).toBe(4);
  const acid = doc.groups.find((g) => g.name === 'ACID')!;
  expect(acid.clock).toEqual({ on: true, bpm: 128 });
  expect(doc.cables).toContainEqual({ from: [acid.id, 'clkOut'], to: [seq.id, 'clk'] });
  expect(
    doc.cables
      .filter((c) => c.from[0] === seq.id)
      .map((c) => c.from[1])
      .sort(),
  ).toEqual(['acc', 'cv', 'gate', 'gate']);
});

test('Self-clocked: a lone line — 8 notes on STEP, GATE silent on stages 3 and 6, LEN 8', () => {
  const doc = entry('self-clocked').build(SPECS);
  const seq = doc.modules.find((m) => m.type === 'metaseq')!;
  const on = (l: Lane) => laneSteps(seq.params, 0, l).flatMap((x, i) => (x ? [i + 1] : []));
  expect(laneSteps(seq.params, 0, 'n').slice(0, 8)).toEqual([12, 15, 19, 12, 22, 17, 15, 10]);
  expect(noteMode(seq.params, 0)).toBe(1);
  expect(on('g').filter((k) => k <= 8)).toEqual([1, 2, 4, 5, 7, 8]);
  for (const l of ['n', 'g', 't'] as const) expect(laneLen(seq.params, 0, l)).toBe(8);
  const slope = doc.modules.find((m) => m.type === 'slope')!;
  expect(doc.cables).toContainEqual({ from: [slope.id, 'eoc'], to: [seq.id, 'clk'] });
});

test('Kick: a euclidean GATE, 4 hits on 16 steps, GEN EUCLID; FM bass: its 8 notes PLAYED on 7 hits', () => {
  const seqOf = (name: string) => entry(name).build(SPECS).modules.find((m) => m.type === 'metaseq')!;
  const on = (seq: ModuleDoc, l: Lane) => laneSteps(seq.params, 0, l).flatMap((x, i) => (x ? [i + 1] : []));
  const kick = seqOf('kick');
  expect(on(kick, 'g')).toEqual([1, 5, 9, 13]);
  expect(laneLen(kick.params, 0, 'g')).toBe(16);
  const gen = SPECS['metaseq']!.params.find((p) => p.id === 'gen')!;
  expect(gen.kind === 'option' && gen.options[kick.params['gen']!]).toBe('EUCLID');
  const bass = seqOf('fm bass');
  expect(on(bass, 'g')).toHaveLength(7);
  expect(laneSteps(bass.params, 0, 'n').slice(0, 8)).toEqual([0, 0, 12, 0, 3, 0, 7, 5]);
  expect(laneLen(bass.params, 0, 'n')).toBe(8);
  expect(noteMode(bass.params, 0)).toBe(0);
});

test('Polymeter: two lines of 5 and 7 notes on STEP, kept unquantised (SCALE CHR, as STAGES played them)', () => {
  const doc = entry('polymeter').build(SPECS);
  const seqs = doc.modules.filter((m) => m.type === 'metaseq');
  expect(seqs).toHaveLength(2);
  const notes = seqs.map((m) => laneSteps(m.params, 0, 'n').slice(0, laneLen(m.params, 0, 'n')));
  expect(notes).toEqual([
    [12, 16, 14, 19, 17],
    [6, 8, 6, 10, 6, 7, 9],
  ]);
  const scale = SPECS['metaseq']!.params.find((p) => p.id === 'scale')!;
  for (const m of seqs) {
    expect(scale.kind === 'option' && scale.options[m.params['scale']!]).toBe('CHR');
    expect(noteMode(m.params, 0)).toBe(1);
  }
});

test('Pulse: a 2 Hz square pings a kick LPG and, at ×2, a noise LPG; MIX → OUT', () => {
  const doc = entry('pulse').build(SPECS);
  const types = doc.modules.map((m) => m.type).sort();
  expect(types).toEqual(['lpg', 'lpg', 'mix', 'noise', 'osc', 'osc', 'out', 'scope']);
  const clock = doc.modules.find((m) => m.type === 'osc' && m.params['wave'] === 3)!;
  expect(clock.params['freq']).toBeCloseTo(toKnob(knob('osc', 'freq'), 2), 6);
  const hats = doc.cables.filter((c) => c.from[0] === clock.id && c.to[1] === 'ping').map((c) => c.to[0]);
  expect(hats.map((id) => doc.modules.find((m) => m.id === id)!.ratios['ping'] ?? 1).sort()).toEqual([1, 2]);
});

test('no factory module overlaps another, and every one sits inside its frame', () => {
  for (const e of FACTORY) {
    const d = e.build(SPECS);
    const r = d.modules.map((m) => ({ m, ...rectOf(d, SPECS, m.id) }));
    for (let i = 0; i < r.length; i++)
      for (let j = i + 1; j < r.length; j++) {
        const [a, b] = [r[i]!, r[j]!];
        const hit = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
        expect(hit, `${e.name}: ${a.m.type} over ${b.m.type}`).toBe(false);
      }
    for (const a of r) {
      const g = a.m.parent && rectOf(d, SPECS, a.m.parent);
      if (g) expect(a.y + a.h <= g.y + g.h && a.x + a.w <= g.x + g.w, `${e.name}: ${a.m.type}`).toBe(true);
    }
  }
});
