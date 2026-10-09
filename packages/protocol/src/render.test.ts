import { addModule, connect, FACTORY, SPECS, type Doc } from '@sreda/core';
import { expect, test } from 'vitest';
import { renderDoc } from './render';

const projects = FACTORY.filter((e) => e.kind === 'project');

test.each(projects.map((e) => [e.name, e] as const))(
  'the factory project %s sounds: finite, within 1, not silent',
  (_n, e) => {
    const { l, r } = renderDoc(e.build(SPECS), SPECS, 4);
    let peak = 0;
    let finite = true;
    for (const ch of [l, r])
      for (const x of ch) {
        finite &&= Number.isFinite(x);
        peak = Math.max(peak, Math.abs(x));
      }
    expect(finite).toBe(true);
    expect(peak).toBeGreaterThan(0.05);
    expect(peak).toBeLessThanOrEqual(1);
  },
);

// VCA-LPG processes its input: it has no source of its own
const groups = FACTORY.filter((e) => e.kind === 'group' && e.name !== 'vca-lpg');

/** a group with its main output wired into an OUT, far to the right */
function withOut(doc: Doc, out: [string, string]): Doc {
  const a = addModule(doc, SPECS, 'out', 6000, 0);
  return connect(a.doc, SPECS, out, [a.id, 'l']);
}

test.each(groups.map((e) => [e.name, e] as const))(
  'the factory group %s sounds from its own clock: RMS within −40…−3 dBFS, peak within 1, finite',
  (_n, e) => {
    const { l } = renderDoc(withOut(e.build(SPECS), e.output!(SPECS)), SPECS, 4);
    let peak = 0;
    let sum = 0;
    let finite = true;
    for (const x of l) {
      finite &&= Number.isFinite(x);
      peak = Math.max(peak, Math.abs(x));
      sum += x * x;
    }
    const db = 10 * Math.log10(sum / l.length + 1e-20);
    expect(finite).toBe(true);
    expect(db).toBeGreaterThan(-40);
    expect(db).toBeLessThan(-3);
    expect(peak).toBeLessThanOrEqual(1);
  },
  60_000,
);

test('Pulse sounds at 44.1 kHz too', () => {
  const { l } = renderDoc(FACTORY.find((e) => e.name === 'pulse')!.build(SPECS), SPECS, 2, 44_100);
  expect(l.reduce((a, x) => Math.max(a, Math.abs(x)), 0)).toBeGreaterThan(0.05);
});
