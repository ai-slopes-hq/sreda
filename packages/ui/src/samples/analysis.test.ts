import { afterEach, describe, expect, it } from 'vitest';
import { analyse, parseAiffOff, setWorkerFactory } from './analysis';
import { onsets } from './onsets';
import { peaksOf } from './peaks';

const rate = 48_000;
function clicks(): Float32Array[] {
  const x = new Float32Array(rate * 2);
  for (const t of [0.2, 0.7, 1.2, 1.7])
    for (let i = 0; i < 400; i++) x[Math.floor(t * rate) + i] = Math.exp(-i / 80);
  return [x, x.slice()];
}

afterEach(() => setWorkerFactory(() => null));

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
});
