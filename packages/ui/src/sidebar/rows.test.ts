import {
  addModule,
  connect,
  emptyDoc,
  frameSelection,
  setCollapsed,
  setParam,
  SPECS,
  type Doc,
} from '@sreda/core';
import { expect, test } from 'vitest';
import { wireSections } from './rows';

function patch(): { doc: Doc; ids: string[] } {
  let doc = emptyDoc;
  const ids: string[] = [];
  for (const [t, x] of [
    ['osc', 0],
    ['out', 400],
    ['slope', 0],
    ['metaseq', 1200],
  ] as const) {
    const a = addModule(doc, SPECS, t, x, t === 'slope' ? 300 : 0);
    doc = a.doc;
    ids.push(a.id);
  }
  doc = connect(doc, SPECS, [ids[0]!, 'out'], [ids[1]!, 'l']);
  doc = connect(doc, SPECS, [ids[2]!, 'out'], [ids[0]!, 'pitch']);
  doc = setParam(doc, SPECS, ids[2]!, 'cycle', 1); // SLOPE's TRIG ← EOC normal
  const g = frameSelection(doc, SPECS, [ids[0]!, ids[1]!]);
  return { doc: g.doc, ids: [...ids, g.id] };
}
const all = { q: '', selOnly: false, sel: [] as string[] };

test('sections: one per frame, BETWEEN GROUPS, NORMALS, PROBLEMS; rows name both ends; values for CV and triggers', () => {
  const { doc } = patch();
  const s = wireSections(doc, SPECS, all);
  // UNGROUPED holds no wire here, so it is not listed
  expect(s.map((x) => x.title)).toEqual(['GROUP 1', 'BETWEEN GROUPS', 'NORMALS', 'PROBLEMS']);
  const g = s[0]!;
  expect(g.rows.map((r) => r.text)).toEqual(['OSC › OUT  →  OUT › L']);
  expect(g.count).toBe(1);
  const between = s[1]!.rows[0]!;
  expect(between.text).toBe('SLOPE › OUT  →  OSC › PTCH');
  expect(between.kind === 'wire' && between.value).toEqual({ kind: 'att', v: 1, def: 1 });
  expect(g.rows[0]!.kind === 'wire' && g.rows[0]!.value).toBeNull(); // audio: no value
});

test('NORMALS is a section of its own: each normal is two lines, the normal and what it does', () => {
  const { doc } = patch();
  const normals = wireSections(doc, SPECS, all).find((x) => x.key === 'normals')!;
  expect(normals.count).toBe(normals.rows.length);
  const rows = normals.rows.flatMap((r) => (r.kind === 'normal' ? [[r.text, r.note]] : []));
  expect(rows).toContainEqual(['OUT › R ← L', 'until something is patched into R']);
  expect(rows).toContainEqual(['SLOPE › TRIG ← EOC', 'until something is patched into TRIG']);
});

test('an empty section is not listed; a patch with no problems has no PROBLEMS section', () => {
  let doc = addModule(emptyDoc, SPECS, 'osc', 0, 0).doc;
  doc = addModule(doc, SPECS, 'out', 400, 0).doc;
  doc = connect(doc, SPECS, ['m1', 'out'], ['m2', 'l']);
  const keys = wireSections(doc, SPECS, all).map((x) => x.key);
  expect(keys).toEqual(['ungrouped', 'normals']);
  expect(wireSections(doc, SPECS, { ...all, q: 'zzz' })).toEqual([]);
});

test('a cable into a held input has no ratio value', () => {
  const specs = {
    ...SPECS,
    osc: {
      ...SPECS['osc']!,
      inputs: SPECS['osc']!.inputs.map((p) => (p.id === 'sync' ? { ...p, held: true } : p)),
    },
  };
  let doc = addModule(emptyDoc, specs, 'osc', 0, 0).doc;
  doc = addModule(doc, specs, 'slope', 0, 300).doc;
  doc = connect(doc, specs, ['m2', 'out'], ['m1', 'sync']);
  const row = wireSections(doc, specs, all).flatMap((x) => x.rows)[0]!;
  expect(row.kind === 'wire' && row.value).toBeNull();
  const plain = wireSections(doc, SPECS, all).flatMap((x) => x.rows)[0]!;
  expect(plain.kind === 'wire' && plain.value).toEqual({ kind: 'ratio', v: 1, def: 1 });
});

test('the filter matches module and port names; SELECTION keeps the wires touching the selection', () => {
  const { doc, ids } = patch();
  const filtered = wireSections(doc, SPECS, { ...all, q: 'ptch' });
  expect(filtered.flatMap((x) => x.rows.filter((r) => r.kind === 'wire').map((r) => r.text))).toEqual([
    'SLOPE › OUT  →  OSC › PTCH',
  ]);
  const sel = wireSections(doc, SPECS, { q: '', selOnly: true, sel: [ids[1]!] });
  expect(sel.flatMap((x) => x.rows.filter((r) => r.kind === 'wire').map((r) => r.text))).toEqual([
    'OSC › OUT  →  OUT › L',
  ]);
});

test('a wire hidden inside a collapsed frame is listed dimmed, marked (collapsed), and names the frame to expand', () => {
  const { doc, ids } = patch();
  const g = ids[4]!;
  const open = wireSections(doc, SPECS, all);
  expect(open[0]!.rows.every((r) => r.kind !== 'wire' || r.collapsed === null)).toBe(true);
  const shut = wireSections(setCollapsed(doc, [g], true), SPECS, all);
  const row = shut[0]!.rows.find((r) => r.kind === 'wire')!;
  expect(row.kind === 'wire' && row.collapsed).toBe(g);
  expect(row.text).toBe('OSC › OUT  →  OUT › L  (collapsed)');
  // a wire that leaves the frame is not hidden
  expect(shut.flatMap((x) => x.rows).filter((r) => r.kind === 'wire' && r.collapsed === null)).toHaveLength(
    1,
  );
});
