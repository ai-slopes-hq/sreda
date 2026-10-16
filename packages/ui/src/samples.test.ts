// @vitest-environment happy-dom
import { emptyDoc, type Doc } from '@sreda/core';
import type { ToEngine } from '@sreda/protocol';
import { expect, test, vi } from 'vitest';
import { createSampleRegistry, SampleError, type DecodedSample } from './samples';
import { WorkerLost } from './samples/analysis';

const doc = (...paths: string[]): Doc => ({
  ...emptyDoc,
  modules: paths.map((sample, i) => ({
    id: `m${i + 1}`,
    type: 'osc',
    x: 0,
    y: 0,
    parent: null,
    params: {},
    atts: {},
    ratios: {},
    sample,
  })),
  nextId: paths.length + 1,
});
const decoded = (channels: number, frames: number, rate = 48_000): DecodedSample => ({
  channels: Array.from({ length: channels }, () => new Float32Array(frames)),
  frames,
  rate,
  hits: [{ at: 0, strength: 1 }],
  peaks: new Float32Array(512),
});
const flush = () => new Promise((r) => setTimeout(r, 0));

function setup(decode = async (_b: ArrayBuffer, _n: string, rate: number) => decoded(2, 100, rate)) {
  const read = vi.fn(async (path: string) => {
    if (path.startsWith('gone')) throw new Error('ENOENT');
    return new ArrayBuffer(8);
  });
  const posted: ToEngine[] = [];
  const notices: string[] = [];
  const changed = vi.fn();
  const r = createSampleRegistry({ read, decode, notice: (t) => notices.push(t), changed });
  r.attach((m) => posted.push(m), 48_000);
  return { r, read, posted, notices, changed };
}

test('a doc loads each sample path once; ids are stable per path; ready samples go to the engine', async () => {
  const { r, read, posted } = setup();
  r.loadDoc(doc('kick.wav', 'snare.wav', 'kick.wav'));
  r.loadDoc(doc('kick.wav'));
  await flush();
  expect(read.mock.calls.map((c) => c[0]).sort()).toEqual(['kick.wav', 'snare.wav']);
  expect(r.id('kick.wav')).toBe(r.id('kick.wav'));
  expect(r.id('kick.wav')).not.toBe(r.id('snare.wav'));
  expect(r.status('kick.wav')).toBe('ready');
  expect(r.peaks('kick.wav')).toHaveLength(512);
  expect(posted.map((m) => m.t === 'sample' && m.id).sort()).toEqual(
    [r.id('kick.wav'), r.id('snare.wav')].sort(),
  );
});

test('a sample that cannot be read is missing and nothing is posted', async () => {
  const { r, posted, changed } = setup();
  r.loadDoc(doc('gone/kick.wav'));
  await flush();
  expect(r.status('gone/kick.wav')).toBe('missing');
  expect(r.peaks('gone/kick.wav')).toBeNull();
  expect(posted).toEqual([]);
  expect(changed).toHaveBeenCalled();
});

test('more than two channels: the first two go to the engine', async () => {
  const { r, posted } = setup(async () => decoded(6, 50));
  r.loadDoc(doc('surround.wav'));
  await flush();
  const m = posted[0]!;
  expect(m.t === 'sample' && m.channels.length).toBe(2);
});

test('a sample that will not decode, an empty one and an 11-minute one are refused with notices', async () => {
  const fail = setup(async () => {
    throw new SampleError('Cannot be decoded');
  });
  fail.r.loadDoc(doc('drums/broken.wav'));
  const empty = setup(async () => decoded(1, 0));
  empty.r.loadDoc(doc('empty.wav'));
  const long = setup(async () => decoded(1, 11 * 60 * 48_000));
  long.r.loadDoc(doc('long.wav'));
  await flush();
  expect(fail.notices).toEqual(['broken.wav — cannot be decoded']);
  expect(empty.notices).toEqual(['empty.wav — no audio in it']);
  expect(long.notices).toEqual(['long.wav — longer than 10 minutes']);
  for (const s of [fail, empty, long]) expect(s.posted).toEqual([]);
});

