// Edits: pure functions from a document to a new one. RuleError is for structural mistakes only.
import { blankModule, type Cable, type Doc, type ModuleDoc } from './doc';
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
  if (!specOf(specs, type)) throw new RuleError(`unknown module type ${type}`);
  const id = `m${doc.nextId}`;
  const m = blankModule(specs, type, id, snap(x), snap(y));
  return { doc: { ...doc, modules: [...doc.modules, m], nextId: doc.nextId + 1 }, id };
}

export function moveObjects(doc: Doc, ids: readonly string[], dx: number, dy: number): Doc {
  const set = new Set(ids);
  return {
    ...doc,
    modules: doc.modules.map((m) => (set.has(m.id) ? { ...m, x: snap(m.x + dx), y: snap(m.y + dy) } : m)),
  };
}

type End = 'out' | 'in' | null;
function endKind(doc: Doc, specs: Specs, [id, port]: [string, string]): End {
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

/** Remove modules and every cable touching them. */
export function deleteObjects(doc: Doc, ids: readonly string[]): Doc {
  const set = new Set(ids);
  return {
    ...doc,
    modules: doc.modules.filter((m) => !set.has(m.id)),
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
