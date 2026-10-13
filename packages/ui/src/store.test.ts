// @vitest-environment happy-dom
import { addModule, emptyDoc, frameSelection, hiddenIn, SPECS, starterDoc, type Plan } from '@sreda/core';
import type { FromEngine, ToEngine } from '@sreda/protocol';
import { afterEach, expect, test, vi } from 'vitest';
import { FakeAccess } from './midi/fakes';
import type { AudioHost } from './audio/host';
import { createSession } from './store';

/** a posted plan message's plan (it travels as UTF-8 JSON bytes) */
const planOf = (m: ToEngine | undefined): Plan =>
  JSON.parse(new TextDecoder().decode(m?.t === 'plan' ? m.bytes : new Uint8Array())) as Plan;

function fakeHost() {
  const sent: ToEngine[] = [];
  const host = {
    readouts: new Float32Array(16),
    onMessage: null as ((m: FromEngine) => void) | null,
    onError: null as ((message: string) => void) | null,
    post: (m: ToEngine) => sent.push(m),
    events: { read: () => 0, dropped: () => 0 },
    sampleRate: 48000,
    outputTimestamp: () => ({ contextTime: 0, performanceTime: performance.now() }),
    onClose: null as (() => void) | null,
  };
  return { host, sent, asHost: host as unknown as AudioHost };
}

test('a plan the engine refuses shows a notice', () => {
  const s = createSession(SPECS, starterDoc(SPECS));
  const { host, sent, asHost } = fakeHost();
  s.attach(asHost);
  const plan = sent.find((m) => m.t === 'plan');
  expect(plan).toBeDefined();
  host.onMessage?.({ t: 'applied', seq: plan!.t === 'plan' ? plan!.seq : 0, code: 2 });
  expect(s.state.notice).toBe('THE ENGINE REFUSED THE PATCH (2) — THE PREVIOUS ONE KEEPS PLAYING');
});

test('a crashed engine shows a notice', () => {
  const s = createSession(SPECS, starterDoc(SPECS));
  const { host, asHost } = fakeHost();
  s.attach(asHost);
  host.onError?.('boom');
  expect(s.state.notice).toBe('THE AUDIO ENGINE STOPPED — RESTART THE APP');
});

test('param edits go as knob / fixed messages; one an own-normal condition reads sends a plan', async () => {
  const { addModule, emptyDoc } = await import('@sreda/core');
  let doc = addModule(emptyDoc, SPECS, 'metaseq', 0, 0).doc;
  doc = addModule(doc, SPECS, 'slope', 0, 400).doc;
  const s = createSession(SPECS, doc);
  const { sent, asHost } = fakeHost();
  s.attach(asHost);
  sent.length = 0;
  // ROOT is a hidden knob of META-SEQ (0…11, whole steps): a fixed message in real units at its index among the fixed values (8 patterns, SCALE, then ROOT)
  s.params('m1', { root: 0.5 }, undefined);
  expect(sent).toEqual([{ t: 'fixed', node: 0, index: 921, value: 6 }]);
  sent.length = 0;
  s.params('m1', { trns: 0.75 }, undefined);
  expect(sent).toEqual([{ t: 'knob', node: 0, index: 1, value: 0.75 }]);
  sent.length = 0;
  // SLOPE's CYCLE decides its own normal: the plan changes
  s.params('m2', { cycle: 1 }, undefined);
  expect(sent.map((m) => m.t)).toContain('plan');
  // and undo restores through a plan
  sent.length = 0;
  s.undo();
  expect(sent.map((m) => m.t)).toContain('plan');
});

