// Web MIDI access for the Analog Four: finds the output port by name, tracks plug/unplug, never throws out.
import { createSignal } from 'solid-js';

export type MidiStatus = 'connected' | 'missing' | 'unavailable';

/** Requests MIDI lazily (no SysEx) and keeps the first output port whose name contains `portName`. */
export class MidiDevices {
  private readonly state = createSignal<MidiStatus>('missing');
  private started = false;
  private access: MIDIAccess | null = null;
  private port: MIDIOutput | null = null;

  constructor(
    private readonly request: () => Promise<MIDIAccess>,
    private readonly portName = 'Analog Four',
  ) {}

  /** Idempotent: requests MIDI access once. */
  start(): void {
    if (this.started) return;
    this.started = true;
    let p: Promise<MIDIAccess>;
    try {
      p = this.request();
    } catch {
      this.state[1]('unavailable');
      return;
    }
    p.then(
      (access) => {
        this.access = access;
        access.onstatechange = () => this.scan();
        this.scan();
      },
      () => this.state[1]('unavailable'),
    );
  }

  /** Solid accessor. */
  status(): MidiStatus {
    return this.state[0]();
  }

  /** Sends at a performance time; false when not connected or the port threw (then status is 'missing'). */
  send(bytes: number[], time: number): boolean {
    const port = this.port;
    if (!port) return false;
    try {
      port.send(bytes, time);
      return true;
    } catch {
      // a stale port: drop it until the next state change re-lists the devices
      this.scan(port);
      return false;
    }
  }

  private scan(skip?: MIDIOutput): void {
    this.port = null;
    try {
      for (const out of this.access?.outputs.values() ?? []) {
        if (out !== skip && (out.name ?? '').includes(this.portName)) {
          this.port = out;
          break;
        }
      }
    } catch {
      // treated as no port
    }
    this.state[1](this.port ? 'connected' : 'missing');
  }
}