test('samples loaded before the engine attaches are posted when it does, decoded at its rate', async () => {
  const rates: number[] = [];
  const posted: ToEngine[] = [];
  const r = createSampleRegistry({
    read: async () => new ArrayBuffer(8),
    decode: async (_b, _n, rate) => (rates.push(rate), decoded(1, 10, rate)),
    notice: () => {},
    changed: () => {},
  });
  r.loadDoc(doc('kick.wav'));
  await flush();
  r.attach((m) => posted.push(m), 44_100);
  await flush();
  expect(rates).toEqual([48_000, 44_100]);
  expect(posted).toHaveLength(1);
});

test('a missing sample is tried again when asked for again (the file is back)', async () => {
  let there = false;
  const r = createSampleRegistry({
    read: async () => {
      if (!there) throw new Error('ENOENT');
      return new ArrayBuffer(8);
    },
    decode: async (_b, _n, rate) => decoded(1, 10, rate),
    notice: () => {},
    changed: () => {},
  });
  await r.load('kick.wav');
  expect(r.status('kick.wav')).toBe('missing');
  there = true;
  await r.load('kick.wav');
  expect(r.status('kick.wav')).toBe('ready');
});

test('a decode that finishes after the engine attached at another rate decodes again at its rate', async () => {
  let release: () => void = () => {};
  const rates: number[] = [];
  const posted: ToEngine[] = [];
  const r = createSampleRegistry({
    read: async () => new ArrayBuffer(8),
    decode: async (_b, _n, rate) => {
      rates.push(rate);
      if (rates.length === 1) await new Promise<void>((res) => (release = res));
      return decoded(1, 10, rate);
    },
    notice: () => {},
    changed: () => {},
  });
  const p = r.load('pad.wav');
  await flush();
  r.attach((m) => posted.push(m), 44_100);
  release();
  await p;
  expect(rates).toEqual([48_000, 44_100]);
  expect(r.info('pad.wav')!.rate).toBe(44_100);
});

test('audition decodes on the side into slot 0 and keeps nothing; ids of samples start at 1', async () => {
  const { r, posted } = setup();
  await r.audition('kit/hat.wav');
  expect(posted.map((m) => [m.t, 'id' in m ? m.id : null])).toEqual([
    ['sample', 0],
    ['audition', 0],
  ]);
  expect(r.status('kit/hat.wav')).toBeUndefined();
  expect(r.id('kit/kick.wav')).toBeGreaterThan(0);
  await r.audition(null);
  expect(posted.at(-1)).toEqual({ t: 'audition', id: null });
});

test('a path no shown document names for 30 s is unloaded; named again in time it stays', async () => {
  vi.useFakeTimers();
  try {
    const { r, posted } = setup();
    r.loadDoc(doc('kick.wav', 'snare.wav'));
    await vi.advanceTimersByTimeAsync(10);
    const kick = r.id('kick.wav');
    r.loadDoc(doc('snare.wav'));
    await vi.advanceTimersByTimeAsync(20_000);
    r.loadDoc(doc('kick.wav', 'snare.wav')); // back in time
    await vi.advanceTimersByTimeAsync(20_000);
    expect(r.status('kick.wav')).toBe('ready');
    r.loadDoc(doc('snare.wav'));
    await vi.advanceTimersByTimeAsync(29_000);
    expect(r.status('kick.wav')).toBe('ready');
    await vi.advanceTimersByTimeAsync(2_000);
    expect(r.status('kick.wav')).toBeUndefined();
    expect(r.peaks('kick.wav')).toBeNull();
    expect(r.status('snare.wav')).toBe('ready');
    expect(posted.filter((m) => m.t === 'unsample')).toEqual([{ t: 'unsample', id: kick }]);
  } finally {
    vi.useRealTimers();
  }
});

