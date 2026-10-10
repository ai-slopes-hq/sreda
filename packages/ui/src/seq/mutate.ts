// MUTATE's write-back (spec §7b): the engine mutates the playing pattern's live steps on its own; the readout brings
// them into the document once per GATE cycle, as one batch without an undo step (as from the DICE input).
import { laneLen, laneSteps, LANES, stepId } from '@sreda/core';

const NOTE_MAX = 24;
/** the trace's offsets: playing pattern, the GATE lane's cursor, the mutation generation, the live steps */
const TR_PATTERN = 0;
const TR_GATE_CURSOR = 2;
const TR_GEN = 7;
const TR_LIVE = 8;
/** a document change younger than this may not have reached the engine's trace yet: the write-back waits */
const SETTLE_MS = 150;
/** live VEL / CHNC come through the engine's f32: equal within this */
const EPS = 1e-6;

/** The document changes that bring pattern `pattern`'s steps to `live` (lane-major, param units as the trace reports
 * them): only the ids whose live value differs from the document. */
export function mutationChanges(
  params: Record<string, number>,
  pattern: number,
  live: number[][],
): Record<string, number> {
  const p = Math.max(0, Math.min(7, Math.round(pattern)));
  const out: Record<string, number> = {};
  LANES.forEach((l, li) => {
    const row = live[li];
    if (!row) return;
    const doc = laneSteps(params, p, l);
    for (let k = 0; k < 16; k++) {
      const raw = row[k];
      if (raw === undefined || !Number.isFinite(raw)) continue;
      const v =
        l === 'n' ? Math.round(raw) : l === 'g' || l === 't' || l === 'a' ? (raw >= 0.5 ? 1 : 0) : raw;
      if (Math.abs(v - doc[k]!) <= EPS) continue;
      out[stepId(p, l, k + 1)] = l === 'n' ? Math.min(1, Math.max(0, v / NOTE_MAX)) : v;
    }
  });
  return out;
}

/** One META-SEQ's write-back, fed every frame from the readout. It reads only three floats a frame; the steps are
 * decoded when the generation has moved and the GATE lane has wrapped since the last write. A step whose document
 * value changed less than SETTLE_MS ago is held back: the trace may predate that edit, which must win. A held-back step
 * keeps the write pending, so it goes once settled if the engine still differs. */
export class MutationWatch {
  private gen = 0;
  private cursor = -1;
  private wrapped = false;
  private seen: Record<string, number> | undefined = undefined;
  /** when each param last changed in the document (not by this watch) */
  private readonly changedAt = new Map<string, number>();

  constructor(
    private readonly params: () => Record<string, number> | undefined,
    private readonly write: (changes: Record<string, number>) => void,
  ) {}

  frame(buf: Float32Array, at: number, now: number): void {
    const params = this.params();
    if (!params) return;
    if (this.seen === undefined) this.seen = params;
    else if (params !== this.seen) {
      const was = this.seen;
      for (const k in params) if (params[k] !== was[k]) this.changedAt.set(k, now);
      for (const k in was) if (!(k in params)) this.changedAt.set(k, now);
      this.seen = params;
    }
    const pattern = buf[at + TR_PATTERN] ?? 0;
    const cursor = buf[at + TR_GATE_CURSOR] ?? -1;
    const gen = buf[at + TR_GEN] ?? 0;
    // a GATE lane of LEN 1 wraps on every step: its cursor never goes back
    if (cursor < this.cursor || (cursor === 0 && laneLen(params, Math.round(pattern), 'g') === 1))
      this.wrapped = true;
    this.cursor = cursor;
    if (gen === this.gen || !this.wrapped) return;
    const live: number[][] = [];
    for (let l = 0; l < LANES.length; l++)
      live.push(Array.from(buf.subarray(at + TR_LIVE + l * 16, at + TR_LIVE + (l + 1) * 16)));
    const changes = mutationChanges(params, pattern, live);
    let held = false;
    for (const k of Object.keys(changes))
      if (now - (this.changedAt.get(k) ?? -Infinity) < SETTLE_MS) {
        delete changes[k];
        held = true;
      }
    if (!held) {
      this.gen = gen;
      this.wrapped = false;
    }
    if (Object.keys(changes).length === 0) return;
    this.write(changes);
    // our own write is not an edit
    this.seen = this.params();
  }
}
