import { FACTORY, SPECS } from '@sreda/core';
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

test('Pulse sounds at 44.1 kHz too', () => {
  const { l } = renderDoc(FACTORY.find((e) => e.name === 'pulse')!.build(SPECS), SPECS, 2, 44_100);
  expect(l.reduce((a, x) => Math.max(a, Math.abs(x)), 0)).toBeGreaterThan(0.05);
});
