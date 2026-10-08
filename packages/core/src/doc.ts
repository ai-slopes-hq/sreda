import { FRAME_MIN, isGroupId, recomputeParents, TINTS } from './frames';
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
/** A frame (spec §5). Its jacks are `[id, 'clkIn']` and `[id, 'clkOut']`. */
export interface Group {
  id: string;
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
  parent: string | null;
  /** the CLK IN ratio */
  ratio: number;
  tint: number;
  layout: 'free' | 'route';
  muted: boolean;
  clock: { on: boolean; bpm: number };
}
export interface Doc {
  version: 1;
  modules: ModuleDoc[];
  cables: Cable[];
  groups: Group[];
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
  const { modules, cables } = json;
  const groups = json['groups'] ?? [];
  if (!Array.isArray(modules) || !Array.isArray(cables) || !Array.isArray(groups)) return null;
  const outGroups: Group[] = [];
  const gIds = new Set<string>();
  for (const g of groups) {
    if (!isObj(g) || typeof g['id'] !== 'string' || !isGroupId(g['id']) || gIds.has(g['id'])) return null;
    if (![g['x'], g['y'], g['w'], g['h']].every(isNum)) return null;
    const clock = isObj(g['clock']) ? g['clock'] : {};
    const bpm = isNum(clock['bpm']) ? Math.min(300, Math.max(20, clock['bpm'])) : 120;
    const tint = isNum(g['tint']) ? Math.round(g['tint']) : 0;
    gIds.add(g['id']);
    outGroups.push({
      id: g['id'],
      name: typeof g['name'] === 'string' ? g['name'] : 'GROUP',
      x: g['x'] as number,
      y: g['y'] as number,
      w: Math.max(FRAME_MIN.w, g['w'] as number),
      h: Math.max(FRAME_MIN.h, g['h'] as number),
      parent: typeof g['parent'] === 'string' ? g['parent'] : null,
      ratio: isNum(g['ratio']) && RATIOS.includes(g['ratio']) ? g['ratio'] : 1,
      tint: tint >= 0 && tint < TINTS ? tint : 0,
      layout: g['layout'] === 'route' ? 'route' : 'free',
      muted: g['muted'] === true,
      clock: { on: clock['on'] === true, bpm },
    });
  }
  const out: ModuleDoc[] = [];
  const byId = new Map<string, ModuleDoc>();
  for (const m of modules) {
    if (!isObj(m) || typeof m['id'] !== 'string' || typeof m['type'] !== 'string') return null;
    const spec = specOf(specs, Object.hasOwn(RENAMED, m['type']) ? RENAMED[m['type']]! : m['type']);
    const parent = m['parent'] ?? null;
    if (!spec || byId.has(m['id']) || gIds.has(m['id']) || !isNum(m['x']) || !isNum(m['y'])) return null;
    if (parent !== null && typeof parent !== 'string') return null;
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
      parent,
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
    // a frame's clock jacks: cables to a frame that is not there are dropped
    if (isGroupId(f[0]) || isGroupId(t[0])) {
      const fromOk = isGroupId(f[0]) ? gIds.has(f[0]) && f[1] === 'clkOut' : byId.has(f[0]);
      const toOk = isGroupId(t[0]) ? gIds.has(t[0]) && t[1] === 'clkIn' : byId.has(t[0]);
      if (!fromOk || !toOk) continue;
      if (!isGroupId(f[0]) && !specs[byId.get(f[0])!.type]!.outputs.some((p) => p.id === f[1])) return null;
      if (!isGroupId(t[0]) && !inputPorts(specs[byId.get(t[0])!.type]!).some((p) => p.id === t[1])) return null;
      outCables.push({ from: [f[0], f[1]], to: [t[0], t[1]] });
      continue;
    }
    const from = byId.get(f[0]);
    const to = byId.get(t[0]);
    if (!from || !to) return null;
    if (!specs[from.type]!.outputs.some((p) => p.id === f[1])) return null;
    if (!inputPorts(specs[to.type]!).some((p) => p.id === t[1])) return null;
    outCables.push({ from: [f[0], f[1]], to: [t[0], t[1]] });
  }
  // never hand out an id that is in use
  const num = (id: string) => Number(/^[mg](\d+)$/.exec(id)?.[1] ?? 0);
  const highest = Math.max(0, ...out.map((m) => num(m.id)), ...outGroups.map((g) => num(g.id)));
  const doc: Doc = {
    version: 1,
    modules: out,
    cables: outCables,
    groups: outGroups,
    nextId: Math.max(json['nextId'], highest + 1),
  };
  // parents must name a frame and never loop; otherwise membership is recomputed from containment
  const valid = (p: string | null) => p === null || gIds.has(p);
  const parentOf = new Map(outGroups.map((g) => [g.id, g.parent]));
  const loops = outGroups.some((g) => {
    const seen = new Set<string>();
    for (let p: string | null = g.id; p; p = parentOf.get(p) ?? null) {
      if (seen.has(p)) return true;
      seen.add(p);
    }
    return false;
  });
  const sound = !loops && out.every((m) => valid(m.parent)) && outGroups.every((g) => valid(g.parent));
  return sound ? doc : recomputeParents(doc, specs);
}
