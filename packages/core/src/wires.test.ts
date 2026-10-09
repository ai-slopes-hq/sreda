import { expect, test } from 'vitest';
import { emptyDoc, starterDoc } from './doc';
import { addModule, connect } from './ops';
import { frameSelection } from './frames';
import { SPECS } from './spec';
import { portLabel } from './names';
import { allPorts, wireProblems, wireSection } from './wires';

test('a port is named by its module (numbered when there are several) and its label; a frame by its name', () => {
  const doc = starterDoc(SPECS);
  expect(portLabel(doc, SPECS, 'm1', 'out')).toBe('OSC › OUT');
  expect(portLabel(doc, SPECS, 'm2', 'l')).toBe('OUT › L');
  expect(portLabel(doc, SPECS, 'm1', '@freq')).toBe('OSC › FREQ');
  const g = frameSelection(doc, SPECS, ['m1']);
  expect(portLabel(g.doc, SPECS, g.id, 'clkOut')).toBe('GROUP 1 › CLK');
  expect(portLabel(g.doc, SPECS, g.id, 'clkIn')).toBe('GROUP 1 › CLK IN');
});

function patch(...types: string[]) {
  let doc = emptyDoc;
  const ids: string[] = [];
  types.forEach((t, i) => {
    const a = addModule(doc, SPECS, t, i * 400, 0);
    doc = a.doc;
    ids.push(a.id);
  });
  return { doc, ids };
}

test('a wire belongs to the innermost frame holding both ends; else it runs between groups, or among loose modules', () => {
  const { doc: d0, ids } = patch('osc', 'filter', 'out', 'noise');
  let doc = connect(d0, SPECS, [ids[0]!, 'out'], [ids[1]!, 'in']);
  doc = connect(doc, SPECS, [ids[1]!, 'lp'], [ids[2]!, 'l']);
  doc = connect(doc, SPECS, [ids[3]!, 'white'], [ids[2]!, 'r']);
  const g1 = frameSelection(doc, SPECS, [ids[0]!, ids[1]!]);
  const g2 = frameSelection(g1.doc, SPECS, [ids[0]!, ids[1]!]);
  const d = g2.doc;
  expect(wireSection(d, d.cables[0]!)).toBe(g2.id);
  expect(wireSection(d, d.cables[1]!)).toBe('between');
  expect(wireSection(d, d.cables[2]!)).toBe('ungrouped');
  expect(allPorts(d, SPECS, 'out').map((p) => p.label)).toContain('GROUP 1 › CLK');
  expect(allPorts(d, SPECS, 'in')).toContainEqual({
    id: ids[1],
    port: 'in',
    role: 'audio',
    label: 'FILTER › IN',
  });
});

test('problems: an empty processor input, a RHYTHM without a clock, sound that reaches no OUT; loops and mutes as info', () => {
  const { doc: d0, ids } = patch('osc', 'filter', 'rhythm', 'slope', 'mix', 'filter');
  let doc = connect(d0, SPECS, [ids[0]!, 'out'], [ids[1]!, 'in']);
  doc = connect(doc, SPECS, [ids[4]!, 'out'], [ids[4]!, 'a']); // MIX into itself
  const framed = frameSelection(doc, SPECS, [ids[3]!]);
  doc = { ...framed.doc, groups: framed.doc.groups.map((g) => ({ ...g, muted: true })) };
  const p = wireProblems(doc, SPECS);
  expect(p.filter((x) => !x.info).map((x) => x.text)).toEqual([
    'OSC — sound does not reach any OUT',
    'FILTER 1 — sound does not reach any OUT',
    'MIX — sound does not reach any OUT',
    'RHYTHM › CLK — no clock',
    'FILTER 2 › IN — empty input',
  ]);
  expect(p.filter((x) => x.info).map((x) => x.text)).toEqual(['loop: MIX → MIX', 'muted: GROUP 1']);
  expect(p.find((x) => x.text.startsWith('RHYTHM'))!.id).toBe(ids[2]);
  // SLOPE's IN is optional: no problem
  expect(p.some((x) => x.text.startsWith('SLOPE'))).toBe(false);
});

test('a module whose sample is missing is a problem: MISSING and its name', () => {
  const doc = {
    ...emptyDoc,
    modules: [{ ...addModule(emptyDoc, SPECS, 'osc', 0, 0).doc.modules[0]!, sample: 'drums/kick.wav' }],
  };
  const texts = wireProblems(doc, SPECS, (p) => p === 'drums/kick.wav').map((p) => p.text);
  expect(texts).toContain('OSC — MISSING · kick.wav');
  expect(wireProblems(doc, SPECS, () => false).map((p) => p.text)).not.toContain('OSC — MISSING · kick.wav');
});
