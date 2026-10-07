import { expect, test } from 'vitest';
import { fromKnob, inputPorts, SPECS, toKnob, type KnobParam, type ModuleSpec } from './spec';

const knob = (o: Partial<KnobParam>): KnobParam => ({
  kind: 'knob',
  id: 'k',
  label: 'K',
  min: 0,
  max: 1,
  def: 0,
  taper: 'lin',
  ...o,
});

test('an exp taper maps the middle to the geometric mean (as in Rust)', () => {
  const k = knob({ min: 20, max: 20_000, taper: 'exp' });
  expect(fromKnob(k, 0.5)).toBeCloseTo(Math.sqrt(20 * 20_000), 6);
  expect(toKnob(k, Math.sqrt(20 * 20_000))).toBeCloseTo(0.5, 9);
});

test('a stepped knob snaps', () => {
  expect(fromKnob(knob({ min: 1, max: 16, step: 1 }), 0.52)).toBe(9);
});

test('fromKnob clamps', () => {
  expect(fromKnob(knob({}), 1.7)).toBe(1);
  expect(fromKnob(knob({}), -0.2)).toBe(0);
});

test('inputPorts adds a mod jack per visible knob and skips hidden ones', () => {
  const spec: ModuleSpec = {
    type: 't',
    label: 'T',
    desc: '',
    size: [3, 1],
    inputs: [{ id: 'in', label: 'IN', role: 'audio' }],
    outputs: [],
    params: [
      knob({ id: 'a' }),
      knob({ id: 'b', hidden: true }),
      { kind: 'action', id: 'dice', label: 'DICE' },
    ],
    normals: [],
  };
  expect(inputPorts(spec).map((p) => [p.id, p.role])).toEqual([
    ['in', 'audio'],
    ['@a', 'mod'],
  ]);
});

test('the generated specs hold OSC and OUT', () => {
  expect(SPECS['osc']?.size).toEqual([5, 1]);
  expect(SPECS['out']?.inputs.map((p) => p.id)).toEqual(['l', 'r']);
  const freq = SPECS['osc']?.params.find((p) => p.id === 'freq');
  expect(freq).toMatchObject({
    kind: 'knob',
    taper: 'exp',
    def: 110,
    modDepth: 0.25,
    randomRange: [40, 880],
  });
});
