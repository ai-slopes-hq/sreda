// Drains the engine's event ring and sends each MIDI message to the device at the time its sample leaves the speakers.
import type { EventRing } from '@sreda/protocol';
import type { MidiDevices } from './devices';
import type { NoteLedger } from './ledger';

/** What the plan says about the node that produced an event. */
export interface NodeInfo {
  id: string;
  offsetMs: number;
  muted: boolean;
}

interface Options {
  ring: EventRing;
  sampleRate: number;
  stamp: () => AudioTimestamp;
  resolve: (seq16: number, node: number) => NodeInfo | null;
  devices: MidiDevices;
  ledger: NoteLedger;
  now: () => number;
}

export class MidiPump {
  private timer: ReturnType<typeof setInterval> | null = null;
  private lateCount = 0;
  private wasConnected = false;
  /** the last time sent per node: OFS read per event may move down, but a node's events keep their order */
  private readonly lastSent = new Map<string, number>();

  constructor(private readonly o: Options) {}

  /** Drains the ring once. Events with no port or no node are read and dropped. */
  tick(): void {
    const o = this.o;
    this.checkPort();
    let stamp: AudioTimestamp;
    try {
      stamp = o.stamp();
    } catch {
      return; // the clock is not readable now: skip this tick, the events stay in the ring
    }
    const ctx = stamp.contextTime ?? 0;
    const perf = stamp.performanceTime ?? 0;
    o.ring.read((frame, seq16, node, midi) => {
      try {
        this.handle(frame, seq16, node, midi, perf, ctx);
      } catch {
        // one bad event must not abort the drain
      }
    });
    this.checkPort();
  }

  private handle(frame: number, seq16: number, node: number, midi: number, perf: number, ctx: number): void {
    const o = this.o;
    const info = o.resolve(seq16, node);
    if (!info) return;
    // only notes (3 bytes) and real-time messages (1 byte) are expected
    const b0 = midi & 0xff;
    const bytes = b0 >= 0xf8 ? [b0] : [b0, (midi >> 8) & 0xff, (midi >> 16) & 0xff];
    if (info.muted && (b0 >= 0xf8 || (b0 >= 0x90 && b0 < 0xa0 && (bytes[2] as number) > 0))) return;
    let time = perf + (frame / o.sampleRate - ctx) * 1000 + info.offsetMs;
    const now = o.now();
    let late = false;
    if (time < now) {
      time = now;
      late = true;
    }
    const prev = this.lastSent.get(info.id);
    if (prev !== undefined && time < prev) time = prev;
    if (o.devices.send(bytes, time)) {
      this.lastSent.set(info.id, time);
      if (late) this.lateCount++;
      o.ledger.sent(info.id, bytes);
    }
  }

  start(): void {
    if (this.timer === null) this.timer = setInterval(() => this.tick(), 3);
  }

  stop(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
  }

  /** Events that were already past due when sent. */
  late(): number {
    return this.lateCount;
  }

  /** When the port goes away, the ledger forgets what it tracked. */
  private checkPort(): void {
    const connected = this.o.devices.status() === 'connected';
    if (this.wasConnected && !connected) this.o.ledger.forget();
    this.wasConnected = connected;
  }
}
