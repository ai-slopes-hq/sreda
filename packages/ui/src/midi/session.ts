// The MIDI side of one session (Plan 15): the device handle, the note ledger and the pump, tied to the plans the
// store sends and the document it shows. The store only forwards: planSent, applied, muteChanged, attach.
import { effectiveMuted, type Doc, type KnobParam, type Plan, type Specs } from '@sreda/core';
import type { AudioHost } from '../audio/host';
import { MidiDevices } from './devices';
import { NoteLedger } from './ledger';
import { MidiPump } from './pump';

/** module types that talk MIDI */
const MIDI_TYPES = new Set(['a4', 'a4clk']);
/** how many sent plans stay known to the pump (events carry only the low 16 bits of the plan's seq) */
const KNOWN_PLANS = 8;
interface KnownPlan {
  /** the module id of each plan node (a frame's clock node: the frame's id) */
  ids: string[];
  /** the ids of its A4 / A4 CLK nodes */
  midi: Set<string>;
  /** where each node's OFS knob reads in the readout buffer (-1: the node has none) */
  offset: number[];
  /** where each node's state reads in the readout buffer */
  state: number[];
}

export function createMidiSession(getDoc: () => Doc, specs: Specs) {
  const devices = new MidiDevices(
    () => navigator.requestMIDIAccess({ sysex: false }),
    typeof window === 'undefined' ? undefined : window.sreda?.a4Port,
  );
  /** on close and unload every release goes out twice: at once, and after what is already scheduled */
  let twice = false;
  const ledger = new NoteLedger((bytes) => {
    if (twice) devices.send(bytes, 0);
    devices.sendAfterScheduled(bytes);
  });
  /** the last sent plans by `seq & 0xFFFF`, for the pump to name the node an event came from */
  const known = new Map<number, KnownPlan>();
  /** the last plan the engine applied with code 0: it is still the one playing, so it is never forgotten */
  let pinned = -1;
  /** the MIDI modules of the last applied plan */
  let playing = new Set<string>();
  /** the MIDI modules that were muted at the last look: an A4 CLK that is audible again starts its clock anew */
  const silenced = new Set<string>();
  let host: AudioHost | null = null;
  let pump: MidiPump | null = null;

  /** the engine's own reading of an A4 CLK's state (1: running), or null while the readouts do not show its plan */
  function runningNow(id: string): boolean | null {
    const buf = host?.readouts;
    if (!buf) return null;
    const k = known.get((buf[0] ?? 0) & 0xffff);
    const node = k ? k.ids.indexOf(id) : -1;
    return k && node >= 0 ? (buf[k.state[node] ?? 0] ?? 0) === 1 : null;
  }

  /** an A4 CLK is audible again while its DSP still runs: the Stop it got on mute needs a Start to undo it */
  function restart(id: string, retry = true): void {
    const doc = getDoc();
    const m = doc.modules.find((x) => x.id === id);
    if (!m || m.type !== 'a4clk' || (m.parent && effectiveMuted(doc, m.parent)) || ledger.clockRunning(id)) return;
    const running = runningNow(id);
    if (running === null) {
      // the readouts still show an older plan: look again once they have caught up
      if (retry) setTimeout(() => restart(id, false), 60);
    } else if (running && devices.sendAfterScheduled([0xfa])) ledger.sent(id, [0xfa]);
  }

  /** an A4 whose frame is muted stops at once (its note-off goes out; the pump drops its note-ons) */
  function muteChanged(doc: Doc): void {
    for (const m of doc.modules) {
      if (!MIDI_TYPES.has(m.type) || !m.parent) continue;
      if (effectiveMuted(doc, m.parent)) {
        silenced.add(m.id);
        ledger.release(m.id);
      } else if (silenced.delete(m.id)) restart(m.id);
    }
  }

  function resolve(seq16: number, node: number) {
    const k = known.get(seq16);
    const id = k?.ids[node];
    if (!k || !id || !k.midi.has(id)) return null;
    const doc = getDoc();
    const m = doc.modules.find((x) => x.id === id);
    // a module deleted since: nothing new from it (its note-offs still pass)
    const muted = !m || (!!m.parent && effectiveMuted(doc, m.parent));
    let offsetMs = 0;
    if (m) {
      // OFFSET: the engine's reading while it plays that plan, else the value compile() sent (a missing param
      // reads 0 there)
      const buf = host?.readouts;
      const at = k.offset[node] ?? -1;
      const pos =
        buf && at >= 0 && ((buf[0] ?? 0) & 0xffff) === seq16 ? (buf[at] ?? 0) : (m.params['offset'] ?? 0);
      offsetMs = -50 + 100 * pos;
    }
    return { id, offsetMs, muted };
  }

  /** the window is closing: queued messages may not survive, so every release goes out at once and once scheduled */
  function releaseAll(): void {
    twice = true;
    try {
      ledger.releaseAll(true);
    } finally {
      twice = false;
    }
  }

  return {
    devices,
    status: () => devices.status(),
    resolved: () => devices.isResolved(),
    /** a plan is about to be sent: remember its nodes, and ask for MIDI once it has an A4 */
    planSent(plan: Plan): void {
      known.set(plan.seq & 0xffff, {
        ids: plan.nodes.map((n) => n.id),
        midi: new Set(plan.nodes.filter((n) => MIDI_TYPES.has(n.type)).map((n) => n.id)),
        offset: plan.nodes.map((n, i) => {
          const visible = (specs[n.type]?.params ?? []).filter(
            (p): p is KnobParam => p.kind === 'knob' && !p.hidden,
          );
          const at = visible.findIndex((p) => p.id === 'offset');
          return at < 0 ? -1 : plan.layout.nodes[i]!.knobs + at;
        }),
        state: plan.layout.nodes.map((n) => n.state),
      });
      // the oldest go first, but never the plan the engine plays: repeated rejected plans must not evict it
      for (const key of known.keys()) {
        if (known.size <= KNOWN_PLANS) break;
        if (key !== pinned) known.delete(key);
      }
      if (plan.nodes.some((n) => MIDI_TYPES.has(n.type))) devices.start();
    },
    /** the engine plays a plan: A4 modules that are not in it have left (deleted, or another project opened) */
    applied(seq: number): void {
      const k = known.get(seq & 0xffff);
      if (!k) return;
      pinned = seq & 0xffff;
      const before = playing;
      playing = k.midi;
      ledger.keepOnly(k.midi);
      muteChanged(getDoc());
      // a clock that is back in the plan (an undone delete) may still run in the engine
      for (const id of k.midi) if (!before.has(id)) restart(id);
    },
    muteChanged,
    /** the pump lives with the host; closing it (or unloading the window) switches every sounding note off */
    attach(h: AudioHost): void {
      host = h;
      pump = new MidiPump({
        ring: h.events,
        sampleRate: h.sampleRate,
        stamp: () => h.outputTimestamp(),
        resolve,
        devices,
        ledger,
        now: () => performance.now(),
      });
      pump.start();
      const unload = (): void => releaseAll();
      window.addEventListener('beforeunload', unload);
      // dev builds: a once-a-second line while the pump's late count or the ring's dropped count changes
      let report: ReturnType<typeof setInterval> | null = null;
      if (import.meta.env.DEV) {
        let seen = '';
        report = setInterval(() => {
          const line = `late ${pump?.late() ?? 0}, dropped ${h.events.dropped()}`;
          if (line !== seen) {
            if (seen !== '' || line !== 'late 0, dropped 0') console.info(`[midi] ${line}`);
            seen = line;
          }
        }, 1000);
      }
      h.onClose = () => {
        pump?.stop();
        pump = null;
        if (report !== null) clearInterval(report);
        window.removeEventListener('beforeunload', unload);
        releaseAll();
        devices.dispose();
        host = null;
      };
    },
  };
}