test('frame clock edits go as messages to its clock node; undo restores through a plan', async () => {
  const { frameSelection } = await import('@sreda/core');
  const framed = frameSelection(starterDoc(SPECS), SPECS, ['m1']);
  const s = createSession(SPECS, framed.doc);
  const { sent, asHost } = fakeHost();
  s.attach(asHost);
  sent.length = 0;
  // the frame's clock node comes after the two modules
  s.frame(framed.id, { clock: { on: true, bpm: 120 } }, undefined);
  s.frame(framed.id, { clock: { on: true, bpm: 130 } }, { key: 'bpm', stroke: true });
  s.frame(framed.id, { clock: { on: true, bpm: 140 } }, { key: 'bpm', stroke: true });
  s.frame(framed.id, { ratio: -2 }, undefined);
  s.frame(framed.id, { name: 'DRUMS', tint: 2 }, undefined);
  expect(sent).toEqual([
    { t: 'fixed', node: 2, index: 0, value: 1 },
    { t: 'fixed', node: 2, index: 1, value: 120 },
    { t: 'fixed', node: 2, index: 0, value: 1 },
    { t: 'fixed', node: 2, index: 1, value: 130 },
    { t: 'fixed', node: 2, index: 0, value: 1 },
    { t: 'fixed', node: 2, index: 1, value: 140 },
    { t: 'ratio', node: 2, input: 0, value: -2 },
  ]);
  sent.length = 0;
  s.undo(); // name and tint
  s.undo(); // ratio
  s.undo(); // the BPM drag, one step
  const plans = sent.filter((m) => m.t === 'plan');
  expect(plans).toHaveLength(3);
  const last = plans[2]!;
  expect(planOf(last).nodes[2]!.fixed).toEqual([1, 120]);
});

test('a frame CLK OUT can be listened to', async () => {
  const { frameSelection } = await import('@sreda/core');
  const framed = frameSelection(starterDoc(SPECS), SPECS, ['m1']);
  const s = createSession(SPECS, framed.doc);
  const { sent, asHost } = fakeHost();
  s.attach(asHost);
  sent.length = 0;
  s.setListen({ id: framed.id, port: 'clkOut' });
  expect(sent).toEqual([{ t: 'listen', target: { node: 2, port: 0 } }]);
});

test('muting a frame mutes its children: mute messages, no plan; undo restores through a plan', async () => {
  const { frameSelection } = await import('@sreda/core');
  const g1 = frameSelection(starterDoc(SPECS), SPECS, ['m1', 'm2']);
  const g2 = frameSelection(g1.doc, SPECS, ['m1']);
  const s = createSession(SPECS, g2.doc);
  const { sent, asHost } = fakeHost();
  s.attach(asHost);
  sent.length = 0;
  s.frame(g1.id, { muted: true }, undefined);
  expect(sent).toEqual([
    { t: 'mute', frame: 0, on: true },
    { t: 'mute', frame: 1, on: true },
  ]);
  sent.length = 0;
  // the child is muted through its parent already: muting it too changes nothing in the engine
  s.frame(g2.id, { muted: true }, undefined);
  expect(sent).toEqual([]);
  s.undo();
  s.undo();
  const last = sent.filter((m) => m.t === 'plan').pop();
  expect(planOf(last).frames.map((f) => f.muted)).toEqual([false, false]);
});

test('opening a project replaces the canvas in one undo step and fades in', async () => {
  const { FACTORY } = await import('@sreda/core');
  const s = createSession(SPECS, starterDoc(SPECS));
  const { sent, asHost } = fakeHost();
  s.attach(asHost);
  sent.length = 0;
  const acid = FACTORY.find((e) => e.name === 'acid')!.build(SPECS);
  s.openProject(acid, { path: 'FACTORY/acid', factory: true });
  expect(s.state.doc.groups.map((g) => g.name)).toEqual(['ACID']);
  expect(s.state.project).toEqual({ path: 'FACTORY/acid', factory: true });
  expect(sent.map((m) => m.t)).toEqual(['plan', 'listen', 'fade']);
  s.undo();
  expect(s.current()).toEqual(starterDoc(SPECS));
});

test('a group lands with its frame top-left at the drop point, fresh ids; from a trigger output into its CLK IN', async () => {
  const { FACTORY } = await import('@sreda/core');
  const s = createSession(SPECS, starterDoc(SPECS));
  const voice = FACTORY.find((e) => e.name === 'vca-lpg')!.build(SPECS);
  s.placeGroup(voice, { x: 1000, y: 400 }, { id: 'm1', port: 'out', dir: 'out', role: 'trigger' });
  s.placeGroup(voice, { x: 1000, y: 1400 }, null);
  const d = s.current();
  expect(d.groups).toHaveLength(2);
  expect(d.groups.map((g) => [g.x, g.y])).toEqual([
    [1000, 400],
    [1000, 1400],
  ]);
  const ids = [...d.modules.map((m) => m.id), ...d.groups.map((g) => g.id)];
  expect(new Set(ids).size).toBe(ids.length);
  expect(d.cables).toContainEqual({ from: ['m1', 'out'], to: [d.groups[0]!.id, 'clkIn'] });
  expect(d.cables.filter((c) => c.to[1] === 'clkIn')).toHaveLength(1);
});

