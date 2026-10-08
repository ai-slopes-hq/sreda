import { expect, test } from 'vitest';
import { starterDoc } from './doc';
import { frameSelection } from './frames';
import { SPECS } from './spec';
import { portLabel } from './wires';

test('a port is named by its module (numbered when there are several) and its label; a frame by its name', () => {
  const doc = starterDoc(SPECS);
  expect(portLabel(doc, SPECS, 'm1', 'out')).toBe('OSC › OUT');
  expect(portLabel(doc, SPECS, 'm2', 'l')).toBe('OUT › L');
  expect(portLabel(doc, SPECS, 'm1', '@freq')).toBe('OSC › FREQ');
  const g = frameSelection(doc, SPECS, ['m1']);
  expect(portLabel(g.doc, SPECS, g.id, 'clkOut')).toBe('GROUP 1 › CLK');
  expect(portLabel(g.doc, SPECS, g.id, 'clkIn')).toBe('GROUP 1 › CLK IN');
});
