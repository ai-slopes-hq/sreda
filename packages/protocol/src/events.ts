// Engine events (MIDI bytes pushed by DSPs) from the audio thread to the main thread: a single-writer /
// single-reader ring over a SharedArrayBuffer. Header Int32 [head, tail, dropped, _], then RING_RECORDS records of
// 4 × u32: frameLo, frameHi, seq16 << 16 | node, midi. head and tail count records and wrap as int32.
export const RING_RECORDS = 4096;
const HEADER_WORDS = 4;
const RECORD_WORDS = 4;
const MASK = RING_RECORDS - 1;
const TWO32 = 4294967296;

export function ringBytes(): number {
  return (HEADER_WORDS + RING_RECORDS * RECORD_WORDS) * 4;
}

/** The audio-thread side. write() runs inside process(): no allocation. */
export class RingWriter {
  private readonly header: Int32Array;
  private readonly words: Uint32Array;
  private head = 0;

  constructor(sab: SharedArrayBuffer) {
    this.header = new Int32Array(sab, 0, HEADER_WORDS);
    this.words = new Uint32Array(sab, HEADER_WORDS * 4, RING_RECORDS * RECORD_WORDS);
    this.head = Atomics.load(this.header, 0);
  }

  /** Drops the record and counts it when the ring is full. */
  write(frame: number, seqNode: number, midi: number): void {
    const tail = Atomics.load(this.header, 1);
    if (((this.head - tail) | 0) >= RING_RECORDS) {
      Atomics.add(this.header, 2, 1);
      return;
    }
    const at = (this.head & MASK) * RECORD_WORDS;
    this.words[at] = frame % TWO32;
    this.words[at + 1] = Math.floor(frame / TWO32);
    this.words[at + 2] = seqNode;
    this.words[at + 3] = midi;
    this.head = (this.head + 1) | 0;
    Atomics.store(this.header, 0, this.head);
  }
}

/** The main-thread side. */
export class EventRing {
  private readonly header: Int32Array;
  private readonly words: Uint32Array;

  constructor(sab: SharedArrayBuffer) {
    this.header = new Int32Array(sab, 0, HEADER_WORDS);
    this.words = new Uint32Array(sab, HEADER_WORDS * 4, RING_RECORDS * RECORD_WORDS);
  }

  /** Visits every unread record in order; returns how many. Frames are exact up to 2^53. */
  read(visit: (frame: number, seq16: number, node: number, midi: number) => void): number {
    const head = Atomics.load(this.header, 0);
    let tail = Atomics.load(this.header, 1);
    let n = 0;
    while (tail !== head) {
      const at = (tail & MASK) * RECORD_WORDS;
      const w = this.words;
      const sn = w[at + 2] as number;
      visit((w[at + 1] as number) * TWO32 + (w[at] as number), sn >>> 16, sn & 0xffff, w[at + 3] as number);
      tail = (tail + 1) | 0;
      n++;
    }
    Atomics.store(this.header, 1, tail);
    return n;
  }

  dropped(): number {
    return Atomics.load(this.header, 2);
  }
}
