# SREDA 2 — the A4 module (Analog Four MKII over USB MIDI)

Date: 2026-10-13 · Revision 4 (two modules: A4 and A4 CLK; MIDI permission as built) · Status: approved

## Why

The user plays an Elektron Analog Four MKII next to SREDA. The A4 module lets SREDA's sequencers play the A4's
four synth tracks and clock its own tempo-synced parts (LFOs, delay, arpeggiator, sequencer), as if the A4 were a
module on the canvas. It is the first path from the engine to the outside world. MIDI OUT and CV-out modules for
other hardware can use the same path later.

**Success:** a patch `clock → META-SEQ → A4 T1` plays the A4 in time with SREDA's own audio. The user confirms this
by ear at the checkpoints (§8). With no A4 connected, a project with the module opens and plays normally, and the
panel says NOT CONNECTED. Unplugging or plugging the A4 while playing crashes nothing and leaves no hanging notes.

## Out of scope

- The A4's audio back into SREDA (Overbridge). The user listens to the A4 itself.
- CC / NRPN parameter control. It comes next, on the same event path. The CC/NRPN tables live in the `elektron`
  repo's `maps/a4mk2.toml`.
- SysEx of any kind, MIDI IN, port or channel choice in the UI, the Analog Rytm, and other MIDI devices.

## Transport

USB MIDI is the only way to send notes to the A4 over USB. Overbridge carries audio and its own plugin's parameter
control, has no public API, and cannot play notes. Channels 1–4 are local to the A4's own USB port, so they don't
collide with other devices. The UI never shows channel numbers.

## 1. The module specs (Rust)

The A4 is two small modules, in SREDA's atomic spirit. One module with 15 inputs would break the panel grammar
(one jack per lane, at most 12 lanes at 3U). Both are sinks with no outputs, size (4, 2), display `device` (§6).

