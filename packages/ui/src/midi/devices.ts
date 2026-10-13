// Web MIDI access for the Analog Four: finds the output port by name, tracks plug/unplug, never throws out.
import { createSignal } from 'solid-js';

export type MidiStatus = 'connected' | 'missing' | 'unavailable';

/** Requests MIDI lazily (no SysEx) and keeps the first output port whose name contains `portName`. */
export class MidiDevices {
  private readonly state = createSignal<MidiStatus>('missing');
  private started = false;
  private access: MIDIAccess | null = null;
  private port: MIDIOutput | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  /** the last loss was a send that threw, not an unplug */
  private threw = false;
  private disposed = false;
  private resolved = false;
  /** the latest timestamp handed to the port: the OS holds messages until then */
  private lastTime = 0;

  constructor(
    private readonly request: () => Promise<MIDIAccess>,
    private readonly portName = 'Analog Four',
  ) {}

  /** Idempotent: requests MIDI access once. */
  start(): void {
    if (this.started || this.disposed) return;
    this.started = true;
    let p: Promise<MIDIAccess>;
    try {
      p = this.request();
    } catch {
      this.resolved = true;
      this.state[1]('unavailable');
      return;
    }
    p.then(
      (access) => {
        if (this.disposed) return;
        this.access = access;
        this.resolved = true;
        access.onstatechange = () => this.scan();
        this.scan();
      },
      () => {
        this.resolved = true;
        this.state[1]('unavailable');
      },
    );
  }

  /** MIDI access was granted or refused (the status says which); false until then. For e2e. */
  isResolved(): boolean {
    return this.resolved;
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
      if (time > this.lastTime) this.lastTime = time;
      return true;
    } catch {
      // possibly transient: go missing, then poll until the port answers again; notes may hang, so clear them then
      this.port = null;
      this.threw = true;
      this.state[1]('missing');
      this.poll();
      return false;
    }
  }

  /**
   * Sends as soon as possible but never ahead of what is already scheduled: a note-off must not overtake a note-on the
   * OS still holds (the pump schedules a few tens of ms ahead), or the note hangs.
   */
  sendAfterScheduled(bytes: number[]): boolean {
    return this.send(bytes, Math.max(performance.now(), this.lastTime + 1));
  }

  /** Stops the re-scan timer. */
  private stopTimer(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
  }

  /** Lets go of everything (a hot reload ends the session): no timer, no listener, no port; later calls do nothing. */
  dispose(): void {
    this.disposed = true;
    this.stopTimer();
    if (this.access) this.access.onstatechange = null;
    this.access = null;
    this.port = null;
  }

  private poll(): void {
    if (!this.disposed && this.timer === null && this.access)
      this.timer = setInterval(() => this.scan(), 1000);
  }

  private scan(): void {
    if (this.disposed) return;
    this.port = null;
    try {
      for (const out of this.access?.outputs.values() ?? []) {
        if (out.state !== 'disconnected' && (out.name ?? '').includes(this.portName)) {
          this.port = out;
          break;
        }
      }
    } catch {
      // treated as no port
    }
    this.state[1](this.port ? 'connected' : 'missing');
    if (!this.port) {
      this.poll();
      return;
    }
    this.stopTimer();
    if (this.threw) {
      this.threw = false;
      try {
        for (let ch = 0; ch < 4; ch++) this.port.send([0xb0 | ch, 123, 0]);
      } catch {
        // the next send will notice
      }
    }
  }
}
