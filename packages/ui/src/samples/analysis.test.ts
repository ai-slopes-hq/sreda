import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  analyse,
  analyseChannels,
  parseAiffOff,
  resetWorkerLost,
  setWorkerFactory,
  WORKER_TIMEOUT_MS,
  WorkerLost,
} from './analysis';
import { onsets } from './onsets';
import { peaksOf } from './peaks';

const rate = 48_000;
function clicks(): Float32Array[] {
  const x = new Float32Array(rate * 2);
  for (const t of [0.2, 0.7, 1.2, 1.7])
    for (let i = 0; i < 400; i++) x[Math.floor(t * rate) + i] = Math.exp(-i / 80);
  return [x, x.slice()];
}

afterEach(() => {
  setWorkerFactory(() => null);
  resetWorkerLost();
  vi.useRealTimers();
});

describe('analyse', () => {
  it('with no Worker gives onsets() and peaksOf() exactly', async () => {
    setWorkerFactory(() => null);
    const ch = clicks();
    const want = { hits: onsets(ch, rate), peaks: peaksOf(ch) };
    expect(want.hits.length).toBeGreaterThan(0);
    expect(await analyse(ch, rate)).toEqual(want);
  });

  it('a worker that throws gives the same', async () => {
    const ch = clicks();
    const want = { hits: onsets(ch, rate), peaks: peaksOf(ch) };
    setWorkerFactory(() => {
      const w = {
        onmessage: null as unknown,
        onerror: null as null | (() => void),
        postMessage() {
          queueMicrotask(() => w.onerror?.());
        },
        terminate() {},
      };
      return w as unknown as Worker;
    });
    expect(await analyse(ch, rate)).toEqual(want);
  });

  it('a worker factory that throws gives the same', async () => {
    const ch = clicks();
    setWorkerFactory(() => {
      throw new Error('no');
    });
    expect(await analyse(ch, rate)).toEqual({ hits: onsets(ch, rate), peaks: peaksOf(ch) });
  });

  it('parseAiffOff without a worker throws on a bad file like parseAiff', async () => {
    await expect(parseAiffOff(new ArrayBuffer(4))).rejects.toThrow();
  });

  it('a worker that never answers is given up on after the timeout and the work runs in place', async () => {
    vi.useFakeTimers();
    const ch = clicks();
    const want = { hits: onsets(ch, rate), peaks: peaksOf(ch) };
    let ended = false;
    setWorkerFactory(
      () =>
        ({
          onmessage: null,
          postMessage() {},
          terminate: () => (ended = true),
        }) as unknown as Worker,
    );
    const p = analyse(ch, rate);
    await vi.advanceTimersByTimeAsync(WORKER_TIMEOUT_MS + 1);
    expect(await p).toEqual(want);
    expect(ended).toBe(true);
  });

  it('an unreadable reply (onmessageerror) falls back', async () => {
    const ch = clicks();
    const want = { hits: onsets(ch, rate), peaks: peaksOf(ch) };
    setWorkerFactory(() => {
      const w = {
        onmessage: null as unknown,
        onerror: null as unknown,
        onmessageerror: null as null | (() => void),
        postMessage() {
          queueMicrotask(() => w.onmessageerror?.());
        },
        terminate() {},
      };
      return w as unknown as Worker;
    });
    expect(await analyse(ch, rate)).toEqual(want);
  });

  it('a worker that fails after taking the channels (detached) throws WorkerLost, then stays out of use', async () => {
    const ch = clicks();
    setWorkerFactory(() => {
      const w = {
        onmessage: null as unknown,
        onerror: null as null | (() => void),
        postMessage(_m: unknown, transfer: ArrayBuffer[]) {
          for (const b of transfer) structuredClone(b, { transfer: [b] });
          queueMicrotask(() => w.onerror?.());
        },
        terminate() {},
      };
      return w as unknown as Worker;
    });
    await expect(analyseChannels(ch, rate)).rejects.toBeInstanceOf(WorkerLost);
    const again = clicks();
    expect((await analyseChannels(again, rate)).hits).toEqual(onsets(clicks(), rate));
  });
});
