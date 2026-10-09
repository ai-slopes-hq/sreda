// @vitest-environment happy-dom
import { emptyDoc, type Doc } from '@sreda/core';
import type { ToEngine } from '@sreda/protocol';
import { expect, test, vi } from 'vitest';
import { createSampleRegistry, SampleError, type DecodedSample } from './samples';

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
    throw new SampleError('CANNOT BE DECODED');
  });
  fail.r.loadDoc(doc('drums/broken.wav'));
  const empty = setup(async () => decoded(1, 0));
  empty.r.loadDoc(doc('empty.wav'));
  const long = setup(async () => decoded(1, 11 * 60 * 48_000));
  long.r.loadDoc(doc('long.wav'));
  await flush();
  expect(fail.notices).toEqual(['BROKEN.WAV — CANNOT BE DECODED']);
  expect(empty.notices).toEqual(['EMPTY.WAV — NO AUDIO IN IT']);
  expect(long.notices).toEqual(['LONG.WAV — LONGER THAN 10 MINUTES']);
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
