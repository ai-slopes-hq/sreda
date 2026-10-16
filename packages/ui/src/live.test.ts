// @vitest-environment happy-dom
import { expect, test, vi } from 'vitest';
import { frame, register, setLayoutSeq, setSource } from './live';

test("a watch fires on a rising count read under its own plan's layout only", () => {
  const buf = new Float32Array(8);
  setSource(buf);
  setLayoutSeq(5);
  const fired = vi.fn();
  const el = document.createElement('div');
  const off = register(el, 'watch', 3, fired);
  // the engine still plays plan 4: its buffer has other things at index 3 — ignored
  buf[0] = 4;
  buf[3] = 17;
  frame(0);
  buf[3] = 40;
  frame(16);
  expect(fired).not.toHaveBeenCalled();
  // plan 5 now: the first value is a baseline, a rise fires once, a reset to 0 does not
  buf[0] = 5;
  buf[3] = 2;
  frame(32);
  expect(fired).not.toHaveBeenCalled();
  buf[3] = 3;
  frame(48);
  expect(fired).toHaveBeenCalledTimes(1);
  buf[3] = 0;
  frame(64);
  expect(fired).toHaveBeenCalledTimes(1);
  off();
});

test('a meterDb bar is the peak in dB over a 48 dB range, as a width in %', () => {
  const buf = new Float32Array(4);
  setSource(buf);
  setLayoutSeq(1);
  buf[0] = 1;
  // a fresh bar per reading: a held peak would still be falling
  const width = (peak: number): number => {
    const el = document.createElement('div');
    const off = register(el, 'meterDb', 2);
    buf[2] = peak;
    frame(0);
    off();
    return parseFloat(el.style.width);
  };
  expect(width(1)).toBeCloseTo(100, 5);
  expect(width(0.0039811)).toBeCloseTo(0, 2);
  expect(Math.abs(width(0.25) - 75)).toBeLessThan(0.5);
  expect(width(0)).toBe(0);
  expect(width(NaN)).toBe(0);
  expect(width(Infinity)).toBe(0);
});
