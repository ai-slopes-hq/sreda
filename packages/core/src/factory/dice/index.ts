// DICE (spec §6, revision 36): a random, playable patch in one of the styles, built from the library of parts and kept
// inside safe ranges so every throw sounds and none clips hard. The same seed gives the same patch.
import type { Doc } from '../../doc';
import { mulberry32 } from '../../generators';
import type { Specs } from '../../spec';
import { buildWith } from '../build';
import { assemble } from './assemble';
import { PARTS } from './parts';
import { chance, intIn, pick, weighted } from './random';
import { STYLE_IDS, STYLES } from './styles';
import type { DiceCtx, DiceStyleId, DiceVoice, PartId, Style, TwistId } from './types';

export { STYLE_IDS, STYLES } from './styles';
export type { DiceStyleId, PartId, TwistId } from './types';

/** vertical room a part takes on the canvas (STACK packing sets the real layout) */
const ROOM = 900;

export function dicePatch(
  specs: Specs,
  seed: number,
): { doc: Doc; style: DiceStyleId; label: string; parts: PartId[]; twists: TwistId[] } {
  const R = mulberry32(seed >>> 0 || 1);
  const style = STYLES[pick(R, STYLE_IDS)]!;
  const bpm = Math.round(style.bpm[0] + (style.bpm[1] - style.bpm[0]) * R());
  const scale = pick(R, style.scales);
  const root = Math.floor(R() * 12);
  const twists: TwistId[] = [];
  const { doc, value: voices } = buildWith(specs, (S) => {
    const c: DiceCtx = { S, R, scale, root, bpm, x: 0, y: 0 };
    const voices: DiceVoice[] = [];
    const play = (r: Style['roles'][number]) => {
      const n = r.count ? intIn(R, r.count[0], r.count[1]) : 1;
      for (let k = 0; k < n; k++) {
        voices.push(PARTS[weighted(R, r.parts)]!({ ...c, y: voices.length * ROOM }));
      }
    };
    for (const r of style.roles) if (chance(R, r.p)) play(r);
    // never silent: with no role chosen, the first role plays
    if (voices.length === 0) play(style.roles[0]!);
    assemble(c, style, voices, []);
    return voices;
  });
  return { doc, style: style.id, label: style.label, parts: voices.map((v) => v.part), twists };
}
