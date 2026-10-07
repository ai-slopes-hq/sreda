// @vitest-environment happy-dom
import { SPECS, starterDoc } from '@sreda/core';
import type { FromEngine, ToEngine } from '@sreda/protocol';
import { expect, test } from 'vitest';
import type { AudioHost } from './audio/host';
import { createSession } from './store';

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
  host.onMessage?.({ t: 'applied', seq: plan!.t === 'plan' ? plan!.plan.seq : 0, code: 2 });
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
