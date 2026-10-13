// Tracks which notes and clocks the pump has sent per node, so they can be switched off when a node leaves.
const STOP = 0xfc;
const START = 0xfa;

/** Remembers sounding notes per (node id, channel, note) and running clocks per node id. */
export class NoteLedger {
  private readonly notes = new Map<string, Set<number>>();
  private readonly clocks = new Set<string>();

  constructor(private readonly send: (bytes: number[]) => void) {}

  /** Records a message the pump sent for node `id`. */
  sent(id: string, bytes: number[]): void {
    const b0 = bytes[0] as number;
    if (b0 === START) this.clocks.add(id);
    else if (b0 === STOP) this.clocks.delete(id);
    else if (b0 >= 0x80 && b0 < 0xa0) {
      const key = ((b0 & 0x0f) << 8) | (bytes[1] as number);
      const on = b0 >= 0x90 && (bytes[2] as number) > 0;
      let set = this.notes.get(id);
      if (on) {
        if (!set) this.notes.set(id, (set = new Set()));
        set.add(key);
      } else if (set) {
        set.delete(key);
        if (set.size === 0) this.notes.delete(id);
      }
    }
  }

  /** Note-offs for the node's sounding notes, and Stop if its clock runs. */
  release(id: string): void {
    for (const key of this.notes.get(id) ?? []) this.send([0x80 | (key >> 8), key & 0xff, 0]);
    this.notes.delete(id);
    if (this.clocks.delete(id)) this.send([STOP]);
  }

  /** Releases every node not in `ids`. */
  keepOnly(ids: Set<string>): void {
    for (const id of new Set([...this.notes.keys(), ...this.clocks])) if (!ids.has(id)) this.release(id);
  }

  /** Releases everything; `panic` also sends All Notes Off (CC 123) on channels 1-4. */
  releaseAll(panic: boolean): void {
    for (const id of new Set([...this.notes.keys(), ...this.clocks])) this.release(id);
    if (panic) for (let ch = 0; ch < 4; ch++) this.send([0xb0 | ch, 123, 0]);
  }

  /** The port is gone: clear without sending. */
  forget(): void {
    this.notes.clear();
    this.clocks.clear();
  }
}
