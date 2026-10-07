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
