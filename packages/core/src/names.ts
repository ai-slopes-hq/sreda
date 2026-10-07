import type { Doc } from './doc';
import type { Specs } from './spec';

/** The module's label, numbered in document order when there are several of its type (`OSC 2`). */
export function nameOf(doc: Doc, specs: Specs, id: string): string {
  const m = doc.modules.find((x) => x.id === id);
  if (!m) return id;
  const label = specs[m.type]?.label ?? m.type.toUpperCase();
  const same = doc.modules.filter((x) => x.type === m.type);
  return same.length > 1 ? `${label} ${same.indexOf(m) + 1}` : label;
}