test('a move in free space sends no plan; a move into a frame does; plans travel as bytes', async () => {
  const { frameSelection, moveObjects, addModule } = await import('@sreda/core');
  const withFrame = frameSelection(addModule(starterDoc(SPECS), SPECS, 'osc', 0, 2000).doc, SPECS, ['m3']);
  const s = createSession(SPECS, withFrame.doc);
  const { sent, asHost } = fakeHost();
  s.attach(asHost);
  const first = sent.find((m) => m.t === 'plan')!;
  expect(first.t === 'plan' && first.bytes).toBeInstanceOf(Uint8Array);
  expect(planOf(first).nodes).toHaveLength(4);
  sent.length = 0;
  s.commit(moveObjects(s.current(), SPECS, ['m2'], 200, 0));
  expect(sent.filter((m) => m.t === 'plan')).toEqual([]);
  const g = s.current().groups[0]!;
  s.commit(
    moveObjects(
      s.current(),
      SPECS,
      ['m2'],
      g.x + 40 - s.current().modules[1]!.x,
      g.y + 60 - s.current().modules[1]!.y,
    ),
  );
  expect(s.current().modules[1]!.parent).toBe(g.id);
  expect(sent.filter((m) => m.t === 'plan')).toHaveLength(1);
});

test('undo after a message-only edit (a knob, a mute) still puts the engine back: a plan goes out', async () => {
  const { frameSelection } = await import('@sreda/core');
  const framed = frameSelection(starterDoc(SPECS), SPECS, ['m1']);
  const s = createSession(SPECS, framed.doc);
  const { sent, asHost } = fakeHost();
  s.attach(asHost);
  sent.length = 0;
  s.knob('m1', 'freq', 0.9, undefined);
  s.undo();
  expect(planOf(sent.filter((m) => m.t === 'plan').pop()).nodes[0]!.knobs[0]).toBe(
    framed.doc.modules[0]!.params['freq'],
  );
  sent.length = 0;
  s.frame(framed.id, { muted: true }, undefined);
  s.undo();
  expect(planOf(sent.filter((m) => m.t === 'plan').pop()).frames[0]!.muted).toBe(false);
});

test('a WIRES row picked by its cable index lets go when the cables change (an edit, an undo)', async () => {
  const { addModule, connect } = await import('@sreda/core');
  let doc = addModule(starterDoc(SPECS), SPECS, 'out', 600, 0).doc;
  doc = connect(doc, SPECS, ['m1', 'out'], ['m3', 'l']);
  const s = createSession(SPECS, doc);
  s.setState('sidebar', { open: true, picked: 1, hover: 1 });
  s.edit((d) => ({ ...d, cables: d.cables.slice(1) })); // the first cable goes: index 1 means nothing now
  expect(s.state.sidebar.picked).toBeNull();
  expect(s.state.sidebar.hover).toBeNull();
  s.setState('sidebar', 'picked', 0);
  s.undo();
  expect(s.state.sidebar.picked).toBeNull();
  // a knob turn leaves the cables alone: the pick stays
  s.setState('sidebar', 'picked', 0);
  s.knob('m1', 'freq', 0.3, undefined);
  expect(s.state.sidebar.picked).toBe(0);
});

test('collapsing a frame drops its modules from the selection and is one undo step; listening stays', () => {
  const s = createSession(SPECS, starterDoc(SPECS));
  const doc = s.current();
  const out = doc.modules.find((m) => m.type === 'out')!;
  const framed = frameSelection(doc, SPECS, [out.id]);
  s.commit(framed.doc);
  s.setState('sel', [out.id, framed.id]);
  s.setListen({ id: out.id, port: 'out' });
  s.collapse([framed.id], true);
  expect(s.state.sel).toEqual([framed.id]);
  expect(s.state.listen).toEqual({ id: out.id, port: 'out' });
  s.undo();
  expect(s.current().groups[0]!.collapsed).toBe(false);
});

