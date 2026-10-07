// Pure helpers for the patching gestures: what the picker lists, and where a module lands when added wired.
import { inputPorts, layoutPanel, type Port, type Role, type Specs } from '@sreda/core';

/** The end a cable is being dragged from. */
export interface End {
  dir: 'in' | 'out';
  role: Role;
}
export interface PickerItem {
  type: string;
  label: string;
  desc: string;
}

/** Ports a cable from `from` can end on. */
function targets(specs: Specs, type: string, from: End): Port[] {
  const spec = specs[type]!;
  return from.dir === 'out' ? inputPorts(spec) : spec.outputs;
}

/** Modules matching the query; from a jack, only those with a port of the other direction, the same role first. */
export function pickerItems(specs: Specs, query: string, from: End | null): PickerItem[] {
  const q = query.trim().toLowerCase();
  const items = Object.values(specs)
    .filter(
      (s) =>
        !q || s.label.toLowerCase().includes(q) || s.type.includes(q) || s.desc.toLowerCase().includes(q),
    )
    .filter((s) => !from || targets(specs, s.type, from).length > 0)
    .map((s) => ({ type: s.type, label: s.label, desc: s.desc }));
  const sameRole = (t: string) => (from && targets(specs, t, from).some((p) => p.role === from.role) ? 0 : 1);
  const starts = (i: PickerItem) => (q && i.label.toLowerCase().startsWith(q) ? 0 : 1);
  return items.sort(
    (a, b) => sameRole(a.type) - sameRole(b.type) || starts(a) - starts(b) || a.label.localeCompare(b.label),
  );
}

/** Where a new module goes so the port it will be wired by sits at the drop point (the top-left when unwired). */
export function placeFor(
  specs: Specs,
  type: string,
  from: End | null,
  drop: { x: number; y: number },
): { x: number; y: number; port: string | null } {
  if (!from) return { ...drop, port: null };
  const ports = targets(specs, type, from);
  const port = ports.find((p) => p.role === from.role) ?? ports[0];
  if (!port) return { ...drop, port: null };
  const j = layoutPanel(specs[type]!).jacks[port.id]!;
  return { x: drop.x - j.x, y: drop.y - j.y, port: port.id };
}
