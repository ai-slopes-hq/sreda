import { addModule, connect, emptyDoc, frameSelection, setParam, SPECS, type Doc } from '@sreda/core';
import { expect, test } from 'vitest';
import { wireSections } from './rows';

function patch(): { doc: Doc; ids: string[] } {
  let doc = emptyDoc;
  const ids: string[] = [];
  for (const [t, x] of [
    ['osc', 0],
    ['out', 400],
    ['slope', 0],
    ['stages', 1200],
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

test('sections: one per frame, UNGROUPED, BETWEEN GROUPS, PROBLEMS; rows name both ends; values for CV and triggers', () => {
  const { doc } = patch();
  const s = wireSections(doc, SPECS, all);
  expect(s.map((x) => x.title)).toEqual(['GROUP 1', 'UNGROUPED', 'BETWEEN GROUPS', 'PROBLEMS']);
  const g = s[0]!;
  expect(g.rows.map((r) => r.text)).toEqual(['OSC › OUT  →  OUT › L', 'OUT › R  ← L (normal)']);
  expect(g.count).toBe(1);
  const between = s[2]!.rows[0]!;
  expect(between.text).toBe('SLOPE › OUT  →  OSC › PTCH');
  expect(between.kind === 'wire' && between.value).toEqual({ kind: 'att', v: 1, def: 1 });
  expect(g.rows[0]!.kind === 'wire' && g.rows[0]!.value).toBeNull(); // audio: no value
  // normals, dimmed, in their module's section
  expect(s[1]!.rows.map((r) => r.text)).toContain('SLOPE › TRIG  ← EOC (normal)');
  expect(s[1]!.rows.map((r) => r.text)).toContain('STAGES › ADV  ← STAGE TIMER (normal)');
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
