// Edits: pure functions from a document to a new one. RuleError is for structural mistakes only.
import { blankModule, type Cable, type Doc, type ModuleDoc } from './doc';
import { recomputeParents, rootsOf, withDescendants } from './frames';
import { inputPorts, RATIOS, specOf, type Specs } from './spec';

export class RuleError extends Error {}

const GRID = 8;
const snap = (v: number): number => Math.round(v / GRID) * GRID;

function mapModule(doc: Doc, id: string, f: (m: ModuleDoc) => ModuleDoc): Doc {
  if (!doc.modules.some((m) => m.id === id)) throw new RuleError(`no module ${id}`);
  return { ...doc, modules: doc.modules.map((m) => (m.id === id ? f(m) : m)) };
}

export function addModule(
  doc: Doc,
  specs: Specs,
  type: string,
  x: number,
  y: number,
): { doc: Doc; id: string } {
  if (!specOf(specs, type) || specs[type]!.internal) throw new RuleError(`unknown module type ${type}`);
  const id = `m${doc.nextId}`;
  const m = blankModule(specs, type, id, snap(x), snap(y));
  return { doc: { ...doc, modules: [...doc.modules, m], nextId: doc.nextId + 1 }, id };
}

/**
 * Move modules and frames (a frame takes everything inside it). A module snaps to the 8 px grid; a frame moves by a
 * snapped delta. Only the moved roots are re-parented, and never into what moved with them.
 */
export function moveObjects(doc: Doc, specs: Specs, ids: readonly string[], dx: number, dy: number): Doc {
  const roots = rootsOf(doc, ids);
  const delta = new Map<string, [number, number]>();
  for (const id of roots) {
    const m = doc.modules.find((x) => x.id === id);
    if (m) delta.set(id, [snap(m.x + dx) - m.x, snap(m.y + dy) - m.y]);
    else if (doc.groups.some((g) => g.id === id))
      for (const d of withDescendants(doc, [id])) delta.set(d, [snap(dx), snap(dy)]);
  }
  const moved: Doc = {
    ...doc,
    modules: doc.modules.map((m) => {
      const d = delta.get(m.id);
      return d ? { ...m, x: m.x + d[0], y: m.y + d[1] } : m;
    }),
    groups: doc.groups.map((g) => {
      const d = delta.get(g.id);
      return d ? { ...g, x: g.x + d[0], y: g.y + d[1] } : g;
    }),
  };
  return recomputeParents(moved, specs, roots, [...delta.keys()]);
}

type End = 'out' | 'in' | null;
function endKind(doc: Doc, specs: Specs, [id, port]: [string, string]): End {
  if (doc.groups.some((g) => g.id === id)) return port === 'clkOut' ? 'out' : port === 'clkIn' ? 'in' : null;
  const m = doc.modules.find((x) => x.id === id);
  const spec = m && specs[m.type];
  if (!spec) return null;
  if (spec.outputs.some((p) => p.id === port)) return 'out';
  if (inputPorts(spec).some((p) => p.id === port)) return 'in';
  return null;
}

const sameCable = (a: Cable, b: Cable): boolean =>
  a.from[0] === b.from[0] && a.from[1] === b.from[1] && a.to[0] === b.to[0] && a.to[1] === b.to[1];

/** Connect two jacks given in either order. Inputs stack; an identical cable is not added twice. */
export function connect(doc: Doc, specs: Specs, a: [string, string], b: [string, string]): Doc {
  const ka = endKind(doc, specs, a);
  const kb = endKind(doc, specs, b);
  let cable: Cable;
  if (ka === 'out' && kb === 'in') cable = { from: [a[0], a[1]], to: [b[0], b[1]] };
  else if (ka === 'in' && kb === 'out') cable = { from: [b[0], b[1]], to: [a[0], a[1]] };
  else throw new RuleError(`cannot connect ${a.join('.')} to ${b.join('.')}`);
  if (doc.cables.some((c) => sameCable(c, cable))) return doc;
  return { ...doc, cables: [...doc.cables, cable] };
}

