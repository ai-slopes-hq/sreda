// What WIRES lists (spec §5a, §1b): sections of wire rows, NORMALS, then PROBLEMS; empty sections are left out.
import {
  chainOf,
  hiddenIn,
  inputPorts,
  portLabel,
  wireProblems,
  wireSection,
  withDescendants,
  type Cable,
  type Doc,
  type Problem,
  type Role,
  type Specs,
} from '@sreda/core';

export interface WireRow {
  kind: 'wire';
  /** index into doc.cables */
  index: number;
  cable: Cable;
  text: string;
  fromLabel: string;
  toLabel: string;
  from: Role;
  to: Role;
  /** the collapsed frame this wire is hidden inside (dimmed, and picking it expands that frame) */
  collapsed: string | null;
  /** the destination's attenuverter or ratio; audio inputs have none */
  value: { kind: 'att' | 'ratio'; v: number; def: number } | null;
}
export interface NormalRow {
  kind: 'normal';
  id: string;
  /** the normal: `OUT › R ← L` */
  text: string;
  /** what it does: `until something is patched into R` */
  note: string;
  role: Role;
}
export interface ProblemRow {
  kind: 'problem';
  problem: Problem;
  text: string;
}
export type Row = WireRow | NormalRow | ProblemRow;
export interface Section {
  key: string;
  title: string;
  /** nesting depth (frames inside frames are indented) */
  depth: number;
  rows: Row[];
  count: number;
}

function roleIn(doc: Doc, specs: Specs, id: string, port: string): Role {
  const m = doc.modules.find((x) => x.id === id);
  if (!m) return 'trigger';
  return inputPorts(specs[m.type]!).find((p) => p.id === port)?.role ?? 'audio';
}
function roleOut(doc: Doc, specs: Specs, id: string, port: string): Role {
  const m = doc.modules.find((x) => x.id === id);
  if (!m) return 'trigger';
  return specs[m.type]!.outputs.find((p) => p.id === port)?.role ?? 'audio';
}

/** A destination's value: an attenuverter on CV inputs and mod jacks, a ratio on trigger inputs (CLK IN too). */
function valueOf(doc: Doc, specs: Specs, [id, port]: [string, string]): WireRow['value'] {
  const g = doc.groups.find((x) => x.id === id);
  if (g) return { kind: 'ratio', v: g.ratio, def: 1 };
  const m = doc.modules.find((x) => x.id === id)!;
  const role = roleIn(doc, specs, id, port);
  if (role === 'trigger') {
    if (inputPorts(specs[m.type]!).find((p) => p.id === port)?.held) return null; // held inputs have no ratio
    return { kind: 'ratio', v: m.ratios[port] ?? 1, def: 1 };
  }
  if (role === 'audio') return null;
  const knob = specs[m.type]!.params.find((p) => '@' + p.id === port);
  const def = knob?.kind === 'knob' ? (knob.modDepth ?? 1) : 1;
  return { kind: 'att', v: m.atts[port] ?? def, def };
}

export function wireSections(
  doc: Doc,
  specs: Specs,
  o: {
    q: string;
    selOnly: boolean;
    sel: readonly string[];
    missing?: readonly string[];
    /** the MIDI device's status (A4 modules are listed while it is not connected) */
    midi?: 'idle' | 'connected' | 'missing' | 'unavailable';
  },
): Section[] {
  const q = o.q.trim().toLowerCase();
  const sel = new Set(withDescendants(doc, o.sel));
  const keep = (text: string, ids: string[]) =>
    (!q || text.toLowerCase().includes(q)) && (!o.selOnly || ids.some((id) => sel.has(id)));
  const rows = new Map<string, Row[]>();
  const add = (key: string, row: Row) => rows.set(key, [...(rows.get(key) ?? []), row]);

  doc.cables.forEach((cable, index) => {
    const fromLabel = portLabel(doc, specs, cable.from[0], cable.from[1]);
    const toLabel = portLabel(doc, specs, cable.to[0], cable.to[1]);
    const text = `${fromLabel}  →  ${toLabel}`;
    if (!keep(text, [cable.from[0], cable.to[0]])) return;
    const collapsed = hiddenIn(doc, cable);
    add(wireSection(doc, cable), {
      kind: 'wire',
      index,
      cable,
      text: collapsed ? `${text}  (collapsed)` : text,
      collapsed,
      fromLabel,
      toLabel,
      from: roleOut(doc, specs, cable.from[0], cable.from[1]),
      to: roleIn(doc, specs, cable.to[0], cable.to[1]),
      value: valueOf(doc, specs, cable.to),
    });
  });
  // normals: an unpatched input reading its normal (an own one only while its option condition holds)
  for (const m of doc.modules) {
    const spec = specs[m.type]!;
    for (const n of spec.normals) {
      if (doc.cables.some((c) => c.to[0] === m.id && c.to[1] === n.input)) continue;
      if (n.kind === 'own' && n.when && m.params[n.when.param] !== n.when.value) continue;
      const source =
        n.kind === 'own'
          ? (spec.outputs.find((p) => p.id === n.own)?.label ?? n.own)
          : n.kind === 'internal'
            ? n.internal.toUpperCase()
            : (n.value >= 0 ? '+' : '') + n.value;
      const text = `${portLabel(doc, specs, m.id, n.input)} ← ${source}`;
      if (!keep(text, [m.id])) continue;
      const input = inputPorts(spec).find((p) => p.id === n.input)?.label ?? n.input.toUpperCase();
      add('normals', {
        kind: 'normal',
        id: m.id,
        text,
        note: `until something is patched into ${input}`,
        role: roleIn(doc, specs, m.id, n.input),
      });
    }
  }

  const out: Section[] = [];
  const section = (key: string, title: string, depth: number) => {
    const r = rows.get(key) ?? [];
    out.push({ key, title, depth, rows: r, count: r.filter((x) => x.kind === 'wire').length });
  };
  // frames, each followed by the frames inside it (indented), in reading order
  const name = (id: string) => doc.groups.find((g) => g.id === id)!.name;
  const visit = (parent: string | null, depth: number) => {
    const kids = doc.groups.filter((g) => g.parent === parent).sort((a, b) => a.y - b.y || a.x - b.x);
    for (const g of kids) {
      section(g.id, [...chainOf(doc, g.id)].reverse().map(name).join(' › '), depth);
      visit(g.id, depth + 1);
    }
  };
  visit(null, 0);
  section('ungrouped', 'UNGROUPED', 0);
  section('between', 'BETWEEN GROUPS', 0);
  const normals = rows.get('normals') ?? [];
  out.push({ key: 'normals', title: 'NORMALS', depth: 0, rows: normals, count: normals.length });
  const problems = wireProblems(doc, specs, (p) => o.missing?.includes(p) ?? false, o.midi)
    .filter((p) => !q || p.text.toLowerCase().includes(q))
    .map((p): ProblemRow => ({ kind: 'problem', problem: p, text: p.text }));
  out.push({
    key: 'problems',
    title: 'PROBLEMS',
    depth: 0,
    rows: problems,
    count: problems.filter((p) => !p.problem.info).length,
  });
  // a section with nothing to list is not shown (no problems is one line the list adds itself)
  return out.filter((x) => x.rows.length > 0);
}