test('a dropped sample asked for again is read again, ready under the same id, and sent anew', async () => {
  vi.useFakeTimers();
  try {
    const { r, read, posted } = setup();
    r.loadDoc(doc('kick.wav'));
    await vi.advanceTimersByTimeAsync(10);
    const id = r.id('kick.wav');
    r.loadDoc(doc());
    await vi.advanceTimersByTimeAsync(31_000);
    expect(r.status('kick.wav')).toBeUndefined();
    r.loadDoc(doc('kick.wav'));
    await vi.advanceTimersByTimeAsync(10);
    expect(read).toHaveBeenCalledTimes(2);
    expect(r.status('kick.wav')).toBe('ready');
    expect(r.id('kick.wav')).toBe(id);
    expect(posted.filter((m) => m.t === 'sample' && m.id === id)).toHaveLength(2);
  } finally {
    vi.useRealTimers();
  }
});

test('a path still loading when its time comes is dropped once it is ready, without another document', async () => {
  vi.useFakeTimers();
  try {
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => (release = r));
    const { r, posted } = setup(async (_b, _n, rate) => {
      await gate;
      return decoded(2, 100, rate);
    });
    r.loadDoc(doc('kick.wav'));
    await vi.advanceTimersByTimeAsync(10);
    r.loadDoc(doc());
    await vi.advanceTimersByTimeAsync(31_000);
    expect(r.status('kick.wav')).toBe('loading');
    release();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(r.status('kick.wav')).toBeUndefined();
    expect(posted.some((m) => m.t === 'unsample')).toBe(true);
  } finally {
    vi.useRealTimers();
  }
});

test('a rate change decoding again while the sample is dropped does not bring it back', async () => {
  vi.useFakeTimers();
  try {
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => (release = r));
    const { r, posted } = setup(async (_b, _n, rate) => {
      if (rate !== 48_000) await gate;
      return decoded(2, 100, rate);
    });
    r.loadDoc(doc('kick.wav'));
    await vi.advanceTimersByTimeAsync(10);
    r.loadDoc(doc());
    await vi.advanceTimersByTimeAsync(29_000);
    r.attach((m) => posted.push(m), 44_100); // decodes again, held
    await vi.advanceTimersByTimeAsync(2_000); // the sweep drops it meanwhile
    expect(r.status('kick.wav')).toBeUndefined();
    posted.length = 0;
    release();
    await vi.advanceTimersByTimeAsync(10);
    expect(r.status('kick.wav')).toBeUndefined();
    expect(posted).toEqual([]);
  } finally {
    vi.useRealTimers();
  }
});

test('one sweep timer; changed() only when something was dropped', async () => {
  vi.useFakeTimers();
  try {
    const { r, changed } = setup();
    r.loadDoc(doc('kick.wav'));
    await vi.advanceTimersByTimeAsync(10);
    r.loadDoc(doc());
    r.loadDoc(doc());
    r.loadDoc(doc());
    expect(vi.getTimerCount()).toBe(1);
    changed.mockClear();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(changed).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(21_000);
    expect(changed).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  } finally {
    vi.useRealTimers();
  }
});

test('a re-decode at a new rate that fails removes the engine copy sent before it', async () => {
  const { r, posted } = setup(async (_b, _n, rate) => {
    if (rate !== 48_000) throw new SampleError('Cannot be decoded');
    return decoded(2, 100, rate);
  });
  await r.load('kick.wav');
  r.attach((m) => posted.push(m), 48_000);
  posted.length = 0;
  r.attach((m) => posted.push(m), 44_100);
  await vi.waitFor(() => expect(r.status('kick.wav')).toBeUndefined());
  expect(posted).toEqual([{ t: 'unsample', id: r.id('kick.wav') }]);
});

test('a decode whose analysis worker was lost is retried once from the kept bytes', async () => {
  let calls = 0;
  const { r, notices } = setup(async (_b, _n, rate) => {
    if (++calls === 1) throw new WorkerLost('gone');
    return decoded(2, 100, rate);
  });
  await r.load('kick.wav');
  expect(calls).toBe(2);
  expect(r.status('kick.wav')).toBe('ready');
  expect(notices).toEqual([]);
});
