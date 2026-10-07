// Document → plan: one node per module, inputs resolved (cables, normals), the run order with feedback loops
// found (Tarjan), and the readout layout.
import type { Doc } from './doc';
import { READOUT_CAPACITY, TRACE_LEN, type InputPlan, type Plan, type PlanNode, type Step } from './plan';
import { fromKnob, inputPorts, type ModuleSpec, type Specs } from './spec';

export function compile(doc: Doc, specs: Specs, seq: number): Plan {
  const index = new Map(doc.modules.map((m, i) => [m.id, i]));
  const specOf = (i: number): ModuleSpec => specs[doc.modules[i]!.type]!;
  const n = doc.modules.length;
  const edges: number[][] = Array.from({ length: n }, () => []);

  const nodes: PlanNode[] = doc.modules.map((m, i) => {
    const spec = specOf(i);
    const knobs: number[] = [];
    const fixed: number[] = [];
    for (const p of spec.params) {
      if (p.kind === 'knob' && !p.hidden) knobs.push(m.params[p.id] ?? 0);
      else if (p.kind === 'knob') fixed.push(fromKnob(p, m.params[p.id] ?? 0));
      else if (p.kind === 'option') fixed.push(m.params[p.id] ?? 0);
    }
    const inputs: InputPlan[] = inputPorts(spec).map((port) => {
      const sources = doc.cables
        .filter((c) => c.to[0] === m.id && c.to[1] === port.id)
        .map((c) => {
          const from = index.get(c.from[0])!;
          edges[from]!.push(i);
          return { node: from, port: specOf(from).outputs.findIndex((o) => o.id === c.from[1]), late: false };
        });
      let normal: InputPlan['normal'] = null;
      const nm = sources.length ? undefined : spec.normals.find((x) => x.input === port.id);
      if (nm?.kind === 'own' && (!nm.when || m.params[nm.when.param] === nm.when.value)) {
        normal = { node: i, port: spec.outputs.findIndex((o) => o.id === nm.own) };
        edges[i]!.push(i);
      } else if (nm?.kind === 'internal') normal = 'internal';
      else if (nm?.kind === 'value') normal = { value: nm.value };
      const jack = port.id.startsWith('@') ? spec.params.find((p) => '@' + p.id === port.id) : undefined;
      const defAtt = jack?.kind === 'knob' ? (jack.modDepth ?? 1) : 1;
      return {
        sources,
        normal,
        kind: port.role === 'trigger' ? 'trigger' : port.role === 'audio' ? 'sum' : 'cv',
        att: m.atts[port.id] ?? defAtt,
        ratio: m.ratios[port.id] ?? 1,
      };
    });
    const connectedOut = spec.outputs.map((o) =>
      doc.cables.some((c) => c.from[0] === m.id && c.from[1] === o.id),
    );
    return { id: m.id, type: m.type, knobs, fixed, inputs, connectedOut };
  });

  const steps = order(n, edges);
  // inside a loop, an edge from a node that runs at or after its target is read one sample late
  for (const s of steps) {
    if (!('loop' in s)) continue;
    const pos = new Map(s.loop.map((v, j) => [v, j]));
    for (const v of s.loop)
      for (const input of nodes[v]!.inputs)
        for (const src of input.sources)
          if (pos.has(src.node) && pos.get(src.node)! >= pos.get(v)!) src.late = true;
  }

  let off = 2; // 0: seq, 1: the master peak
  const layout = doc.modules.map((_, i) => {
    const spec = specOf(i);
    const knobs = off;
    off += spec.params.filter((p) => p.kind === 'knob' && !p.hidden).length;
    const trigs = off;
    off += spec.inputs.filter((p) => p.role === 'trigger').length;
    const outs = off;
    off += spec.outputs.length;
    const state = off++;
    let trace: number | null = null;
    if (spec.display?.kind === 'scope') {
      trace = off;
      off += TRACE_LEN;
    }
    return { knobs, trigs, outs, state, trace };
  });
  if (off > READOUT_CAPACITY) throw new Error(`readouts need ${off} floats, more than ${READOUT_CAPACITY}`);
  return { seq, nodes, steps, layout: { size: off, nodes: layout } };
}

/** Strongly connected components (Tarjan), then a topological order that prefers document order. */
function order(n: number, edges: number[][]): Step[] {
  const idx = new Array<number>(n).fill(-1);
  const low = new Array<number>(n).fill(0);
  const onStack = new Array<boolean>(n).fill(false);
  const stack: number[] = [];
  const comp = new Array<number>(n).fill(-1);
  const comps: number[][] = [];
  let counter = 0;
  const visit = (v: number): void => {
    idx[v] = low[v] = counter++;
    stack.push(v);
    onStack[v] = true;
    for (const w of edges[v]!) {
      if (idx[w] === -1) {
        visit(w);
        low[v] = Math.min(low[v]!, low[w]!);
      } else if (onStack[w]) low[v] = Math.min(low[v]!, idx[w]!);
    }
    if (low[v] === idx[v]) {
      const c: number[] = [];
      let w: number;
      do {
        w = stack.pop()!;
        onStack[w] = false;
        comp[w] = comps.length;
        c.push(w);
      } while (w !== v);
      comps.push(c.sort((a, b) => a - b));
    }
  };
  for (let v = 0; v < n; v++) if (idx[v] === -1) visit(v);

  // Kahn over the components, always taking the ready one with the lowest document index
  const indeg = new Array<number>(comps.length).fill(0);
  const succ: Set<number>[] = comps.map(() => new Set());
  for (let v = 0; v < n; v++)
    for (const w of edges[v]!)
      if (comp[v] !== comp[w] && !succ[comp[v]!]!.has(comp[w]!)) {
        succ[comp[v]!]!.add(comp[w]!);
        indeg[comp[w]!]!++;
      }
  const done = new Array<boolean>(comps.length).fill(false);
  const steps: Step[] = [];
  for (let k = 0; k < comps.length; k++) {
    let best = -1;
    for (let c = 0; c < comps.length; c++)
      if (!done[c] && indeg[c] === 0 && (best < 0 || comps[c]![0]! < comps[best]![0]!)) best = c;
    done[best] = true;
    for (const w of succ[best]!) indeg[w]!--;
    const members = comps[best]!;
    const v = members[0]!;
    steps.push(members.length === 1 && !edges[v]!.includes(v) ? { node: v } : { loop: members });
  }
  return steps;
}
