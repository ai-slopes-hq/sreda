// The library of parts, by id.
import { drumKit, DRUM_PARTS } from './drums';
import { BASS_PARTS } from './bass';
import { drumKitLegacy } from './legacy';
import { LINE_PARTS } from './lines';
import { TEXTURE_PARTS } from './textures';
import type { Part, PartId } from '../types';

export const PARTS: Record<PartId, Part> = {
  ...DRUM_PARTS,
  ...BASS_PARTS,
  ...LINE_PARTS,
  ...TEXTURE_PARTS,
  // techno's kit
  drums: drumKit(
    [
      ['kick-sine', 1],
      ['hats-noise', 1],
      ['snare', 1],
      ['clap', 1],
    ],
    [2, 4],
  ),
  'drum-kit-legacy': drumKitLegacy,
};