export function removeCable(doc: Doc, cable: Cable): Doc {
  const i = doc.cables.findIndex((c) => sameCable(c, cable));
  return i < 0 ? doc : { ...doc, cables: doc.cables.filter((_, j) => j !== i) };
}

/** Remove modules and frames (with everything inside them) and every cable touching them. */
export function deleteObjects(doc: Doc, ids: readonly string[]): Doc {
  const set = new Set(withDescendants(doc, ids));
  return {
    ...doc,
    modules: doc.modules.filter((m) => !set.has(m.id)),
    groups: doc.groups.filter((g) => !set.has(g.id)),
    cables: doc.cables.filter((c) => !set.has(c.from[0]) && !set.has(c.to[0])),
  };
}

/** A knob takes a position 0…1 (clamped); an option an index (clamped, whole). */
export function setParam(doc: Doc, specs: Specs, id: string, param: string, value: number): Doc {
  return mapModule(doc, id, (m) => {
    const p = specs[m.type]?.params.find((x) => x.id === param);
    if (!p || p.kind === 'action') throw new RuleError(`no param ${param} on ${m.type}`);
    const v =
      p.kind === 'knob'
        ? Math.min(1, Math.max(0, value))
        : Math.min(p.options.length - 1, Math.max(0, Math.round(value)));
    return { ...m, params: { ...m.params, [param]: v } };
  });
}

/** An attenuverter −1…+1 on an input or mod jack; null returns it to its default. */
export function setAtt(doc: Doc, id: string, port: string, v: number | null): Doc {
  return mapModule(doc, id, (m) => {
    const atts = { ...m.atts };
    if (v === null) delete atts[port];
    else atts[port] = Math.min(1, Math.max(-1, v));
    return { ...m, atts };
  });
}

/** A trigger input's ratio: −16…−2 (÷), 1, 2…8 (×). */
export function setRatio(doc: Doc, id: string, port: string, r: number): Doc {
  if (!RATIOS.includes(r)) throw new RuleError(`bad ratio ${r}`);
  return mapModule(doc, id, (m) => {
    const ratios = { ...m.ratios };
    if (r === 1) delete ratios[port];
    else ratios[port] = r;
    return { ...m, ratios };
  });
}

/** The role a cable end reads or writes; a frame's clock jacks are triggers. */
function roleOfEnd(doc: Doc, specs: Specs, [id, port]: [string, string]): string | undefined {
  if (doc.groups.some((g) => g.id === id)) return 'trigger';
  const spec = specs[doc.modules.find((m) => m.id === id)?.type ?? ''];
  return spec && [...spec.outputs, ...inputPorts(spec)].find((p) => p.id === port)?.role;
}

/** A module can go into a cable while it has inputs and outputs and no cables of its own. */
export function canInsert(doc: Doc, specs: Specs, id: string): boolean {
  const m = doc.modules.find((x) => x.id === id);
  const spec = m && specs[m.type];
  if (!spec || !spec.inputs.length || !spec.outputs.length) return false;
  return !doc.cables.some((c) => c.from[0] === id || c.to[0] === id);
}

/**
 * Split a cable with a module (spec §4): the source → the module's first input of the source's role (else its first
 * input); the module's first output of the target's role (else its first output) → the old target.
 */
export function insertIntoCable(doc: Doc, specs: Specs, id: string, cable: Cable): Doc {
  const spec = specs[doc.modules.find((m) => m.id === id)!.type]!;
  const from = roleOfEnd(doc, specs, cable.from);
  const to = roleOfEnd(doc, specs, cable.to);
  const inp = spec.inputs.find((p) => p.role === from) ?? spec.inputs[0]!;
  const out = spec.outputs.find((p) => p.role === to) ?? spec.outputs[0]!;
  const rest = removeCable(doc, cable);
  return {
    ...rest,
    cables: [...rest.cables, { from: cable.from, to: [id, inp.id] }, { from: [id, out.id], to: cable.to }],
  };
}
