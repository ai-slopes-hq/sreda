// Small inline specs for tests (not the generated ones), so tests state exactly what they rely on.
import type { KnobParam, ModuleSpec, Normal, Port, Role, Specs } from './spec';

export const p = (id: string, role: Role): Port => ({ id, label: id.toUpperCase(), role });
export const k = (id: string, o: Partial<KnobParam> = {}): KnobParam => ({
  kind: 'knob',
  id,
  label: id.toUpperCase(),
  min: 0,
  max: 1,
  def: 0.5,
  taper: 'lin',
  ...o,
});

export function mod(type: string, o: Partial<ModuleSpec>): ModuleSpec {
  return {
    type,
    label: type.toUpperCase(),
    desc: '',
    size: [3, 1],
    inputs: [],
    outputs: [],
    params: [],
    normals: [],
    ...o,
  };
}

export const TEST_SPECS: Specs = {
  src: mod('src', { outputs: [p('out', 'audio')], params: [k('lvl')] }),
  fx: mod('fx', {
    inputs: [p('in', 'audio'), p('cv', 'mod'), p('clk', 'trigger')],
    outputs: [p('out', 'audio'), p('eoc', 'trigger')],
    params: [
      k('amt', { modDepth: 0.25 }),
      { kind: 'option', id: 'cyc', label: 'CYC', options: ['OFF', 'ON'], def: 0 },
      k('h', { hidden: true, min: 0, max: 10, def: 2 }),
    ],
    normals: [
      { kind: 'own', input: 'clk', own: 'eoc', when: { param: 'cyc', value: 1 } } as Normal,
      { kind: 'value', input: 'cv', value: 1 },
    ],
  }),
  sink: mod('sink', {
    inputs: [p('l', 'audio'), p('r', 'audio')],
    params: [k('lvl')],
    normals: [{ kind: 'internal', input: 'r', internal: 'L' }],
  }),
};
