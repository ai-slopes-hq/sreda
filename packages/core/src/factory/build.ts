// Building factory patches in code: modules by type with real-unit values, cables, frames. Positions are in the
// prototype's units (×7/6, ×9/7 for the panels' room to breathe); STACK frames are packed, innermost first.
import { blankModule, type Doc, type Group } from '../doc';
import { chainOf, FRAME_MIN, GHEAD, GPAD, recomputeParents, rectOf, setLayout } from '../frames';
import { toKnob, type Specs } from '../spec';

export interface Builder {
  /** a module; `values` are knob values in real units or option indices */
  add(type: string, x: number, y: number, values?: Record<string, number>): string;
  wire(a: string, ap: string, b: string, bp: string): void;
  /** more knob values on an existing module, in the same units as `add` */
  set(id: string, values: Record<string, number>): void;
  /** a module's type */
  typeOf(id: string): string;
  /** every cable leaving output `from` leaves output `to` instead (a twist that reroutes a gate) */
  retarget(from: [string, string], to: [string, string]): void;
  att(id: string, port: string, v: number): void;
  rat(id: string, port: string, r: number): void;
  /** a META-SEQ; `params` in the document's units (knob positions, option indices), as `seqParams` gives them */
  seq(x: number, y: number, params: Record<string, number>): string;
  /** more params on an existing META-SEQ, in the same units as `seq` (a lane's steps, LEN, RATE) */
  seqSet(id: string, params: Record<string, number>): void;
  frame(ids: string[], name: string, o?: { ratio?: number; tint?: number; bpm?: number }): string;
}

const snap = (v: number): number => Math.round(v / 8) * 8;

// Every factory sequence is a META-SEQ. Its content is written here in the old RHYTHM / STAGES saved form (knob
// positions, option indices) — the input of the migration's `seqParams`, which turns a gate line and a melody line into
// one META-SEQ's params — so a preset plays as its pre-META-SEQ document opens.

/** a gate line (seqParams' first input, the old RHYTHM's EUCLID form): HITS spread over LEN, rotated by ROT; on
 * META-SEQ it becomes the GATE lane with GEN EUCLID */
export const euclidRhythm = (length: number, hits: number, rot = 0): Record<string, number> => ({
  mode: 0,
  length: (length - 1) / 15,
  hits: hits / 16,
  rot: rot / 15,
});

/** a gate line (seqParams' first input, the old RHYTHM's GRID form) over 16 steps: 'x' a hit, '-' a TIE, '.' off;
 * accents 'A' — META-SEQ's GATE, TIE and ACC lanes */
export function gridRhythm(gates: string, accents: string): Record<string, number> {
  const out: Record<string, number> = { mode: 1 };
  for (let i = 0; i < 16; i++) {
    out['g' + (i + 1)] = gates[i] === 'x' ? 1 : gates[i] === '-' ? 2 : 0;
    out['a' + (i + 1)] = accents[i] === 'A' ? 1 : 0;
  }
  return out;
}

/** a melody line (seqParams' second input, the old STAGES form): semitones 0…24 (12 = 0 V) on the steps, slides and
 * silent pulses (○) on the given steps (1-based); LEN is the line's length unless given; SCALE and GEN option indices,
 * ROOT 0…11. On META-SEQ it becomes the NOTE lane; alone it also gives GATE (○ rests off) and TIE (its slides), with a gate
 * line its slides go on TIE at that line's hits */
export function melodyLine(
  semis: number[],
  o: {
    slides?: number[];
    rests?: number[];
    length?: number;
    scale?: number;
    root?: number;
    gen?: number;
  } = {},
): Record<string, number> {
  const out: Record<string, number> = { length: ((o.length ?? semis.length) - 1) / 15 };
  semis.forEach((x, i) => (out['v' + (i + 1)] = x / 24));
  for (const k of o.slides ?? []) out['g' + k] = 1;
  for (const k of o.rests ?? []) out['p' + k] = 1;
  if (o.scale !== undefined) out['scale'] = o.scale;
  if (o.root !== undefined) out['root'] = o.root / 11;
  if (o.gen !== undefined) out['gen'] = o.gen;
  return out;
}

export function build(specs: Specs, f: (b: Builder) => unknown): Doc {
  return buildWith(specs, f).doc;
}

/** `build`, also handing back what `f` returned (a group's main output, for tests). */
export function buildWith<T>(specs: Specs, f: (b: Builder) => T): { doc: Doc; value: T } {
  let n = 1;
  let doc: Doc = { version: 1, modules: [], cables: [], groups: [], master: 1, nextId: 1 };
  const mod = (id: string) => doc.modules.find((m) => m.id === id)!;
  const b: Builder = {
    add(type, x, y, values = {}) {
      const id = `m${n++}`;
      const m = blankModule(specs, type, id, snap((x * 7) / 6), snap((y * 9) / 7));
      doc = { ...doc, modules: [...doc.modules, m] };
      b.set(id, values);
      return id;
    },
    set(id, values) {
      const m = mod(id);
      for (const [k, v] of Object.entries(values)) {
        const p = specs[m.type]!.params.find((q) => q.id === k);
        if (!p || p.kind === 'action') throw new Error(`no param ${k} on ${m.type}`);
        m.params[k] = p.kind === 'knob' ? toKnob(p, v) : v;
      }
    },
    typeOf: (id) => mod(id).type,
    retarget(from, to) {
      doc = {
        ...doc,
        cables: doc.cables.map((w) => (w.from[0] === from[0] && w.from[1] === from[1] ? { ...w, from: to } : w)),
      };
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
    seq(x, y, params) {
      const id = b.add('metaseq', x, y);
      b.seqSet(id, params);
      return id;
    },
    seqSet(id, params) {
      if (mod(id).type !== 'metaseq') throw new Error(`${id} is not a metaseq`);
      const ids = new Set(specs['metaseq']!.params.map((p) => p.id));
      for (const k of Object.keys(params)) if (!ids.has(k)) throw new Error(`no param ${k} on metaseq`);
      Object.assign(mod(id).params, params);
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
        collapsed: false,
        clock: { on: o.bpm !== undefined, bpm: o.bpm ?? 120 },
      };
      doc = { ...doc, groups: [...doc.groups, g] };
      return id;
    },
  };
  const value = f(b);
  doc = recomputeParents({ ...doc, nextId: n }, specs);
  // STACK is on by default: pack the innermost frames first, then their parents
  const depth = (id: string) => chainOf(doc, id).length;
  for (const g of [...doc.groups].sort((a, c) => depth(c.id) - depth(a.id)))
    doc = setLayout(doc, specs, g.id, 'stack');
  return { doc, value };
}
