import { inputPorts, RATIOS, specOf, toKnob, type Specs } from './spec';

export interface ModuleDoc {
  id: string;
  type: string;
  x: number;
  y: number;
  parent: string | null;
  /** knob position 0…1, or option index */
  params: Record<string, number>;
  atts: Record<string, number>;
  ratios: Record<string, number>;
}
export interface Cable {
  from: [string, string];
  to: [string, string];
}
/** `groups` (frames) arrive in Plan 3. */
export interface Doc {
  version: 1;
  modules: ModuleDoc[];
  cables: Cable[];
  groups: never[];
  nextId: number;
}

export const emptyDoc: Doc = { version: 1, modules: [], cables: [], groups: [], nextId: 1 };

/** The patch a first launch opens until the factory projects arrive (Plan 3): OSC (saw, 110 Hz) → OUT L. */
export function starterDoc(specs: Specs): Doc {
  const osc = {
    ...blankModule(specs, 'osc', 'm1', 0, 0),
    params: { ...defaultParams(specs, 'osc'), wave: 2 },
  };
  const out = blankModule(specs, 'out', 'm2', 360, 0);
  return {
    version: 1,
    modules: [osc, out],
    cables: [{ from: ['m1', 'out'], to: ['m2', 'l'] }],
    groups: [],
    nextId: 3,
  };
}

/** Every param of a type at its default: knobs as positions 0…1, options as indices. */
export function defaultParams(specs: Specs, type: string): Record<string, number> {
  const params: Record<string, number> = {};
  for (const p of specs[type]?.params ?? []) {
    if (p.kind === 'knob') params[p.id] = toKnob(p, p.def);
    else if (p.kind === 'option') params[p.id] = p.def;
  }
  return params;
}

export function blankModule(specs: Specs, type: string, id: string, x: number, y: number): ModuleDoc {
  return { id, type, x, y, parent: null, params: defaultParams(specs, type), atts: {}, ratios: {} };
}

/** Module types that were renamed: old saves open under the new name. */
const RENAMED: Record<string, string> = { sah: 'snh' };

const isObj = (x: unknown): x is Record<string, unknown> =>
  typeof x === 'object' && x !== null && !Array.isArray(x);
const isNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const numRecord = (x: unknown): x is Record<string, number> => isObj(x) && Object.values(x).every(isNum);
const isEnd = (x: unknown): x is [string, string] =>
  Array.isArray(x) && x.length === 2 && typeof x[0] === 'string' && typeof x[1] === 'string';

/**
 * A document from storage or a file, checked against the specs: the whole thing or nothing (null).
 * Missing params get their defaults; unknown params are dropped.
 */
export function validateDoc(json: unknown, specs: Specs): Doc | null {
  if (!isObj(json) || json['version'] !== 1 || !isNum(json['nextId'])) return null;
  const { modules, cables, groups } = json;
  if (!Array.isArray(modules) || !Array.isArray(cables) || !Array.isArray(groups) || groups.length > 0)
    return null;
  const out: ModuleDoc[] = [];
  const byId = new Map<string, ModuleDoc>();
  for (const m of modules) {
    if (!isObj(m) || typeof m['id'] !== 'string' || typeof m['type'] !== 'string') return null;
    const spec = specOf(specs, Object.hasOwn(RENAMED, m['type']) ? RENAMED[m['type']]! : m['type']);
    if (!spec || byId.has(m['id']) || !isNum(m['x']) || !isNum(m['y']) || m['parent'] !== null) return null;
    const params = m['params'] ?? {};
    const atts = m['atts'] ?? {};
    const ratios = m['ratios'] ?? {};
    if (!numRecord(params) || !numRecord(atts) || !numRecord(ratios)) return null;
    const merged = defaultParams(specs, spec.type);
    for (const key of Object.keys(merged)) if (key in params) merged[key] = params[key]!;
    const mod: ModuleDoc = {
      id: m['id'],
      type: spec.type,
      x: m['x'],
      y: m['y'],
      parent: null,
      params: merged,
      // attenuverters clamped to −1…+1; a ratio outside the allowed set falls back to its default (dropped)
      atts: Object.fromEntries(Object.entries(atts).map(([k, v]) => [k, Math.min(1, Math.max(-1, v))])),
      ratios: Object.fromEntries(Object.entries(ratios).filter(([, r]) => RATIOS.includes(r))),
    };
    byId.set(mod.id, mod);
    out.push(mod);
  }
  const outCables: Cable[] = [];
  for (const c of cables) {
    if (!isObj(c)) return null;
    const [f, t] = [c['from'], c['to']];
    if (!isEnd(f) || !isEnd(t)) return null;
    const from = byId.get(f[0]);
    const to = byId.get(t[0]);
    if (!from || !to) return null;
    if (!specs[from.type]!.outputs.some((p) => p.id === f[1])) return null;
    if (!inputPorts(specs[to.type]!).some((p) => p.id === t[1])) return null;
    outCables.push({ from: [f[0], f[1]], to: [t[0], t[1]] });
  }
  // never hand out an id that is in use
  const highest = Math.max(0, ...out.map((m) => Number(/^m(\d+)$/.exec(m.id)?.[1] ?? 0)));
  return {
    version: 1,
    modules: out,
    cables: outCables,
    groups: [],
    nextId: Math.max(json['nextId'], highest + 1),
  };
}
