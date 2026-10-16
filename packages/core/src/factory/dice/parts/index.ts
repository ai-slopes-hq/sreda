// The library of parts, by id.
import { drumKit, DRUM_PARTS } from './drums';
import { bassLegacy, bellsLegacy, drumKitLegacy, droneLegacy, leadLegacy } from './legacy';
import type { Part, PartId } from '../types';

export const PARTS: Record<PartId, Part> = {
  ...DRUM_PARTS,
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
  'bass-legacy': bassLegacy,
  'lead-legacy': leadLegacy,
  'drone-legacy': droneLegacy,
  'bells-legacy': bellsLegacy,
};
