import { compile, emptyDoc, addModule, SPECS } from '@sreda/core';
import { expect, test } from 'vitest';
import { readoutIndex } from './readouts';

test('readout indices follow the plan layout', () => {
  let doc = addModule(emptyDoc, SPECS, 'osc', 0, 0).doc;
  doc = addModule(doc, SPECS, 'out', 400, 0).doc;
  const { layout } = compile(doc, SPECS, 1);
  expect(readoutIndex.seq).toBe(0);
  expect(readoutIndex.knob(layout, 0, 2)).toBe(layout.nodes[0]!.knobs + 2);
  expect(readoutIndex.trig(layout, 0, 0)).toBe(layout.nodes[0]!.trigs);
  expect(readoutIndex.out(layout, 1, 0)).toBe(layout.nodes[1]!.outs);
});
