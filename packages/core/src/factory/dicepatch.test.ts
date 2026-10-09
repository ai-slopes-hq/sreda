import { expect, test } from 'vitest';
import { compile } from '../compile';
import { validateDoc } from '../doc';
import { SPECS } from '../spec';
import { wireProblems } from '../wires';
import { dicePatch } from './dicepatch';

test('every throw is a valid document with sound reaching OUT and no empty inputs; both kinds come up', () => {
  const kinds = new Set<string>();
  for (let seed = 1; seed <= 200; seed++) {
    const { doc, kind } = dicePatch(SPECS, seed);
    kinds.add(kind);
    expect(validateDoc(JSON.parse(JSON.stringify(doc)), SPECS), `seed ${seed}`).not.toBeNull();
    const problems = wireProblems(doc, SPECS).filter((p) => !p.info);
    expect(
      problems.map((p) => p.text),
      `seed ${seed} (${kind})`,
    ).toEqual([]);
    expect(doc.modules.filter((m) => m.type === 'out')).toHaveLength(1);
    expect(
      doc.groups.some((g) => g.clock.on),
      `seed ${seed}: a frame with its own clock`,
    ).toBe(true);
    expect(() => compile(doc, SPECS, 1)).not.toThrow();
  }
  expect([...kinds].sort()).toEqual(['ambient', 'rhythmic']);
});

test('the same seed gives the same patch; another seed another', () => {
  expect(dicePatch(SPECS, 7).doc).toEqual(dicePatch(SPECS, 7).doc);
  expect(dicePatch(SPECS, 7).doc).not.toEqual(dicePatch(SPECS, 8).doc);
});
