import { addModule, emptyDoc, SPECS } from '@sreda/core';
import { mulberry32 } from '@sreda/core';
import { expect, test } from 'vitest';
import { diceModule } from './dice';

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