| | `a4` — `A4`, one track | `a4clk` — `A4 CLK`, clock and transport |
|---|---|---|
| file | `engine/src/modules/a4.rs` | `engine/src/modules/a4clk.rs` |
| inputs | `pitch` PITCH (pitch), `gate` GATE (trigger, held), `vel` VEL (mod) | `clk` CLK (trigger), `run` RUN (trigger, held), `rst` RST (trigger) |
| knobs | `note` NOTE, MIDI note 0–127, step 1, default 48 (C3 in Elektron's naming); `offset` OFS −50…+50 ms | `offset` OFS −50…+50 ms |
| option | `track` TRK: T1–T4 → channel 1–4 | — |

Four tracks take four `A4` modules. Several may share a track; each tracks its own note.

**Held trigger inputs.** The engine normally turns every trigger input into 1 ms pulses (`inputs.rs`), so a DSP
never sees how long a gate lasts. `Port` gets a `held` flag, set with `port(..).held()`. A held input is still a
trigger cable: same role, colour and patching rules. The plan marks it with input kind `held`, and the engine passes
its level straight through, summed over its sources like an audio input, with no `TriggerInput` and no ratio. It
keeps its trigger-count readout slot, which stays 0, so the later trigger inputs keep their slots. The ratio control
is hidden on held inputs, and `specs.json` carries the flag. GATE and RUN are held. CLK and RST stay ordinary triggers and keep their
ratio (CLK ×2 doubles the A4's tempo).

## 2. The DSP

Everything is sample-accurate and nothing allocates. Each held input has its own `EdgeDetector`, with the rise
above 0.5 and re-arm below 0.25 used everywhere else.

**Notes (`a4`; channel N for track TN):**

- **GATE rise:** note = clamp(NOTE + round(12 · PITCH), 0, 127), read at the rise (sample-and-hold). Velocity is
  clamp(round(127 · VEL), 1, 127), or 100 if VEL is unpatched. If the track already sounds a note, its note-off
  goes first, then the new note-on. An A4 track is monophonic.
- **GATE fall:** a note-off for the note that sounds, whatever PITCH does meanwhile.
- A 1 ms trigger patched into GATE plays a 1 ms note. The A4's envelope gives it its length.
- **GATE unpatched while a note sounds:** a note-off. `connected_in` turning false counts as a fall.

**Clock (`a4clk`):**

- **RUN** rise → MIDI Start (0xFA), fall → Stop (0xFC). With RUN unpatched, the clock runs as soon as CLK beats and
  never sends Start or Stop.
- **CLK:** each rise is one beat. The DSP measures the beat period and sends 24 Timing Clock (0xF8) ticks per beat,
  spread evenly over the last measured period. Tick 0 goes out on the rise itself. If the next rise comes early,
  the ticks still owed go out at once, so 24 ticks per beat always hold. If it comes late, ticks stop at 23 and
  wait for the rise. The tempo follows within one beat. Before the second rise there is no period yet, so only
  tick 0 goes out. A gap longer than 2 s resets the measurement.
- **RST** rise → Stop then Start in the same sample. The A4 restarts its pattern from the top. With RUN patched
  and low (stopped), RST does nothing.
- RUN unpatched while running → Stop.

**Events.** The DSP pushes `{offset in block, 3 MIDI bytes}` into `ctx.events` (§3). Unused bytes are 0. Real-time
messages are one byte.

## 3. The engine's outbox

- `Ctx` gets `events: EventBox`, a fixed-capacity array allocated with the `Ctx` that holds 1024 events per block.
  `push(node, offset, bytes)` appends, or drops the event and increments `dropped`. The engine sets the current node
  index before each DSP runs, so a DSP doesn't pass it.
- `Engine::process` clears the box at the start of each block. The WASM wrapper exposes `events()` as a `&[u32]`
  view over WASM memory, in the same style as `readouts()`. Each event is two u32s: `node << 16 | offset`, then the
  bytes packed little-endian. `events_dropped()` is the running count.
- Events within a block keep their push order. Nodes run in plan order, so two modules' events at the same offset
  keep that order.

## 4. The worklet and the event ring

- `AudioHost.start()` creates a second SharedArrayBuffer, `events`, beside `readouts`, and exposes it as
  `host.events`. It holds a header (`head`, `tail`, `dropped`, as Int32 with `Atomics`) and a ring of 4096 records
  of four u32s: `frameLo, frameHi, seq16 << 16 | node, midi`. `seq16` is the low 16 bits of the playing plan's seq
  (readout 0), so the main thread maps a node index through the plan that produced it, even across a new plan.
- In `process()`, after `engine.process()`, the worklet copies each event into the ring. The record's frame is the
  block's `currentFrame` plus the event's offset. It's one writer and one reader: the worklet advances `head`, the
  main thread advances `tail`. A full ring drops the event and increments `dropped`. The loop follows the audio
  thread rules: class fields, typed arrays and an indexed `for`, nothing else.
- The ring code lives in `packages/protocol/src/events.ts`, with a writer for the worklet and a reader for the main
  thread, so it can be tested without audio.

## 5. The MIDI side (renderer main thread, `packages/ui/src/midi/`)

**Access.** The renderer asks for MIDI with `requestMIDIAccess({ sysex: false })`. Such an access throws on any
SysEx message, and the app never builds one, so it cannot overwrite the A4's memory. Electron (44) routes every MIDI
request through the permission check as `midiSysex`, so it must stay allowed; refusing it disables MIDI. The app has
no permission handlers: Electron's default allows it, and SysEx stays blocked by `sysex: false`. `MidiDevices`
(`devices.ts`) calls `navigator.requestMIDIAccess()` once, the first time a plan contains an A4 node, and never
touches MIDI before that.

**Device status.** The output port is the first whose name contains `Analog Four`. `onstatechange` re-scans on every
plug and unplug. The status is one of:

- `idle`: MIDI is not requested yet (no plan with an A4 has been sent). The panel shows its label as usual and
  WIRES lists nothing;
- `connected`;
- `missing`: no such port;
- `unavailable`: Web MIDI rejected or absent. It is shown like `missing`, with a different caption.

**`MidiPump` (`pump.ts`).** It runs every 3 ms (`setInterval`) while the audio host lives.

1. It drains the ring. With no port, every event is read and dropped, so the ring never fills.
2. It maps each event's frame to a performance time, using `getOutputTimestamp()`:
   `perf = performanceTime + (frame / sampleRate − contextTime) · 1000 + OFFSET`. The A4 then sounds when the
   matching SREDA sample leaves the speakers. The output latency, about 10–20 ms, is the margin the polling has.
   OFFSET comes from the node's knob readout.
3. It calls `output.send(bytes, perf)`, and the OS keeps the time. If `perf` has already passed, the event goes out
   at once and `late` increments. Late notes are late, never lost or stuck.
4. Every `send` and `requestMIDIAccess` is wrapped in try/catch. An exception means `missing` and re-scan, never an
   error dialog.

**`NoteLedger` (`ledger.ts`).** It tracks the sounding note per node and track, from the events the pump sends, and
sends note-offs for all of them, plus Stop if that node's clock runs, when:

- the node leaves the plan (deleted, or another project opened);
- the node's frame is muted. While muted, the pump drops that node's note-ons and clock. The node→frame map comes
  from the plan. An A4 CLK that becomes audible again (unmuted, or back in an applied plan after an undone delete)
  while its state readout says it runs gets a Start, sent through the ledger path and recorded in it, because its
  DSP never saw the Stop;
- the audio host stops or closes (hot reload), or the window unloads;
- the port disappears. Nothing is sent then, the ledger just clears. On reconnect, notes resume with the next GATE
  rise and held notes are not re-sent.

On close and unload it also sends All Notes Off (CC 123) on channels 1–4. Every release message goes out twice
there: once at once (time 0) and once after the last scheduled message, so it leaves whether or not the queued
messages survive the window. A node's events never get an earlier time than its previous one (OFS turned down
mid-note must not put a note-off before its note-on), and the recovery All Notes Off after a failed send follows the
same `max(now, last + 1)` rule. The pump keeps the last plan the engine applied with code 0 known, however many
rejected plans follow. A note-off is by (channel, note): two A4s on one track can cut each other's note (won't fix:
MIDI cannot tell them apart, and an A4 track is monophonic). Two A4 nodes in one project are allowed.
Both play the same device, and the ledger keeps them apart.

