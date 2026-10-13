// WIRES (spec §5a): how wires and ports are named, which section a wire is listed in, the port lists, the problems.
import type { Cable, Doc } from './doc';
import { chainOf } from './frames';
import { nameOf, portLabel } from './names';
import { inputPorts, type Role, type Specs } from './spec';

/** The WIRES section a wire is listed in: the innermost frame holding both ends, else BETWEEN GROUPS or UNGROUPED. */
export type SectionKey = string;
export function wireSection(doc: Doc, cable: Cable): SectionKey {
  const a = chainOf(doc, cable.from[0]);
  const b = chainOf(doc, cable.to[0]);
  const both = a.find((g) => b.includes(g));
  if (both) return both;
  return a.length || b.length ? 'between' : 'ungrouped';
}

export interface WirePort {
  id: string;
  port: string;
  role: Role;
  label: string;
}

/** Every output (or input, mod jacks included) on the canvas, frames' CLK / CLK IN too. */
export function allPorts(doc: Doc, specs: Specs, dir: 'in' | 'out'): WirePort[] {
  const out: WirePort[] = [];
  for (const m of doc.modules) {
    const spec = specs[m.type]!;
    for (const p of dir === 'out' ? spec.outputs : inputPorts(spec))
      out.push({ id: m.id, port: p.id, role: p.role, label: portLabel(doc, specs, m.id, p.id) });
  }
  for (const g of doc.groups) {
    const port = dir === 'out' ? 'clkOut' : 'clkIn';
    out.push({ id: g.id, port, role: 'trigger', label: portLabel(doc, specs, g.id, port) });
  }
  return out;
}

export interface Problem {
  /** the module or frame to select */
  id: string;
  text: string;
  /** information, listed dimmed: a feedback loop, a muted frame */
  info: boolean;
}

/** processors whose sound input must be patched to make sense (SLOPE's IN, for one, is optional) */
const NEEDS_INPUT: Record<string, string> = {
  filter: 'in',
  lpg: 'in',
  fold: 'in',
  delay: 'in',
  follow: 'in',
  out: 'l',
};

/** What WIRES lists under PROBLEMS (spec §5a). */
/** `missing`: a sample path the library could not read (spec §7a). */
export function wireProblems(
  doc: Doc,
  specs: Specs,
  missing?: (path: string) => boolean,
  /** the MIDI device's status: an A4 / A4 CLK module is listed while it is not `connected` */
  midi?: 'connected' | 'missing' | 'unavailable',
): Problem[] {
  const res: Problem[] = [];
  const cabled = (id: string) => doc.cables.some((c) => c.from[0] === id || c.to[0] === id);
  // sound that reaches no OUT: walk back from every OUT along the cables
  const reach = new Set(doc.modules.filter((m) => m.type === 'out').map((m) => m.id));
  for (let changed = true; changed;) {
    changed = false;
    for (const c of doc.cables)
      if (reach.has(c.to[0]) && !reach.has(c.from[0])) {
        reach.add(c.from[0]);
        changed = true;
      }
  }
  for (const m of doc.modules) {
    if (m.type === 'out' || m.type === 'scope' || m.type === 'a4' || reach.has(m.id) || !cabled(m.id))
      continue;
    if (!specs[m.type]!.outputs.some((p) => p.role === 'audio')) continue;
    res.push({ id: m.id, text: `${nameOf(doc, specs, m.id)} — sound does not reach any OUT`, info: false });
  }
  for (const m of doc.modules) {
    const spec = specs[m.type]!;
    const need = NEEDS_INPUT[m.type];
    const patched = (port: string) => doc.cables.some((c) => c.to[0] === m.id && c.to[1] === port);
    if (need && !patched(need) && !spec.normals.some((n) => n.input === need))
      res.push({ id: m.id, text: `${portLabel(doc, specs, m.id, need)} — empty input`, info: false });
    if (m.sample && missing?.(m.sample))
      res.push({
        id: m.id,
        text: `${nameOf(doc, specs, m.id)} — MISSING · ${m.sample.split('/').pop()}`,
        info: false,
      });
    if ((m.type === 'a4' || m.type === 'a4clk') && midi && midi !== 'connected')
      res.push({
        id: m.id,
        text: `${nameOf(doc, specs, m.id)} — ${midi === 'missing' ? 'NOT CONNECTED' : 'NO MIDI'}`,
        info: false,
      });
    if (m.type === 'metaseq' && !patched('clk'))
      res.push({ id: m.id, text: `${portLabel(doc, specs, m.id, 'clk')} — no clock`, info: false });
  }
  // information: feedback loops (strongly connected modules) and muted frames
  const ids = doc.modules.map((m) => m.id);
  const adj = new Map(ids.map((id) => [id, doc.cables.filter((c) => c.from[0] === id).map((c) => c.to[0])]));
  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const stack: string[] = [];
  const on = new Set<string>();
  let n = 0;
  const visit = (v: string): void => {
    index.set(v, n);
    low.set(v, n++);
    stack.push(v);
    on.add(v);
    for (const w of adj.get(v) ?? []) {
      if (!adj.has(w)) continue; // a frame's clock
      if (!index.has(w)) {
        visit(w);
        low.set(v, Math.min(low.get(v)!, low.get(w)!));
      } else if (on.has(w)) low.set(v, Math.min(low.get(v)!, index.get(w)!));
    }
    if (low.get(v) === index.get(v)) {
      const comp: string[] = [];
      let w: string;
      do {
        w = stack.pop()!;
        on.delete(w);
        comp.push(w);
      } while (w !== v);
      if (comp.length > 1 || adj.get(v)!.includes(v)) {
        const names = comp.reverse().map((id) => nameOf(doc, specs, id));
        res.push({ id: comp[0]!, text: `loop: ${[...names, names[0]].join(' → ')}`, info: true });
      }
    }
  };
  for (const id of ids) if (!index.has(id)) visit(id);
  for (const g of doc.groups) if (g.muted) res.push({ id: g.id, text: `muted: ${g.name}`, info: true });
  return res;
}
