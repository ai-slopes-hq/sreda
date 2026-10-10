import { addModule, emptyDoc, laneSteps, SPECS } from '@sreda/core';
import { mulberry32 } from '@sreda/core';
import { expect, test } from 'vitest';
import { diceChanges } from './dice';

test('DICE on META-SEQ writes the edited pattern in its GEN, SCALE and ROOT; ⚄ one lane even locked', () => {
  const { doc, id } = addModule(emptyDoc, SPECS, 'metaseq', 0, 0);
  // edit D, GEN ARP, SCALE MAJ, ROOT D (2 of 0…11), D's GATE locked
  const params = { ...doc.modules[0]!.params, edit: 3, gen: 4, scale: 1, root: 2 / 11, dglock: 1 };
  const before = { ...doc, modules: [{ ...doc.modules[0]!, params }] };
  const changes = diceChanges(before, SPECS, id, mulberry32(5));
  const keys = Object.keys(changes);
  expect(keys.length).toBeGreaterThan(0);
  expect(
    keys.every((k) => k.startsWith('d') && !k.startsWith('dg')),
    keys.join(),
  ).toBe(true);
  const after = { ...params, ...changes };
  const majFromD = [2, 4, 6, 7, 9, 11, 1];
  for (const s of laneSteps(after, 3, 'n')) expect(majFromD.includes(s % 12), `${s}`).toBe(true);
  const lane = diceChanges(before, SPECS, id, mulberry32(5), 'g');
  expect(Object.keys(lane).length).toBeGreaterThan(0); // only the steps that changed
  expect(Object.keys(lane).every((k) => k.startsWith('dg'))).toBe(true);
});
