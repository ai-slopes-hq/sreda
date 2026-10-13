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
});

test('a throwing send turns missing and re-scans', async () => {
  const access = new FakeAccess();
  const out = access.plug('Analog Four');
  const d = new MidiDevices(() => Promise.resolve(access.asAccess()));
  d.start();
  await flush();
  out.throwOnSend = true;
  expect(d.send([0x90, 60, 1], 0)).toBe(false);
  // the stale port is still listed, so the re-scan would find it; a later send must not throw out of send()
  expect(() => d.send([0x90, 60, 1], 0)).not.toThrow();
  access.unplug('Analog Four');
  expect(d.status()).toBe('missing');
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
