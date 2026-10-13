import { expect, test } from 'vitest';
import { NoteLedger } from './ledger';

function make() {
  const out: number[][] = [];
  return { out, ledger: new NoteLedger((b) => out.push(b)) };
}

test('release sends note-offs for sounding notes only', () => {
  const { out, ledger } = make();
  ledger.sent('a', [0x90, 60, 100]);
  ledger.sent('a', [0x91, 64, 100]);
  ledger.sent('a', [0x81, 64, 0]); // note 64 already off
  ledger.sent('b', [0x90, 60, 100]); // same channel and note, another node
  ledger.release('a');
  expect(out).toEqual([[0x80, 60, 0]]);
  ledger.release('a');
  expect(out).toHaveLength(1);
  ledger.release('b');
  expect(out).toEqual([[0x80, 60, 0], [0x80, 60, 0]]);
});

test('keepOnly releases nodes that left', () => {
  const { out, ledger } = make();
  ledger.sent('a', [0x90, 60, 100]);
  ledger.sent('b', [0x92, 61, 100]);
  ledger.keepOnly(new Set(['b']));
  expect(out).toEqual([[0x80, 60, 0]]);
});

test('releaseAll with panic adds CC 123 on channels 1-4', () => {
  const { out, ledger } = make();
  ledger.sent('a', [0x90, 60, 100]);
  ledger.releaseAll(false);
  expect(out).toEqual([[0x80, 60, 0]]);
  out.length = 0;
  ledger.sent('a', [0x93, 62, 100]);
  ledger.releaseAll(true);
  expect(out).toEqual([[0x83, 62, 0], [0xb0, 123, 0], [0xb1, 123, 0], [0xb2, 123, 0], [0xb3, 123, 0]]);
});

test('a running clock gets Stop on release', () => {
  const { out, ledger } = make();
  ledger.sent('a', [0xfa]);
  ledger.sent('b', [0xfa]);
  ledger.sent('b', [0xfc]);
  ledger.release('b');
  expect(out).toEqual([]);
  ledger.release('a');
  expect(out).toEqual([[0xfc]]);
  out.length = 0;
  ledger.sent('a', [0xfa]);
  ledger.releaseAll(false);
  expect(out).toEqual([[0xfc]]);
});

test('forget sends nothing', () => {
  const { out, ledger } = make();
  ledger.sent('a', [0x90, 60, 100]);
  ledger.sent('a', [0xfa]);
  ledger.forget();
  ledger.releaseAll(false);
  expect(out).toEqual([]);
});
