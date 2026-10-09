import { addModule, emptyDoc, frameSelection, SPECS } from '@sreda/core';
import { expect, test } from 'vitest';
import { focusSetOf, wholeNormal } from './focus';

test('a clock normal is drawn whole when WIRES is open, or either frame is hovered or selected (or holds the focus)', () => {
  const a = addModule(emptyDoc, SPECS, 'osc', 0, 0);
  const inner = frameSelection(a.doc, SPECS, [a.id]);
  const outer = frameSelection(inner.doc, SPECS, [inner.id]);
  const none = focusSetOf(outer.doc, null, []);
  expect(wholeNormal(false, none, outer.id, inner.id)).toBe(false);
  expect(wholeNormal(true, none, outer.id, inner.id)).toBe(true);
  expect(wholeNormal(false, focusSetOf(outer.doc, inner.id, []), outer.id, inner.id)).toBe(true);
  expect(wholeNormal(false, focusSetOf(outer.doc, null, [outer.id]), outer.id, inner.id)).toBe(true);
  // a selected module is inside both frames, but not itself one of them: the frames are not in its focus
  expect(wholeNormal(false, focusSetOf(outer.doc, null, [a.id]), outer.id, inner.id)).toBe(false);
});