## 6. The panel

New display kind `device`, a `Panel.tsx` branch and `displays/Device.tsx`:

- **connected:** the label (`A4 · T2`, `A4 CLK`) with a status dot and one light: lit while the note sounds
  (`a4`) or while running (`a4clk`). The DSP's `state()` is 1 or 0.
- **idle** (MIDI not requested yet): the label as for connected, with the dot unlit.
- **missing / unavailable:** a dimmed `A4 · NOT CONNECTED` (or `NO MIDI`), styled like a missing sample.
- WIRES lists a disconnected A4 next to missing samples. Having no outputs, the A4 counts as a sink like OUT
  and SCOPE, so WIRES does not flag it as leading nowhere.

## 7. Tests

**Rust (`cargo test`):**

- the DSP through `Bench`:
  - gate → note-on/off on the right samples, with pitch sample-and-hold and the clamps;
  - retrigger on a sounding track;
  - VEL unpatched → 100;
  - unpatching GATE mid-note → note-off;
  - 24 ticks per beat at a steady tempo, through a tempo change both ways, and only tick 0 before the second rise;
  - RUN start/stop, RST stop+start, RUN unpatched while running → stop;
- held inputs: the level passes through unpulsed, the maximum over sources, and `blockwise_equals_per_sample`;
- `EventBox`: overflow drops and counts, push order is kept, the box clears per block;
- `alloc.rs`: a plan with an A4 playing notes and clock allocates nothing.

**Vitest:**

- the event ring: wrap-around, `dropped`, 64-bit frames, writer and reader on one buffer;
- `MidiPump` on a fake `getOutputTimestamp` and fake outputs: the time mapping, OFFSET, late events counted and sent
  at once, events dropped with no port;
- `NoteLedger`: note-offs on node removal, mute and close, and All Notes Off;
- `MidiDevices` on a fake `MIDIAccess`: name match, `connected` ↔ `missing` on state changes, a throwing `send` →
  `missing`, a rejected request → `unavailable`;
- the WASM engine in node with `clock → META-SEQ → A4`: the bytes from `events()` match the expected MIDI.

**e2e (Playwright):** with no A4 attached, a project with an A4 module opens, plays (the master meter moves) and
shows NOT CONNECTED.

## 8. Listening checkpoints

1. **Notes:**
   - `clock → META-SEQ → A4 T1` next to a SREDA drum patch: the A4 plays in time with SREDA's audio, and OFFSET
     trims it;
   - unplug and replug the USB while playing: no crash, playback resumes;
   - delete the module mid-note: nothing hangs.
2. **Four tracks and VEL, under load:** a heavy project, dragging modules while playing. Watch `late` and listen for
   drift. If notes drift, the fallback is a fixed lookahead with SREDA's audio delayed by the same amount. It is a
   separate decision, not part of this plan.
3. **Clock:**
   - the A4's synced LFO and delay follow SREDA's tempo, including a BPM change while playing;
   - RUN starts and stops the A4's sequencer, and RST restarts it.
