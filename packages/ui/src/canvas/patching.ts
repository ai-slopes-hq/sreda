// Pure helpers for the patching gestures: what the picker lists, and where a module lands when added wired.
import { inputPorts, layoutPanel, type Port, type Role, type Specs } from '@sreda/core';

/** The end a cable is being dragged from. */
export interface End {
  dir: 'in' | 'out';
  role: Role;
}
export type PickerTab = 'ALL' | 'MODULES' | 'GROUPS' | 'PROJECTS' | 'SAMPLES';
export const TABS: PickerTab[] = ['ALL', 'MODULES', 'GROUPS', 'PROJECTS', 'SAMPLES'];
export type PickerItem =
  | { kind: 'module'; type: string; label: string; desc: string }
  | { kind: 'group' | 'project'; path: string; label: string; folder: string; factory: boolean }
  | { kind: 'sample'; path: string; label: string; folder: string };
/** a group or project the picker can offer: factory paths are 'FACTORY/<name>' */
export interface LibEntry {
  kind: 'group' | 'project';
  path: string;
  factory: boolean;
}
type ModuleItem = Extract<PickerItem, { kind: 'module' }>;

/** Ports a cable from `from` can end on. */
function targets(specs: Specs, type: string, from: End): Port[] {
  const spec = specs[type]!;
  return from.dir === 'out' ? inputPorts(spec) : spec.outputs;
}

/**
 * What the picker lists on a tab: modules matching the query (from a jack, only those with a port of the other
 * direction, the same role first), then groups, then projects (factory ones first, then by path; the query matches names and folders). From a
 * jack there are no projects; in REPLACE mode only modules.
 */
export function pickerItems(
  specs: Specs,
  query: string,
  from: End | null,
  o: { tab: PickerTab; replace: boolean; library: LibEntry[]; samples?: string[] },
): PickerItem[] {
  const q = query.trim().toLowerCase();
  const out: PickerItem[] = [];
  if (o.tab === 'ALL' || o.tab === 'MODULES') out.push(...moduleItems(specs, q, from));
  if (o.replace) return out;
  // samples only on their own tab, never from a jack (spec §7a)
  if (o.tab === 'SAMPLES') {
    if (from) return out;
    const split = (path: string) => {
      const i = path.lastIndexOf('/');
      return { label: path.slice(i + 1), folder: i > 0 ? path.slice(0, i) : '' };
    };
    return (o.samples ?? [])
      .filter((p) => !q || p.toLowerCase().includes(q))
      .map((path) => ({ kind: 'sample' as const, path, ...split(path) }))
      .sort((a, b) => a.folder.localeCompare(b.folder) || a.label.localeCompare(b.label));
  }
  for (const kind of ['group', 'project'] as const) {
    if (o.tab !== 'ALL' && o.tab !== (kind === 'group' ? 'GROUPS' : 'PROJECTS')) continue;
    if (kind === 'project' && from) continue;
    out.push(
      ...o.library
        .filter((e) => e.kind === kind && (!q || e.path.toLowerCase().includes(q)))
        // factory entries first, then the library's
        .sort((a, b) => Number(b.factory) - Number(a.factory) || a.path.localeCompare(b.path))
        .map((e) => {
          const i = e.path.lastIndexOf('/');
          return {
            kind,
            path: e.path,
            label: e.path.slice(i + 1),
            folder: i > 0 ? e.path.slice(0, i) : '',
            factory: e.factory,
          };
        }),
    );
  }
  return out;
}

function moduleItems(specs: Specs, q: string, from: End | null): ModuleItem[] {
  const items = Object.values(specs)
    .filter((s) => !s.internal)
    .filter(
      (s) =>
        !q || s.label.toLowerCase().includes(q) || s.type.includes(q) || s.desc.toLowerCase().includes(q),
    )
    .filter((s) => !from || targets(specs, s.type, from).length > 0)
    .map((s) => ({ kind: 'module' as const, type: s.type, label: s.label, desc: s.desc }));
  const sameRole = (t: string) => (from && targets(specs, t, from).some((p) => p.role === from.role) ? 0 : 1);
  const starts = (i: ModuleItem) => (q && i.label.toLowerCase().startsWith(q) ? 0 : 1);
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
