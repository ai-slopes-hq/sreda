// DICE: a module's sequence written by a generator (spec §7). The button is an undo step; a rise on the DICE input
// changes the patch without one.
import {
  diceLanes,
  fromKnob,
  type Algo,
  type Doc,
  type KnobParam,
  type Lane,
  type OptionParam,
  type Specs,
} from '@sreda/core';

const knobValue = (specs: Specs, type: string, id: string, k: number): number =>
  fromKnob(specs[type]!.params.find((p) => p.id === id) as KnobParam, k);

/** META-SEQ: the edited pattern's unlocked lanes (or `only`, ⚄) in its GEN, SCALE and ROOT (spec §7b), by `diceLanes`. */
export function diceModule(doc: Doc, specs: Specs, id: string, R: () => number, only?: Lane): Doc {
  const m = doc.modules.find((x) => x.id === id);
  if (!m) return doc;
  const p = { ...m.params };
  if (m.type === 'metaseq') {
    const gen = specs['metaseq']!.params.find((x) => x.id === 'gen') as OptionParam;
    const algo = gen.options[p['gen'] ?? gen.def] as Algo;
    const root = Math.round(knobValue(specs, 'metaseq', 'root', p['root'] ?? 0));
    Object.assign(p, diceLanes(p, p['edit'] ?? 0, algo, p['scale'] ?? 2, root, R, only));
  } else return doc;
  return { ...doc, modules: doc.modules.map((x) => (x.id === id ? { ...x, params: p } : x)) };
}

/** The params DICE writes into a module, as changes (sent as messages, not a plan). */
export function diceChanges(
  doc: Doc,
  specs: Specs,
  id: string,
  R: () => number,
  only?: Lane,
): Record<string, number> {
  const before = doc.modules.find((x) => x.id === id)?.params ?? {};
  const now = diceModule(doc, specs, id, R, only).modules.find((x) => x.id === id)?.params ?? {};
  return Object.fromEntries(Object.entries(now).filter(([k, v]) => before[k] !== v));
}
