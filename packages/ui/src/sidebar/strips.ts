import { chainOf, effectiveMuted, nameOf, rectOf, sortReading, type Doc, type Specs } from '@sreda/core';

export interface Strip {
  id: string;
  name: string;
  /** inside a muted frame: silent whatever the strip says */
  muted: boolean;
  /** the module patched into the OUT's L (else its R): `from MIX 1` */
  source: string | null;
}

/**
 * MIX (spec §5a): a strip per OUT, in reading order (the canvas reading order: rows within half a 1U, then left to right). The name is the frame
 * holding only this OUT (the innermost one that has it), else the module's name (`OUT 2`).
 */
export function mixStrips(doc: Doc, specs: Specs): Strip[] {
  const outs = doc.modules.filter((m) => m.type === 'out');
  const chains = new Map(outs.map((m) => [m.id, chainOf(doc, m.id)]));
  const sorted = sortReading(outs.map((m) => ({ id: m.id, r: rectOf(doc, specs, m.id) })));
  return sorted.map(({ id }) => {
    const m = outs.find((o) => o.id === id)!;
    const chain = chains.get(m.id)!;
    const frame = chain[0] ? doc.groups.find((g) => g.id === chain[0]) : undefined;
    const alone = frame && outs.filter((o) => chains.get(o.id)!.includes(frame.id)).length === 1;
    const feed = (port: string) => doc.cables.find((c) => c.to[0] === m.id && c.to[1] === port);
    const src = feed('l') ?? feed('r');
    return {
      id: m.id,
      source: src ? nameOf(doc, specs, src.from[0]) : null,
      name: alone ? frame.name : nameOf(doc, specs, m.id),
      muted: chain.some((g) => effectiveMuted(doc, g)),
    };
  });
}
