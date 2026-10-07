// Where things live in the readout buffer the engine fills once per block (see ReadoutLayout).
import type { ReadoutLayout } from '@sreda/core';

export const readoutIndex = {
  /** the seq of the plan the engine is playing */
  seq: 0,
  /** the peak of the last block at the speakers (after the master stage) */
  master: 1,
  /** a visible knob's position after modulation, 0…1 */
  knob: (l: ReadoutLayout, node: number, i: number): number => l.nodes[node]!.knobs + i,
  /** how many events a trigger input has seen (wraps at 2^24) */
  trig: (l: ReadoutLayout, node: number, i: number): number => l.nodes[node]!.trigs + i,
  /** an output's peak over the last block */
  out: (l: ReadoutLayout, node: number, i: number): number => l.nodes[node]!.outs + i,
};