test('collapsing a frame clears the hover of a module that goes out of sight', () => {
  const s = createSession(SPECS, starterDoc(SPECS));
  const out = s.current().modules.find((m) => m.type === 'out')!;
  const framed = frameSelection(s.current(), SPECS, [out.id]);
  s.commit(framed.doc);
  s.setState('hover', out.id);
  s.collapse([framed.id], true);
  expect(s.state.hover).toBeNull();
  s.setState('hover', framed.id);
  s.collapse([framed.id], false);
  expect(s.state.hover).toBe(framed.id);
});

test('picking a WIRES row of a wire hidden in a collapsed frame expands that frame, in one undo step', () => {
  const s = createSession(SPECS, starterDoc(SPECS));
  const c = s.current().cables.find((x) => !x.from[0].startsWith('g') && !x.to[0].startsWith('g'))!;
  const framed = frameSelection(s.current(), SPECS, [c.from[0], c.to[0]]);
  s.commit(framed.doc);
  const index = s.current().cables.findIndex((x) => x.from[0] === c.from[0] && x.to[0] === c.to[0]);
  s.collapse([framed.id], true);
  s.pickWire(index);
  expect(s.current().groups.find((g) => g.id === framed.id)!.collapsed).toBe(false);
  expect(s.state.sidebar.picked).toBe(index);
  s.undo();
  expect(s.current().groups.find((g) => g.id === framed.id)!.collapsed).toBe(true);
});

function nestedCollapsed() {
  const s = createSession(SPECS, starterDoc(SPECS));
  const c = s.current().cables.find((x) => !x.from[0].startsWith('g') && !x.to[0].startsWith('g'))!;
  const g = frameSelection(s.current(), SPECS, [c.from[0], c.to[0]]);
  s.commit(g.doc);
  const p = frameSelection(s.current(), SPECS, [g.id]);
  s.commit(p.doc);
  const index = s.current().cables.findIndex((x) => x.from[0] === c.from[0] && x.to[0] === c.to[0]);
  s.collapse([g.id, p.id], true);
  return { s, g, p, index };
}

test('picking a wire inside nested collapsed frames expands them all, in one undo step', () => {
  const { s, g, p, index } = nestedCollapsed();
  const collapsed = (id: string) => s.current().groups.find((x) => x.id === id)!.collapsed;
  expect(hiddenIn(s.current(), s.current().cables[index]!)).toBe(p.id);
  s.pickWire(index);
  expect(hiddenIn(s.current(), s.current().cables[index]!)).toBeNull();
  expect(collapsed(g.id)).toBe(false);
  expect(collapsed(p.id)).toBe(false);
  s.undo();
  expect(collapsed(g.id)).toBe(true);
  expect(collapsed(p.id)).toBe(true);
});

test('pickRow only picks: a collapsed frame stays collapsed', () => {
  const { s, p, index } = nestedCollapsed();
  s.pickRow(index);
  expect(s.state.sidebar.picked).toBe(index);
  expect(s.current().groups.find((x) => x.id === p.id)!.collapsed).toBe(true);
});

test('the master fader is one undo step per stroke, posts a master message, and again after an undo', () => {
  const s = createSession(SPECS, starterDoc(SPECS));
  const { sent, asHost } = fakeHost();
  s.attach(asHost);
  sent.length = 0;
  const before = s.current().master;
  s.setMaster(0.5, { key: 'm1', stroke: true });
  s.setMaster(0.3, { key: 'm1', stroke: true });
  expect(s.current().master).toBe(0.3);
  expect(sent.filter((m) => m.t === 'master')).toEqual([
    { t: 'master', value: 0.5 },
    { t: 'master', value: 0.3 },
  ]);
  sent.length = 0;
  s.undo();
  expect(s.current().master).toBe(before);
  expect(sent).toContainEqual({ t: 'master', value: before });
  s.redo();
  expect(s.current().master).toBe(0.3);
});

test('the drawer closes when its module goes', async () => {
  const { addModule, deleteObjects, emptyDoc } = await import('@sreda/core');
  const s = createSession(SPECS, emptyDoc);
  expect(s.state.seq).toEqual({ id: null, h: 300 });
  s.commit(addModule(emptyDoc, SPECS, 'metaseq', 0, 0).doc);
  s.openSeq('m1');
  expect(s.state.seq.id).toBe('m1');
  // deleted
  s.commit(deleteObjects(s.current(), ['m1']));
  expect(s.state.seq.id).toBeNull();
  // ⌘Z brings it back; open it, then ⌘Z its creation
  s.undo();
  s.openSeq('m1');
  expect(s.state.seq.id).toBe('m1');
  s.undo();
  expect(s.current().modules).toHaveLength(0);
  expect(s.state.seq.id).toBeNull();
  // closeSeq
  s.redo();
  s.openSeq('m1');
  s.closeSeq();
  expect(s.state.seq.id).toBeNull();
});

