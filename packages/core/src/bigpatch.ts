// The 200-module patch the first build is sized for (spec §8): the benchmark and the smoothness check.
import type { Doc } from './doc';
import { build } from './factory/build';
import { mulberry32 } from './generators';
import { randomise } from './ops';
import type { Specs } from './spec';

/**
 * 20 frames of 10 modules, each with its own clock: META-SEQ (where RHYTHM and STAGES stood) → QUANT → COMPLEX → FOLD →
 * FILTER → LPG → MIX, an LFO (OSC) on the fold, a cycling SLOPE on the cutoff, a SCOPE on the voice; the MIXes chained
 * into the first frame's OUT, which takes the place of that frame's LFO. Knobs randomised with mulberry32(1).
 */
export function bigPatch(specs: Specs, frames = 20): Doc {
  const doc = build(specs, (S) => {
    let prevMix: string | null = null;
    for (let f = 0; f < frames; f++) {
      const [x, y] = [(f % 5) * 1500, Math.floor(f / 5) * 900];
      const sq = S.add('metaseq', x, y);
      const qu = S.add('quant', x + 600, y);
      const cx = S.add('complex', x, y + 400, { freq: 55 * (1 + (f % 4)) });
      const fo = S.add('fold', x + 400, y + 400);
      const fl = S.add('filter', x + 650, y + 400);
      const lp = S.add('lpg', x + 900, y + 400);
      const mx = S.add('mix', x + 1150, y + 400);
      const sl = S.add('slope', x, y + 600, { cycle: 1 });
      const sc = S.add('scope', x + 400, y + 600);
      const tenth = f === 0 ? S.add('out', x + 800, y + 600) : S.add('osc', x + 800, y + 600, { freq: 0.3 });
      const g = S.frame([sq, qu, cx, fo, fl, lp, mx, sl, sc, tenth], `VOICE ${f + 1}`, { bpm: 90 + f * 3 });
      S.wire(g, 'clkOut', sq, 'clk');
      S.wire(sq, 'gate', lp, 'ping');
      S.wire(sq, 'cv', qu, 'in');
      S.wire(qu, 'out', cx, 'pitch');
      S.wire(cx, 'out', fo, 'in');
      S.wire(fo, 'out', fl, 'in');
      S.wire(fl, 'lp', lp, 'in');
      S.wire(lp, 'out', mx, 'a');
      S.wire(lp, 'out', sc, 'a');
      S.wire(sl, 'out', fl, '@cutoff');
      if (f > 0) S.wire(tenth, 'out', fo, '@fold');
      if (prevMix) S.wire(mx, 'out', prevMix, 'b');
      if (f === 0) S.wire(mx, 'out', tenth, 'l');
      prevMix = mx;
    }
  });
  const rng = mulberry32(1);
  return doc.modules.reduce((d, m) => randomise(d, specs, m.id, rng), doc);
}
