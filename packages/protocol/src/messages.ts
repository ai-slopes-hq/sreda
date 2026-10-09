// Messages from the UI to the engine in the worklet, and back.
import type { Plan } from '@sreda/core';

export type ToEngine =
  /** a plan as UTF-8 JSON, encoded on the main thread; its buffer is transferred */
  | { t: 'plan'; seq: number; bytes: Uint8Array }
  | { t: 'knob'; node: number; index: number; value: number }
  /** an option's index or a hidden knob in real units, at its index among the node's fixed values */
  | { t: 'fixed'; node: number; index: number; value: number }
  | { t: 'att'; node: number; input: number; value: number }
  | { t: 'ratio'; node: number; input: number; value: number }
  | { t: 'listen'; target: { node: number; port: number } | null }
  /** a frame (index in doc.groups) muted or unmuted: its gain glides over 50 ms */
  | { t: 'mute'; frame: number; on: boolean }
  /** the speakers fade in (a project just opened) */
  | { t: 'fade'; ms: number }
  /** the master fader, 0…1 (glides over 10 ms) */
  | { t: 'master'; value: number }
  /** a decoded sample at the engine's rate for the pool, under `id`; its buffers are transferred */
  | { t: 'sample'; id: number; channels: Float32Array[]; hits: Uint32Array; strengths: Float32Array }
  /** a sample no document names any more: its pool slot is freed */
  | { t: 'unsample'; id: number }
  /** play a sample from its start in place of the mix; null stops */
  | { t: 'audition'; id: number | null };

export type FromEngine = { t: 'applied'; seq: number; code: 0 | 1 | 2 };

/** A plan as the bytes the engine decodes (encoded here, on the main thread, never in the worklet). */
export function encodePlan(plan: Plan): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(plan));
}
