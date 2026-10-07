// Messages from the UI to the engine in the worklet, and back.
import type { Plan } from '@sreda/core';

export type ToEngine =
  | { t: 'plan'; plan: Plan }
  | { t: 'knob'; node: number; index: number; value: number }
  /** an option's index or a hidden knob in real units, at its index among the node's fixed values */
  | { t: 'fixed'; node: number; index: number; value: number }
  | { t: 'att'; node: number; input: number; value: number }
  | { t: 'ratio'; node: number; input: number; value: number }
  | { t: 'listen'; target: { node: number; port: number } | null };

export type FromEngine = { t: 'applied'; seq: number; code: 0 | 1 | 2 };
