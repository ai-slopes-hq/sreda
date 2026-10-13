import { expect, test } from 'vitest';
import { EventRing, RingWriter, ringBytes } from '@sreda/protocol';
import { MidiDevices } from './devices';
import { FakeAccess } from './fakes';
import { NoteLedger } from './ledger';
import { MidiPump, type NodeInfo } from './pump';

const flush = () => new Promise((r) => setTimeout(r, 0));
const word = (b0: number, b1 = 0, b2 = 0) => b0 | (b1 << 8) | (b2 << 16);

async function setup(
  opts: { plug?: boolean; now?: number; resolve?: (seq: number, node: number) => NodeInfo | null } = {},
) {
  const sab = new SharedArrayBuffer(ringBytes());
  const writer = new RingWriter(sab);
  const access = new FakeAccess();
  const out = opts.plug === false ? null : access.plug('Analog Four');
  const devices = new MidiDevices(() => Promise.resolve(access.asAccess()));
  devices.start();
  await flush();
  const sentToLedger: { id: string; bytes: number[] }[] = [];
  const ledgerOut: number[][] = [];
  const ledger = new NoteLedger((b) => ledgerOut.push(b));
  const realSent = ledger.sent.bind(ledger);
  ledger.sent = (id, bytes) => {
    sentToLedger.push({ id, bytes });
    realSent(id, bytes);
  };
  let now = opts.now ?? 0;
  const info: NodeInfo = { id: 'a', offsetMs: 0, muted: false };
  const pump = new MidiPump({
    ring: new EventRing(sab),
    sampleRate: 48000,
    stamp: () => ({ contextTime: 1, performanceTime: 5000 }),
    resolve: opts.resolve ?? (() => info),
    devices,
    ledger,
    now: () => now,
  });
  return {
    writer,
    access,
    out,
    devices,
    ledger,
    pump,
    info,
    sentToLedger,
    ledgerOut,
    setNow: (n: number) => (now = n),
  };
}

test('maps a frame to the speaker time', async () => {
  const s = await setup();
  s.writer.write(48480, 0, word(0x90, 60, 100));
  s.pump.tick();
  expect(s.out!.sent).toEqual([{ bytes: [0x90, 60, 100], time: 5010 }]);
  expect(s.pump.late()).toBe(0);
});

test("adds the node's offset", async () => {
  const s = await setup();
  s.info.offsetMs = 7;
  s.writer.write(48480, 0, word(0xf8));
  s.pump.tick();
  expect(s.out!.sent).toEqual([{ bytes: [0xf8], time: 5017 }]);
});

test('late events keep their order', async () => {
  const s = await setup({ now: 9000 });
  s.writer.write(48000, 0, word(0x90, 60, 100));
  s.writer.write(48100, 0, word(0x80, 60, 0));
  s.writer.write(48200, 0, word(0x90, 62, 100));
  s.pump.tick();
  expect(s.out!.sent.map((e) => [e.bytes[1], e.time])).toEqual([
    [60, 9000],
    [60, 9000],
    [62, 9000],
  ]);
  expect(s.pump.late()).toBe(3);
});

test('drops everything with no port', async () => {
  const s = await setup({ plug: false });
  s.writer.write(48480, 0, word(0x90, 60, 100));
  s.pump.tick();
  expect(s.sentToLedger).toEqual([]);
  // the ring was drained
  expect(s.pump['o'].ring.read(() => {})).toBe(0);
});

test('drops note-ons of a muted node but lets note-offs through', async () => {
  const s = await setup();
  s.info.muted = true;
  s.writer.write(48000, 0, word(0x90, 60, 100));
  s.writer.write(48000, 0, word(0xf8));
  s.writer.write(48000, 0, word(0x80, 60, 0));
  s.pump.tick();
  expect(s.out!.sent.map((e) => e.bytes)).toEqual([[0x80, 60, 0]]);
});

test('events from the previous plan map through their seq', async () => {
  const s = await setup({
    resolve: (seq) =>
      seq === 1
        ? { id: 'old', offsetMs: 0, muted: false }
        : seq === 2
          ? { id: 'new', offsetMs: 0, muted: false }
          : null,
  });
  s.writer.write(48000, (1 << 16) | 3, word(0x90, 60, 100));
  s.writer.write(48000, (2 << 16) | 3, word(0x90, 61, 100));
  s.writer.write(48000, (9 << 16) | 3, word(0x90, 62, 100));
  s.pump.tick();
  expect(s.sentToLedger.map((e) => e.id)).toEqual(['old', 'new']);
  expect(s.out!.sent).toHaveLength(2);
});

test('a throwing send turns missing and keeps draining', async () => {
  const s = await setup();
  s.writer.write(48000, 0, word(0x90, 60, 100));
  s.pump.tick();
  s.out!.throwOnSend = true;
  s.writer.write(48000, 0, word(0x90, 61, 100));
  s.writer.write(48000, 0, word(0x90, 62, 100));
  s.pump.tick();
  expect(s.sentToLedger).toHaveLength(1);
  expect(s.devices.status()).toBe('missing');
  expect(s.pump['o'].ring.read(() => {})).toBe(0);
  // the port went away: the ledger forgot note 60 and sends nothing on release
  s.ledger.releaseAll(false);
  expect(s.ledgerOut).toEqual([]);
  s.devices.dispose();
});

test('an unreadable output clock skips the tick and keeps the events', async () => {
  const s = await setup();
  let ok = false;
  s.pump['o'].stamp = () => {
    if (!ok) throw new Error('no clock');
    return { contextTime: 1, performanceTime: 5000 };
  };
  s.writer.write(48000, 0, word(0x90, 60, 100));
  expect(() => s.pump.tick()).not.toThrow();
  expect(s.sentToLedger).toHaveLength(0);
  ok = true;
  s.pump.tick();
  expect(s.sentToLedger).toHaveLength(1);
  s.devices.dispose();
});

test('OFS turned down mid-note: the note-off never overtakes its note-on', async () => {
  const s = await setup();
  s.info.offsetMs = 50;
  s.writer.write(48480, 0, word(0x90, 60, 100));
  s.pump.tick();
  s.info.offsetMs = 0;
  s.writer.write(48480, 0, word(0x80, 60, 0));
  s.pump.tick();
  const [on, off] = s.out!.sent;
  expect(on!.time).toBe(5060);
  expect(off!.time!).toBeGreaterThanOrEqual(on!.time!);
});
