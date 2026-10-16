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
import type { DiceCtx, DiceStyleId, DiceVoice, Part, PartId, Rand, Style, TwistId } from './types';

export { DRUM_PARTS } from './parts/drums';
export { PARTS } from './parts';
export { STYLE_IDS, STYLES } from './styles';
export type { DiceCtx, DiceStyleId, DiceVoice, PartId, TwistId } from './types';

/** vertical room a part takes on the canvas (STACK packing sets the real layout) */
const ROOM = 900;

type Thrown = { doc: Doc; style: DiceStyleId; label: string; parts: PartId[]; twists: TwistId[] };

/** the role that plays when the dice leave none: the style's most likely one (the first of equals) */
function mainRole(style: Style): Style['roles'][number] {
  return style.roles.reduce((best, r) => (r.p > best.p ? r : best));
}

function throwStyle(specs: Specs, style: Style, R: Rand, parts: Record<PartId, Part>): Thrown {
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
        voices.push(parts[weighted(R, r.parts)]!({ ...c, y: voices.length * ROOM }));
      }
    };
    for (const r of style.roles) if (chance(R, r.p)) play(r);
    // never silent: with no role chosen, the style's most likely role plays
    if (voices.length === 0) play(mainRole(style));
    assemble(c, style, voices, []);
    return voices;
  });
  return {
    doc,
    style: style.id,
    label: style.label,
    parts: voices.flatMap((v) => [v.part, ...(v.members ?? [])]),
    twists,
  };
}

export function dicePatch(specs: Specs, seed: number): Thrown {
  const R = mulberry32(seed >>> 0 || 1);
  return throwStyle(specs, STYLES[pick(R, STYLE_IDS)]!, R, PARTS);
}

/** a throw in a given style from a given library (the framework's tests use stubs) */
export function dicePatchIn(
  specs: Specs,
  style: Style,
  seed: number,
  parts: Record<PartId, Part> = PARTS,
): Thrown {
  return throwStyle(specs, style, mulberry32(seed >>> 0 || 1), parts);
}
