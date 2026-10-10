import { addModule, emptyDoc, laneSteps, SPECS } from '@sreda/core';
import { mulberry32 } from '@sreda/core';
import { expect, test } from 'vitest';
import { diceChanges, diceModule } from './dice';

test('DICE on RHYTHM writes ties only after a note, accents only on hits, and switches to GRID', () => {
  for (let seed = 1; seed < 40; seed++) {
    const { doc, id } = addModule(emptyDoc, SPECS, 'rhythm', 0, 0);
    const m = diceModule(doc, SPECS, id, mulberry32(seed)).modules[0]!;
    expect(m.params['mode']).toBe(1);
    for (let k = 1; k <= 16; k++) {
      if (m.params['g' + k] === 2)
        expect(k > 1 && m.params['g' + (k - 1)]! > 0, `seed ${seed} step ${k}`).toBe(true);
      if (m.params['a' + k] === 1) expect(m.params['g' + k]).toBe(1);
    }
  }
});

test('DICE on STAGES writes 16 notes in its scale as volts (s − 12) / 12, pulses on', () => {
  const { doc, id } = addModule(emptyDoc, SPECS, 'stages', 0, 0);
  const m = diceModule(doc, SPECS, id, mulberry32(4)).modules[0]!;
  const minorFromC = [0, 2, 3, 5, 7, 8, 10];
  const notes = new Set<number>();
  for (let k = 1; k <= 16; k++) notes.add(Math.round((m.params['v' + k]! * 2 - 1) * 12 + 12));
  expect(notes.size, 'a line, not one note').toBeGreaterThan(2);
  for (let k = 1; k <= 16; k++) {
    const v = m.params['v' + k]! * 2 - 1; // the hidden knob −1…1 is stored as a position
    const s = Math.round(v * 12 + 12);
    expect(Math.abs(v - (s - 12) / 12)).toBeLessThan(1e-9);
    expect(s >= 0 && s <= 24).toBe(true);
    expect(minorFromC.includes(s % 12), `stage ${k}: ${s}`).toBe(true);
    expect(m.params['p' + k]).toBe(0);
  }
});

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
