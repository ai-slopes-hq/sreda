// The library of parts, by id.
import { bassLegacy, bellsLegacy, drumKitLegacy, droneLegacy, leadLegacy } from './legacy';
import type { Part, PartId } from '../types';

export const PARTS: Record<PartId, Part> = {
  'drum-kit-legacy': drumKitLegacy,
  'bass-legacy': bassLegacy,
  'lead-legacy': leadLegacy,
  'drone-legacy': droneLegacy,
  'bells-legacy': bellsLegacy,
};
