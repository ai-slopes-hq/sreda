import { withDescendants, type Doc } from '@sreda/core';

/** The modules and frames whose cables are drawn whole: the hovered and the selected, with what is inside frames. */
export function focusSetOf(doc: Doc, hover: string | null, sel: readonly string[]): Set<string> {
  return new Set(withDescendants(doc, [...(hover ? [hover] : []), ...sel]));
}

/** Is a frame's clock normal (parent frame, then this one) drawn whole: WIRES open, or either frame in the focus. */
export const wholeNormal = (sidebarOpen: boolean, focus: ReadonlySet<string>, parent: string, id: string): boolean =>
  sidebarOpen || focus.has(parent) || focus.has(id);
