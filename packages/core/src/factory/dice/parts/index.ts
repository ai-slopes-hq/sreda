// The library of parts, by id.
import { drumKit, DRUM_PARTS } from './drums';
import { BASS_PARTS } from './bass';
import { LINE_PARTS } from './lines';
import { TEXTURE_PARTS } from './textures';
import { VARIANT_PARTS } from './variants';
import type { Part, PartId } from '../types';

export const PARTS: Record<PartId, Part> = {
  ...DRUM_PARTS,
  ...BASS_PARTS,
  ...LINE_PARTS,
  ...TEXTURE_PARTS,
  ...VARIANT_PARTS,
  // the styles' kits
  'drums-techno': drumKit(
    [
      ['kick-sine', 3],
      ['kick-fm', 1],
      ['kick-noise', 1],
      ['hats-noise', 2],
      ['hats-metal', 1],
      ['hats-comb', 1],
      ['clap', 2],
      ['snare', 1],
    ],
    [3, 4],
    'drums-techno',
  ),
  'drums-acid': drumKit(
    [
      ['kick-sine', 3],
      ['hats-noise', 2],
      ['clap', 1],
    ],
    [1, 2],
    'drums-acid',
  ),
  'drums-dub': drumKit(
    [
      ['kick-sine', 3],
      ['snare', 2],
      ['perc-ping', 1],
    ],
    [1, 2],
    'drums-dub',
  ),
  'drums-industrial': drumKit(
    [
      ['kick-noise', 2],
      ['kick-fm', 1],
      ['hats-metal', 2],
      ['hats-comb', 2],
      ['perc-tom', 1],
      ['clap', 1],
    ],
    [3, 4],
    'drums-industrial',
  ),
};
