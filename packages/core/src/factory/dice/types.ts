// The DICE framework's types (spec §6, revision 36): a style picks roles, each role a part from the library; the
// assembler wires the voices into a mix, an effect chain and an OUT under one frame with its own clock.
import type { Builder } from '../build';
import type { Voice } from '../voices';

export type Rand = () => number;
export type Role = 'drums' | 'bass' | 'line' | 'texture';
export type DiceStyleId =
  | 'techno'
  | 'acid'
  | 'dub'
  | 'electro'
  | 'idm'
  | 'polymeter'
  | 'berlin'
  | 'westcoast'
  | 'industrial'
  | 'drone'
  | 'bells';
export type PartId = string; // registry keys, listed in Tasks 2–3
export type TwistId = 'fm' | 'snh' | 'switch' | 'feedback' | 'grains' | 'polymeter' | 'shaper' | 'chance';

export interface DiceCtx {
  S: Builder;
  R: Rand;
  scale: number;
  root: number;
  bpm: number;
  x: number;
  y: number;
}

export interface DiceVoice extends Voice {
  name: string;
  role: Role;
  part: PartId;
  /** the parts a kit is made of (a kit is one voice) */
  members?: PartId[];
  /** its MIX level 0…1 */
  level: number;
  /** its META-SEQ (polymeter, chance twists) */
  seq?: string;
  /** the gate that plays it (switch, chance, snh twists) */
  gate?: [string, string];
  /** an oscillator's pitch input (snh twist) */
  pitch?: [string, string];
  /** an audio-rate oscillator output (fm twist) */
  osc?: [string, string];
  /** an oscillator's FM input (fm twist) */
  fm?: [string, string];
  /** a filter id and '@cutoff' (snh twist) */
  cutoff?: [string, string];
}

export type Part = (c: DiceCtx) => DiceVoice;

export type FxChain = (
  c: DiceCtx,
  input: [string, string],
) => { ids: string[]; l: [string, string]; r?: [string, string]; clocks: [string, string, number][] };

export type Twist = (
  c: DiceCtx,
  voices: DiceVoice[],
) => { ids: string[]; clocks: [string, string, number][]; extraVoice?: DiceVoice } | null; // null: not applicable

export interface Style {
  id: DiceStyleId;
  label: string;
  bpm: [number, number];
  scales: number[];
  roles: { role: Role; p: number; parts: [PartId, number][]; count?: [number, number] }[];
  fx: [FxChain, number][];
  twists: [TwistId, number][];
  twistCount: [number, number];
}
