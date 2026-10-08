// WIRES (spec §5a): how wires and ports are named. (Sections, port lists and problems arrive with the sidebar.)
import type { Doc } from './doc';
import { nameOf } from './names';
import { inputPorts, type Specs } from './spec';

/** `SLOPE 2 › EOC`; a frame's jacks are `GROUP 1 › CLK` and `GROUP 1 › CLK IN`. */
export function portLabel(doc: Doc, specs: Specs, id: string, port: string): string {
  const g = doc.groups.find((x) => x.id === id);
  if (g) return `${g.name} › ${port === 'clkIn' ? 'CLK IN' : 'CLK'}`;
  const m = doc.modules.find((x) => x.id === id);
  const spec = m && specs[m.type];
  const label = spec ? [...spec.outputs, ...inputPorts(spec)].find((p) => p.id === port)?.label : undefined;
  return `${nameOf(doc, specs, id)} › ${label ?? port.toUpperCase()}`;
}
