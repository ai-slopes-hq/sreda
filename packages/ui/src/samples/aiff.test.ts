import { expect, test } from 'vitest';
import { parseAiff } from './aiff';

/** a minimal AIFF: COMM + SSND, big-endian PCM */
function aiff(bits: number, channels: number, rate: number, samples: number[]): ArrayBuffer {
  const bytes = bits / 8;
  const frames = samples.length / channels;
  const data = samples.length * bytes;
  const buf = new ArrayBuffer(12 + 26 + 16 + data);
  const v = new DataView(buf);
  const str = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  str(0, 'FORM');
  v.setUint32(4, buf.byteLength - 8);
  str(8, 'AIFF');
  str(12, 'COMM');
  v.setUint32(16, 18);
  v.setInt16(20, channels);
  v.setUint32(22, frames);
  v.setInt16(26, bits);
  // 80-bit extended: rate = mantissa · 2^(exp − 16383 − 63)
  const e = Math.floor(Math.log2(rate));
  v.setUint16(28, 16383 + e);
  v.setUint32(30, Math.round(rate * 2 ** (31 - e)));
  v.setUint32(34, 0);
  str(38, 'SSND');
  v.setUint32(42, 8 + data);
  v.setUint32(46, 0);
  v.setUint32(50, 0);
  samples.forEach((s, i) => {
    const o = 54 + i * bytes;
    const n = Math.round(s * 2 ** (bits - 1));
    if (bits === 16) v.setInt16(o, n);
    else {
      v.setUint8(o, (n >> 16) & 0xff);
      v.setUint8(o + 1, (n >> 8) & 0xff);
      v.setUint8(o + 2, n & 0xff);
    }
  });
  return buf;
}

test('a 16-bit stereo AIFF parses to floats and its rate', () => {
  const r = parseAiff(aiff(16, 2, 44100, [0, 0.5, -0.5, 0.25, 0.75, -1, 0.125, 0]));
  expect(r.rate).toBe(44100);
  expect([...r.channels[0]!]).toEqual([0, -0.5, 0.75, 0.125]);
  expect([...r.channels[1]!]).toEqual([0.5, 0.25, -1, 0]);
});

test('24-bit mono, 48 k', () => {
  const r = parseAiff(aiff(24, 1, 48000, [0.5, -0.25, 0.001953125, -1]));
  expect(r.rate).toBe(48000);
  expect([...r.channels[0]!]).toEqual([0.5, -0.25, 0.001953125, -1]);
});

test('not an AIFF throws', () => {
  expect(() => parseAiff(new ArrayBuffer(16))).toThrow();
});
