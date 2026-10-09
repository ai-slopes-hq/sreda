import { chainOf, effectiveMuted, nameOf, type Doc, type Specs } from '@sreda/core';

export interface Strip {
  id: string;
  name: string;
  /** inside a muted frame: silent whatever the strip says */
  muted: boolean;
}

/**
 * MIX (spec §5a): a strip per OUT, in reading order (rows top to bottom, then left to right). The name is the frame
 * holding only this OUT (the innermost one that has it), else the module's name (`OUT 2`).
 */
export function mixStrips(doc: Doc, specs: Specs): Strip[] {
  const outs = doc.modules.filter((m) => m.type === 'out');
  const chains = new Map(outs.map((m) => [m.id, chainOf(doc, m.id)]));
  const sorted = [...outs].sort((a, b) => a.y - b.y || a.x - b.x);
  return sorted.map((m) => {
    const chain = chains.get(m.id)!;
    const frame = chain[0] ? doc.groups.find((g) => g.id === chain[0]) : undefined;
    const alone = frame && outs.filter((o) => chains.get(o.id)!.includes(frame.id)).length === 1;
    return {
      id: m.id,
      name: alone ? frame.name : nameOf(doc, specs, m.id),
      muted: chain.some((g) => effectiveMuted(doc, g)),
    };
  });
}
