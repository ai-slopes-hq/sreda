// The MIDI side of one session (Plan 15): the device handle, the note ledger and the pump, tied to the plans the
// store sends and the document it shows. The store only forwards: planSent, applied, muteChanged, attach.
import { effectiveMuted, type Doc, type Plan } from '@sreda/core';
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
  /** where each node's visible knobs start in the readout buffer */
  knobs: number[];
}

export function createMidiSession(getDoc: () => Doc) {
  const devices = new MidiDevices(
    () => navigator.requestMIDIAccess({ sysex: false }),
    typeof window === 'undefined' ? undefined : window.sreda?.a4Port,
  );
  const ledger = new NoteLedger((bytes) => void devices.send(bytes, 0));
  /** the last sent plans by `seq & 0xFFFF`, for the pump to name the node an event came from */
  const known = new Map<number, KnownPlan>();
  let host: AudioHost | null = null;
  let pump: MidiPump | null = null;

  /** an A4 whose frame is muted stops at once (its note-off goes out; the pump drops its note-ons) */
  function muteChanged(doc: Doc): void {
    for (const m of doc.modules)
      if (MIDI_TYPES.has(m.type) && m.parent && effectiveMuted(doc, m.parent)) ledger.release(m.id);
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
    if (m?.type === 'a4') {
      // OFFSET is visible knob 1: the engine's reading while it plays that plan, else the value compile() sent
      // (a missing param reads 0 there)
      const buf = host?.readouts;
      const pos =
        buf && ((buf[0] ?? 0) & 0xffff) === seq16
          ? (buf[(k.knobs[node] ?? 0) + 1] ?? 0)
          : (m.params['offset'] ?? 0);
      offsetMs = -50 + 100 * pos;
    }
    return { id, offsetMs, muted };
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
        knobs: plan.layout.nodes.map((n) => n.knobs),
      });
      if (known.size > KNOWN_PLANS) known.delete(known.keys().next().value!);
      if (plan.nodes.some((n) => MIDI_TYPES.has(n.type))) devices.start();
    },
    /** the engine plays a plan: A4 modules that are not in it have left (deleted, or another project opened) */
    applied(seq: number): void {
      const k = known.get(seq & 0xffff);
      if (!k) return;
      ledger.keepOnly(k.midi);
      muteChanged(getDoc());
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
      const unload = (): void => ledger.releaseAll(true);
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
        ledger.releaseAll(true);
        devices.dispose();
        host = null;
      };
    },
  };
}
