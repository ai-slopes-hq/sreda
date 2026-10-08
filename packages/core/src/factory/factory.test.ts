import { expect, test } from 'vitest';
import { validateDoc } from '../doc';
import { packFrame } from '../frames';
import { SPECS, toKnob, type KnobParam } from '../spec';
import { FACTORY } from './index';

const entry = (name: string) => FACTORY.find((e) => e.name === name)!;
const knob = (type: string, id: string) => SPECS[type]!.params.find((p) => p.id === id) as KnobParam;

test('the factory: six projects and four groups', () => {
  expect(FACTORY.filter((e) => e.kind === 'project').map((e) => e.name)).toEqual([
    'pulse',
    'drone',
    'self-clocked',
    'polymeter',
    'ratchet',
    'acid',
  ]);
  expect(FACTORY.filter((e) => e.kind === 'group').map((e) => e.name)).toEqual([
    '303 voice',
    'complex vco',
    'bleep-bloop',
    'vca-lpg',
  ]);
});

test.each(FACTORY.map((e) => [e.name, e] as const))(
  '%s is a valid document, its frames packed in WIRE FIX',
  (_n, e) => {
    const doc = e.build(SPECS);
    expect(validateDoc(JSON.parse(JSON.stringify(doc)), SPECS)).toEqual(doc);
    for (const g of doc.groups) {
      expect(g.layout).toBe('route');
      expect(packFrame(doc, SPECS, g.id, 'route')).toEqual(doc);
    }
    if (e.kind === 'group') {
      const tops = doc.groups.filter((g) => g.parent === null);
      expect(tops).toHaveLength(1);
      expect(doc.modules.every((m) => m.parent !== null)).toBe(true);
    }
  },
);

test('Acid: x.x-..x.x.xx-.x. with accents on 12 and 15, ×4 on the clock, 16 notes in C minor, frame ACID at 128 BPM', () => {
  const doc = entry('acid').build(SPECS);
  const rhythm = doc.modules.find((m) => m.type === 'rhythm')!;
  const gates = Array.from({ length: 16 }, (_, i) => '.x-'[rhythm.params['g' + (i + 1)]!]).join('');
  expect(gates).toBe('x.x-..x.x.xx-.x.');
  expect(rhythm.params['a12']).toBe(1);
  expect(rhythm.params['a15']).toBe(1);
  expect(rhythm.params['mode']).toBe(1);
  expect(rhythm.ratios['clk']).toBe(4);
  const acid = doc.groups.find((g) => g.name === 'ACID')!;
  expect(acid.clock).toEqual({ on: true, bpm: 128 });
  expect(doc.cables).toContainEqual({ from: [acid.id, 'clkOut'], to: [rhythm.id, 'clk'] });
  const stages = doc.modules.find((m) => m.type === 'stages')!;
  expect(stages.params['scale']).toBe(2);
  expect([3, 6, 11, 14].map((k) => stages.params['g' + k])).toEqual([1, 1, 1, 1]);
  expect(stages.params['v3']).toBeCloseTo(toKnob(knob('stages', 'v3'), 0), 6);
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
