import specsJson from './generated/specs.json';

// Module specs as TypeScript sees them: the shapes of generated/specs.json (written by `pnpm specs` from Rust).
export type Role = 'audio' | 'mod' | 'pitch' | 'trigger';
export interface Port {
  id: string;
  label: string;
  role: Role;
  /** a trigger input that keeps its level (no pulses, no ratio) */
  held?: boolean;
}
export interface KnobParam {
  kind: 'knob';
  id: string;
  label: string;
  min: number;
  max: number;
  def: number;
  taper: 'lin' | 'exp';
  step?: number;
  unit?: 'hz' | 's' | 'note' | 'db' | 'pattern';
  randomRange?: [number, number];
  modDepth?: number;
  hidden?: boolean;
  glyph?: string;
}
export interface OptionParam {
  kind: 'option';
  id: string;
  label: string;
  options: string[];
  def: number;
  glyph?: string;
  hidden?: boolean;
}
export interface ActionParam {
  kind: 'action';
  id: string;
  label: string;
}
export type Param = KnobParam | OptionParam | ActionParam;
export type Normal =
  | { kind: 'own'; input: string; own: string; when?: { param: string; value: number } }
  | { kind: 'internal'; input: string; internal: string }
  | { kind: 'value'; input: string; value: number };
export interface ModuleSpec {
  type: string;
  label: string;
  desc: string;
  size: [number, number];
  inputs: Port[];
  outputs: Port[];
  params: Param[];
  normals: Normal[];
  display?: { lanes: number; kind: string };
  /** never offered in the picker or allowed in a document (a frame's clock) */
  internal?: boolean;
}
export type Specs = Record<string, ModuleSpec>;

/** A spec by type, never a plain-object key such as `toString` or `constructor`. */
export function specOf(specs: Specs, type: string): ModuleSpec | undefined {
  return Object.hasOwn(specs, type) ? specs[type] : undefined;
}

/** The ratios a trigger input takes: ÷16 … ÷2, 1, ×2 … ×8. */
export const RATIOS: readonly number[] = [
  -16, -15, -14, -13, -12, -11, -10, -9, -8, -7, -6, -5, -4, -3, -2, 1, 2, 3, 4, 5, 6, 7, 8,
];

export const SPECS: Specs = Object.fromEntries(
  (specsJson as unknown as ModuleSpec[]).map((s) => [s.type, s]),
);

/** Knob position 0…1 → value: log space for an exp taper, clamped, snapped to the step (as Rust's from_knob). */
export function fromKnob(p: KnobParam, knob: number): number {
  const k = Math.min(1, Math.max(0, knob));
  const v = p.taper === 'exp' ? p.min * Math.pow(p.max / p.min, k) : p.min + (p.max - p.min) * k;
  return p.step ? Math.round(v / p.step) * p.step : v;
}

/** Value → knob position 0…1. */
export function toKnob(p: KnobParam, value: number): number {
  const k =
    p.taper === 'exp' ? Math.log(value / p.min) / Math.log(p.max / p.min) : (value - p.min) / (p.max - p.min);
  return Math.min(1, Math.max(0, k));
}

/** The module's inputs, then a mod jack `@<param>` (role mod) per visible knob, in spec order. */
export function inputPorts(spec: ModuleSpec): Port[] {
  const jacks = spec.params
    .filter((p): p is KnobParam => p.kind === 'knob' && !p.hidden)
    .map((p) => ({ id: '@' + p.id, label: p.label, role: 'mod' as const }));
  return [...spec.inputs, ...jacks];
}

/**
 * Hidden knobs a display drives by message only (SAMPLER's `scrub` and `play`, spec §7a): the engine always starts at
 * −1 (off), and they are neither in a document's params nor saved.
 */
export const TRANSIENT_PARAMS: ReadonlySet<string> = new Set(['scrub', 'play']);