test('a write-back without an undo step (MUTATE) keeps a stroke in the drawer one undo step', () => {
  const s = createSession(SPECS, emptyDoc);
  s.commit(addModule(emptyDoc, SPECS, 'metaseq', 0, 0).doc);
  const before = s.current();
  s.params('m1', { an1: 14 / 24 }, { key: 'm1:n', stroke: true });
  s.params('m1', { aa5: 1 }, undefined, false);
  s.params('m1', { an2: 15 / 24 }, { key: 'm1:n', stroke: true });
  const p = s.current().modules[0]!.params;
  expect([p['an1'], p['aa5'], p['an2']]).toEqual([14 / 24, 1, 15 / 24]);
  s.undo();
  expect(s.current()).toEqual(before);
});

test('the drawer closes when a replaced document makes its module something else, and with every opened project', () => {
  const s = createSession(SPECS, emptyDoc);
  s.commit(addModule(emptyDoc, SPECS, 'metaseq', 0, 0).doc);
  s.openSeq('m1');
  // a project whose m1 is an OSC
  s.openProject(addModule(emptyDoc, SPECS, 'osc', 0, 0).doc, { path: 'osc', factory: false });
  expect(s.current().modules[0]).toMatchObject({ id: 'm1', type: 'osc' });
  expect(s.state.seq.id).toBeNull();
  // the same through a commit (a DICE patch, an undo): the id stays, the type changes
  s.undo();
  s.openSeq('m1');
  s.commit(addModule(emptyDoc, SPECS, 'osc', 0, 0).doc);
  expect(s.state.seq.id).toBeNull();
  // a project whose m1 is another META-SEQ: the drawer closes too
  s.commit(addModule(emptyDoc, SPECS, 'metaseq', 0, 0).doc);
  s.openSeq('m1');
  s.openProject(addModule(emptyDoc, SPECS, 'metaseq', 0, 0).doc, { path: 'seq', factory: false });
  expect(s.state.seq.id).toBeNull();
});

/** A session with a fake Web MIDI and a host whose event ring replays what the test queues. */
function midiSession(doc: ReturnType<typeof starterDoc>) {
  const access = new FakeAccess();
  const request = vi.fn(() => Promise.resolve(access.asAccess()));
  vi.stubGlobal('navigator', { requestMIDIAccess: request });
  const s = createSession(SPECS, doc);
  const f = fakeHost();
  const queue: [number, number, number, number][] = [];
  (f.host as { events: unknown }).events = {
    read: (visit: (frame: number, seq16: number, node: number, midi: number) => void) => {
      for (const e of queue.splice(0)) visit(...e);
      return 0;
    },
    dropped: () => 0,
  };
  return { s, access, request, queue, ...f };
}
const NOTE_ON = 0x90 | (60 << 8) | (100 << 16);
const settle = () => new Promise((r) => setTimeout(r, 30));
afterEach(() => vi.unstubAllGlobals());

test('MIDI is requested only once a sent plan has an A4', async () => {
  const { s, request, asHost } = midiSession(starterDoc(SPECS));
  s.attach(asHost);
  expect(request).not.toHaveBeenCalled();
  const { addModule } = await import('@sreda/core');
  s.edit((d) => addModule(d, SPECS, 'a4', 0, 400).doc);
  expect(request).toHaveBeenCalledTimes(1);
  (asHost as unknown as { onClose?: () => void }).onClose?.();
  s.midi.devices.dispose();
});

test('an A4 note reaches the port; deleting the module (an applied plan without it) sends its note-off', async () => {
  const { addModule } = await import('@sreda/core');
  const added = addModule(starterDoc(SPECS), SPECS, 'a4', 0, 400);
  const { s, access, queue, host, asHost } = midiSession(added.doc);
  const out = access.plug('Analog Four MKII');
  s.attach(asHost);
  await settle();
  const node = added.doc.modules.findIndex((m) => m.id === added.id);
  queue.push([0, 1, node, NOTE_ON]);
  await settle();
  expect(out.sent.map((e) => e.bytes)).toContainEqual([0x90, 60, 100]);
  s.edit((d) => ({ ...d, modules: d.modules.filter((m) => m.id !== added.id) }));
  host.onMessage?.({ t: 'applied', seq: 2, code: 0 });
  expect(out.sent.map((e) => e.bytes)).toContainEqual([0x80, 60, 0]);
  host.onClose?.();
});

