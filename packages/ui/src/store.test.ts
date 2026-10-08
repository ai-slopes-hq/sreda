// @vitest-environment happy-dom
import { SPECS, starterDoc, type Plan } from '@sreda/core';
import type { FromEngine, ToEngine } from '@sreda/protocol';
import { expect, test } from 'vitest';
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
  let doc = addModule(emptyDoc, SPECS, 'stages', 0, 0).doc;
  doc = addModule(doc, SPECS, 'slope', 0, 400).doc;
  const s = createSession(SPECS, doc);
  const { sent, asHost } = fakeHost();
  s.attach(asHost);
  sent.length = 0;
  // v3 is a hidden knob of STAGES (−1…1): a fixed message in real units at its index among the fixed values
  s.params('m1', { v3: 0.75 }, undefined);
  expect(sent).toEqual([{ t: 'fixed', node: 0, index: 2, value: 0.5 }]);
  sent.length = 0;
  s.params('m1', { length: 0.5 }, undefined);
  expect(sent).toEqual([{ t: 'knob', node: 0, index: 0, value: 0.5 }]);
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
  s.commit(moveObjects(s.current(), SPECS, ['m2'], g.x + 40 - s.current().modules[1]!.x, g.y + 60 - s.current().modules[1]!.y));
  expect(s.current().modules[1]!.parent).toBe(g.id);
  expect(sent.filter((m) => m.t === 'plan')).toHaveLength(1);
});
