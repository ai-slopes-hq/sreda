// Building factory patches in code: modules by type with real-unit values, cables, frames. Positions are in the
// prototype's units (×7/6, ×9/7 for the panels' room to breathe); STACK frames are packed, innermost first.
import { blankModule, type Doc, type Group } from '../doc';
import { chainOf, FRAME_MIN, GHEAD, GPAD, recomputeParents, rectOf, setLayout } from '../frames';
import { toKnob, type Specs } from '../spec';

export interface Builder {
  /** a module; `values` are knob values in real units or option indices */
  add(type: string, x: number, y: number, values?: Record<string, number>): string;
  wire(a: string, ap: string, b: string, bp: string): void;
  att(id: string, port: string, v: number): void;
  rat(id: string, port: string, r: number): void;
  /** STAGES' voltages from semitones 0…24 (12 = 0 V) and slides on the given stages (1-based) */
  notes(values: Record<string, number>, semis: number[], slides: number[]): Record<string, number>;
  /** RHYTHM's pads: 'x' on, '-' TIE, '.' off; accents 'A' */
  grid(id: string, gates: string, accents: string): void;
  frame(ids: string[], name: string, o?: { ratio?: number; tint?: number; bpm?: number }): string;
}

const snap = (v: number): number => Math.round(v / 8) * 8;

export function build(specs: Specs, f: (b: Builder) => void): Doc {
  let n = 1;
  let doc: Doc = { version: 1, modules: [], cables: [], groups: [], nextId: 1 };
  const mod = (id: string) => doc.modules.find((m) => m.id === id)!;
  const b: Builder = {
    add(type, x, y, values = {}) {
      const id = `m${n++}`;
      const m = blankModule(specs, type, id, snap((x * 7) / 6), snap((y * 9) / 7));
      for (const [k, v] of Object.entries(values)) {
        const p = specs[type]!.params.find((q) => q.id === k);
        if (!p || p.kind === 'action') throw new Error(`no param ${k} on ${type}`);
        m.params[k] = p.kind === 'knob' ? toKnob(p, v) : v;
      }
      doc = { ...doc, modules: [...doc.modules, m] };
      return id;
    },
    wire(a, ap, bb, bp) {
      doc = { ...doc, cables: [...doc.cables, { from: [a, ap], to: [bb, bp] }] };
    },
    att(id, port, v) {
      mod(id).atts[port] = v;
    },
    rat(id, port, r) {
      mod(id).ratios[port] = r;
    },
    notes(values, semis, slides) {
      const out = { ...values };
      semis.forEach((s, i) => (out['v' + (i + 1)] = (s - 12) / 12));
      for (const k of slides) out['g' + k] = 1;
      return out;
    },
    grid(id, gates, accents) {
      const m = mod(id);
      for (let i = 0; i < 16; i++) {
        m.params['g' + (i + 1)] = gates[i] === 'x' ? 1 : gates[i] === '-' ? 2 : 0;
        m.params['a' + (i + 1)] = accents[i] === 'A' ? 1 : 0;
      }
    },
    frame(ids, name, o = {}) {
      const id = `g${n++}`;
      const rs = ids.map((x) => rectOf(doc, specs, x));
      const x0 = Math.min(...rs.map((r) => r.x));
      const y0 = Math.min(...rs.map((r) => r.y));
      const x1 = Math.max(...rs.map((r) => r.x + r.w));
      const y1 = Math.max(...rs.map((r) => r.y + r.h));
      const g: Group = {
        id,
        name,
        x: x0 - GPAD,
        y: y0 - GPAD - GHEAD,
        w: Math.max(FRAME_MIN.w, x1 - x0 + 2 * GPAD),
        h: y1 - y0 + 2 * GPAD + GHEAD,
        parent: null,
        ratio: o.ratio ?? 1,
        tint: o.tint ?? 0,
        layout: 'free',
        muted: false,
        clock: { on: o.bpm !== undefined, bpm: o.bpm ?? 120 },
      };
      doc = { ...doc, groups: [...doc.groups, g] };
      return id;
    },
  };
  f(b);
  doc = recomputeParents({ ...doc, nextId: n }, specs);
  // STACK is on by default: pack the innermost frames first, then their parents
  const depth = (id: string) => chainOf(doc, id).length;
  for (const g of [...doc.groups].sort((a, c) => depth(c.id) - depth(a.id)))
    doc = setLayout(doc, specs, g.id, 'stack');
  return doc;
}
