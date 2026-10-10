// Document → plan: one node per module, inputs resolved (cables, normals), the run order with feedback loops
// found (Tarjan), and the readout layout.
import type { Cable, Doc } from './doc';
import { chainOf, descendants, effectiveMuted } from './frames';
import {
  READOUT_CAPACITY,
  TRACE_LEN,
  type FramePlan,
  type InputPlan,
  type Plan,
  type PlanNode,
  type Step,
} from './plan';
import { fromKnob, inputPorts, TRANSIENT_PARAMS, type ModuleSpec, type Specs } from './spec';

/** A frame's clock node: frames are compiled after the modules, in document order. */
export function clockNode(doc: Doc, gid: string): number {
  return doc.modules.length + doc.groups.findIndex((g) => g.id === gid);
}

/**
 * `sampleId` turns a module's sample path into the id the engine's pool knows it by (−1: none, or not loaded); it
 * goes into the fixed slot of the hidden knob `sample`.
 */
export function compile(doc: Doc, specs: Specs, seq: number, sampleId?: (path: string) => number): Plan {
  const nm = doc.modules.length;
  const index = new Map([
    ...doc.modules.map((m, i) => [m.id, i] as const),
    ...doc.groups.map((g, k) => [g.id, nm + k] as const),
  ]);
  const specOf = (i: number): ModuleSpec => (i < nm ? specs[doc.modules[i]!.type]! : specs['clock']!);
  const n = nm + doc.groups.length;
  const edges: number[][] = Array.from({ length: n }, () => []);
  // cables by input (`id\0port`), and the outputs that have any: looked up, never searched
  const into = new Map<string, Cable[]>();
  const used = new Set<string>();
  for (const c of doc.cables) {
    const k = c.to[0] + '\0' + c.to[1];
    into.set(k, [...(into.get(k) ?? []), c]);
    used.add(c.from[0] + '\0' + c.from[1]);
  }
  const frameIndex = new Map(doc.groups.map((g, k) => [g.id, k]));
  const chains = new Map<string, string[]>();
  const chain = (id: string): string[] => {
    let c = chains.get(id);
    if (!c) chains.set(id, (c = chainOf(doc, id)));
    return c;
  };
  /** the innermost frame a cable leaves (holding its source, not its target): muting it silences the cable */
  const gateOf = (c: Cable): number | undefined => {
    const to = chain(c.to[0]);
    const left = chain(c.from[0]).find((g) => !to.includes(g));
    return left === undefined ? undefined : frameIndex.get(left);
  };
  /** the plan source a cable's `from` end reads: a module's output, or a frame's clock */
  const sourceOf = (c: Cable) => {
    const from = index.get(c.from[0])!;
    const gate = gateOf(c);
    return {
      node: from,
      port: from < nm ? specOf(from).outputs.findIndex((o) => o.id === c.from[1]) : 0,
      late: false,
      ...(gate === undefined ? {} : { gate }),
    };
  };

  const nodes: PlanNode[] = doc.modules.map((m, i) => {
    const spec = specOf(i);
    const knobs: number[] = [];
    const fixed: number[] = [];
    for (const p of spec.params) {
      if (p.kind === 'knob' && !p.hidden) knobs.push(m.params[p.id] ?? 0);
      else if (p.kind === 'knob' && p.id === 'sample')
        fixed.push(m.sample && sampleId ? sampleId(m.sample) : -1);
      else if (p.kind === 'knob' && TRANSIENT_PARAMS.has(p.id)) fixed.push(-1);
      else if (p.kind === 'knob') fixed.push(fromKnob(p, m.params[p.id] ?? 0));
      else if (p.kind === 'option') fixed.push(m.params[p.id] ?? 0);
    }
    const inputs: InputPlan[] = inputPorts(spec).map((port) => {
      const sources = (into.get(m.id + '\0' + port.id) ?? []).map((c) => {
        const src = sourceOf(c);
        edges[src.node]!.push(i);
        return src;
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
    const connectedOut = spec.outputs.map((o) => used.has(m.id + '\0' + o.id));
    const gate = m.type === 'out' && m.parent ? frameIndex.get(m.parent) : undefined;
    return {
      id: m.id,
      type: m.type,
      knobs,
      fixed,
      inputs,
      connectedOut,
      ...(gate === undefined ? {} : { gate }),
    };
  });
  // each frame: a clock node; CLK IN takes its cables, else its parent frame's clock (through this frame's ratio)
  doc.groups.forEach((g, k) => {
    const i = nm + k;
    const sources = (into.get(g.id + '\0clkIn') ?? []).map((c) => {
      const src = sourceOf(c);
      edges[src.node]!.push(i);
      return src;
    });
    const parent = g.parent ? index.get(g.parent) : undefined;
    if (parent !== undefined) edges[parent]!.push(i);
    nodes.push({
      id: g.id,
      type: 'clock',
      knobs: [],
      fixed: [g.clock.on ? 1 : 0, g.clock.bpm],
      inputs: [
        {
          sources,
          // the parent's clock runs first: read as it is now (one sample late only inside a loop, below)
          normal: parent !== undefined ? { node: parent, port: 0, late: false } : null,
          kind: 'trigger',
          att: 1,
          ratio: g.ratio,
        },
      ],
      connectedOut: [used.has(g.id + '\0clkOut')],
    });
  });

  const steps = order(n, edges);
  // inside a loop, an edge from a node that runs at or after its target is read one sample late
  for (const s of steps) {
    if (!('loop' in s)) continue;
    const pos = new Map(s.loop.map((v, j) => [v, j]));
    for (const v of s.loop)
      for (const input of nodes[v]!.inputs) {
        for (const src of input.sources)
          if (pos.has(src.node) && pos.get(src.node)! >= pos.get(v)!) src.late = true;
        const n = input.normal;
        if (n && typeof n === 'object' && 'late' in n && pos.has(n.node) && pos.get(n.node)! >= pos.get(v)!)
          n.late = true;
      }
  }

  let off = 2; // 0: seq, 1: the master peak
  const layout = nodes.map((_, i) => {
    const spec = specOf(i);
    const knobs = off;
    off += spec.params.filter((p) => p.kind === 'knob' && !p.hidden).length;
    const trigs = off;
    off += spec.inputs.filter((p) => p.role === 'trigger').length;
    const outs = off;
    off += spec.outputs.length;
    const state = off++;
    let trace: number | null = null;
    if (spec.display?.kind === 'scope' || spec.display?.kind === 'grains' || spec.display?.kind === 'metaseq') {
      trace = off;
      off += TRACE_LEN;
    }
    return { knobs, trigs, outs, state, trace };
  });
  // the frame meters: one float per frame
  const framesAt = off;
  off += doc.groups.length;
  if (off > READOUT_CAPACITY) throw new Error(`readouts need ${off} floats, more than ${READOUT_CAPACITY}`);
  return {
    seq,
    nodes,
    steps,
    frames: framePlans(doc, specs, index),
    layout: { size: off, nodes: layout, frames: framesAt },
  };
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

/** Per frame: muted (itself or a parent), the audio sources whose cables leave it, and the OUT nodes inside it. */
function framePlans(doc: Doc, specs: Specs, index: Map<string, number>): FramePlan[] {
  const byId = new Map(doc.modules.map((m) => [m.id, m]));
  return doc.groups.map((g) => {
    const inside = new Set(descendants(doc, g.id));
    const sources: FramePlan['sources'] = [];
    for (const c of doc.cables) {
      const m = byId.get(c.from[0]);
      if (!m || !inside.has(m.id) || inside.has(c.to[0]) || c.to[0] === g.id) continue;
      const port = specs[m.type]!.outputs.findIndex((o) => o.id === c.from[1]);
      if (specs[m.type]!.outputs[port]?.role !== 'audio') continue;
      const node = index.get(m.id)!;
      if (!sources.some((s) => s.node === node && s.port === port)) sources.push({ node, port });
    }
    const outs = doc.modules.filter((m) => m.type === 'out' && inside.has(m.id)).map((m) => index.get(m.id)!);
    return { id: g.id, muted: effectiveMuted(doc, g.id), sources, outs };
  });
}