test('muting the frame of an A4 releases its note; the pump drops its note-ons while muted', async () => {
  const { addModule, frameSelection } = await import('@sreda/core');
  const added = addModule(starterDoc(SPECS), SPECS, 'a4', 0, 400);
  const framed = frameSelection(added.doc, SPECS, [added.id]);
  const { s, access, queue, host, asHost } = midiSession(framed.doc);
  const out = access.plug('Analog Four MKII');
  s.attach(asHost);
  await settle();
  const node = framed.doc.modules.findIndex((m) => m.id === added.id);
  queue.push([0, 1, node, NOTE_ON]);
  await settle();
  s.frame(framed.id, { muted: true }, undefined);
  expect(out.sent.map((e) => e.bytes)).toContainEqual([0x80, 60, 0]);
  const before = out.sent.length;
  queue.push([0, 1, node, NOTE_ON]);
  await settle();
  expect(out.sent.length).toBe(before);
  host.onClose?.();
});

test('muting a frame by undo or redo releases its A4 note at once', async () => {
  const { addModule, frameSelection } = await import('@sreda/core');
  const added = addModule(starterDoc(SPECS), SPECS, 'a4', 0, 400);
  const framed = frameSelection(added.doc, SPECS, [added.id]);
  const { s, access, queue, host, asHost } = midiSession(framed.doc);
  const out = access.plug('Analog Four MKII');
  s.attach(asHost);
  await settle();
  s.frame(framed.id, { muted: true }, undefined);
  s.undo(); // unmuted again
  const node = framed.doc.modules.findIndex((m) => m.id === added.id);
  queue.push([0, 1, node, NOTE_ON]);
  await settle();
  expect(out.sent.map((e) => e.bytes)).toContainEqual([0x90, 60, 100]);
  const before = out.sent.length;
  s.redo(); // muted by redo
  expect(out.sent.slice(before).map((e) => e.bytes)).toContainEqual([0x80, 60, 0]);
  host.onClose?.();
});

test('an event from a non-MIDI node of the plan is dropped', async () => {
  const { addModule } = await import('@sreda/core');
  const added = addModule(starterDoc(SPECS), SPECS, 'a4', 0, 400);
  const { s, access, queue, host, asHost } = midiSession(added.doc);
  const out = access.plug('Analog Four MKII');
  s.attach(asHost);
  await settle();
  queue.push([0, 1, 0, NOTE_ON]); // node 0 is the OSC
  await settle();
  expect(out.sent).toEqual([]);
  host.onClose?.();
});

test('a release never overtakes a note-on the OS still holds: its timestamp follows the last scheduled one', async () => {
  const { addModule } = await import('@sreda/core');
  const added = addModule(starterDoc(SPECS), SPECS, 'a4', 0, 400);
  const { s, access, queue, host, asHost } = midiSession(added.doc);
  // the speaker is 40 ms ahead: the pump schedules the note-on that far in the future
  (host as { outputTimestamp: unknown }).outputTimestamp = () => ({
    contextTime: 0,
    performanceTime: performance.now() + 40,
  });
  const out = access.plug('Analog Four MKII');
  s.attach(asHost);
  await settle();
  const node = added.doc.modules.findIndex((m) => m.id === added.id);
  queue.push([0, 1, node, NOTE_ON]);
  await settle();
  s.edit((d) => ({ ...d, modules: d.modules.filter((m) => m.id !== added.id) }));
  host.onMessage?.({ t: 'applied', seq: 2, code: 0 });
  const on = out.sent.find((e) => e.bytes[0] === 0x90)!;
  const off = out.sent.find((e) => e.bytes[0] === 0x80)!;
  expect(off.time!).toBeGreaterThan(on.time!);
  // All Notes Off on close follows the same rule
  host.onClose?.();
  const panic = out.sent.filter((e) => e.bytes[1] === 123);
  expect(panic.length).toBe(4);
  for (const p of panic) expect(p.time!).toBeGreaterThan(on.time!);
});
