// DICE: a module's sequence written by a generator (spec §7). The button is an undo step; a rise on the DICE input
// changes the patch without one.
import { euclid, fromKnob, type Doc, type KnobParam, type Specs } from '@sreda/core';

const knobValue = (specs: Specs, type: string, id: string, k: number): number =>
  fromKnob(specs[type]!.params.find((p) => p.id === id) as KnobParam, k);

/** RHYTHM: 303-style gates (DENS hits, euclid-spread, random rotation), long notes as ties, accents; MODE → GRID. */
export function diceModule(doc: Doc, specs: Specs, id: string, R: () => number): Doc {
  const m = doc.modules.find((x) => x.id === id);
  if (!m) return doc;
  const p = { ...m.params };
  if (m.type === 'rhythm') {
    const dens = Math.round(knobValue(specs, 'rhythm', 'dens', p['dens'] ?? 0));
    const act = euclid(16, dens, Math.floor(R() * 16));
    const idx = Math.max(0, Math.min(15, dens));
    const t1 = 5 + (idx / 15) * 45;
    const t2 = 10 + Math.pow(idx / 15, 1.2) * 30;
    for (let k = 1; k <= 16; k++) {
      p['g' + k] = act[k - 1] ? 1 : 0;
      p['a' + k] = act[k - 1] && R() < 0.3 ? 1 : 0;
    }
    // a long note (the old SREDA's "tie"): the note holds into the rest after it
    for (let k = 1; k < 16; k++)
      if (act[k - 1] && !act[k] && (R() * 100 < t1 ? 1 : 0) + (R() * 100 < t2 ? 1 : 0) === 2)
        p['g' + (k + 1)] = 2;
    p['mode'] = 1;
  } else return doc;
  return { ...doc, modules: doc.modules.map((x) => (x.id === id ? { ...x, params: p } : x)) };
}
