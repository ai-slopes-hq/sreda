import { expect, test, vi } from 'vitest';
import { MidiDevices } from './devices';
import { FakeAccess } from './fakes';

const flush = () => new Promise((r) => setTimeout(r, 0));

test('finds the port by name', async () => {
  const access = new FakeAccess();
  access.plug('IAC Driver');
  const out = access.plug('Elektron Analog Four MKII');
  const d = new MidiDevices(() => Promise.resolve(access.asAccess()));
  expect(d.status()).toBe('missing');
  d.start();
  await flush();
  expect(d.status()).toBe('connected');
  expect(d.send([0x90, 60, 100], 12)).toBe(true);
  expect(out.sent).toEqual([{ bytes: [0x90, 60, 100], time: 12 }]);
});

test('goes missing on unplug and back on replug', async () => {
  const access = new FakeAccess();
  access.plug('Analog Four');
  const d = new MidiDevices(() => Promise.resolve(access.asAccess()));
  d.start();
  await flush();
  expect(d.status()).toBe('connected');
  access.unplug('Analog Four');
  expect(d.status()).toBe('missing');
  expect(d.send([0xf8], 0)).toBe(false);
  access.plug('Analog Four');
  expect(d.status()).toBe('connected');
  expect(d.send([0xf8], 0)).toBe(true);
  d.dispose();
});

test('a throwing send turns missing and recovers with All Notes Off', async () => {
  vi.useFakeTimers();
  try {
    const access = new FakeAccess();
    const out = access.plug('Analog Four');
    const d = new MidiDevices(() => Promise.resolve(access.asAccess()));
    d.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(d.status()).toBe('connected');
    out.throwOnSend = true;
    expect(d.send([0x90, 60, 1], 0)).toBe(false);
    expect(d.status()).toBe('missing');
    out.throwOnSend = false;
    vi.advanceTimersByTime(1000);
    expect(d.status()).toBe('connected');
    expect(out.sent.map((e) => e.bytes)).toEqual([[0xb0, 123, 0], [0xb1, 123, 0], [0xb2, 123, 0], [0xb3, 123, 0]]);
    expect(d.send([0x90, 60, 1], 5)).toBe(true);
    d.dispose();
  } finally {
    vi.useRealTimers();
  }
});

test('a disconnected port is ignored', async () => {
  const access = new FakeAccess();
  const out = access.plug('Analog Four');
  out.state = 'disconnected';
  const d = new MidiDevices(() => Promise.resolve(access.asAccess()));
  d.start();
  await flush();
  expect(d.status()).toBe('missing');
  d.dispose();
});

test('a rejected request is unavailable', async () => {
  const d = new MidiDevices(() => Promise.reject(new Error('denied')));
  d.start();
  await flush();
  expect(d.status()).toBe('unavailable');
  expect(d.send([0xf8], 0)).toBe(false);
});

test('start requests MIDI once', async () => {
  const access = new FakeAccess();
  const request = vi.fn(() => Promise.resolve(access.asAccess()));
  const d = new MidiDevices(request);
  d.start();
  d.start();
  await flush();
  d.start();
  expect(request).toHaveBeenCalledTimes(1);
});
