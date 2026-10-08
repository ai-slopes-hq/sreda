// AIFF / AIFC (uncompressed) to floats: Chromium's decodeAudioData does not read AIFF (spec §7a).

/** Big-endian PCM, 8 / 16 / 24 / 32 bits; AIFC with `NONE` (big-endian) or `sowt` (little-endian). Throws otherwise. */
export function parseAiff(bytes: ArrayBuffer): { channels: Float32Array[]; rate: number } {
  const v = new DataView(bytes);
  const tag = (o: number) =>
    String.fromCharCode(v.getUint8(o), v.getUint8(o + 1), v.getUint8(o + 2), v.getUint8(o + 3));
  if (bytes.byteLength < 12 || tag(0) !== 'FORM' || (tag(8) !== 'AIFF' && tag(8) !== 'AIFC'))
    throw new Error('not an AIFF file');
  let comm: { channels: number; frames: number; bits: number; rate: number; little: boolean } | null = null;
  let ssnd = -1;
  for (let o = 12; o + 8 <= bytes.byteLength;) {
    const id = tag(o);
    const size = v.getUint32(o + 4);
    if (id === 'COMM') {
      // 80-bit extended rate: sign + 15-bit exponent, 64-bit mantissa
      const exp = (v.getUint16(o + 16) & 0x7fff) - 16383;
      const mant = v.getUint32(o + 18) * 2 ** 32 + v.getUint32(o + 22);
      const compression = tag(8) === 'AIFC' && size >= 22 ? tag(o + 26) : 'NONE';
      if (compression !== 'NONE' && compression !== 'sowt')
        throw new Error(`compressed AIFF (${compression})`);
      comm = {
        channels: v.getInt16(o + 8),
        frames: v.getUint32(o + 10),
        bits: v.getInt16(o + 14),
        rate: Math.round(mant * 2 ** (exp - 63)),
        little: compression === 'sowt',
      };
    } else if (id === 'SSND') ssnd = o + 16 + v.getUint32(o + 8);
    o += 8 + size + (size % 2);
  }
  if (!comm || ssnd < 0) throw new Error('an AIFF without COMM or SSND');
  const { channels, frames, bits, rate, little } = comm;
  const bytesPer = Math.ceil(bits / 8);
  if (channels < 1 || ![1, 2, 3, 4].includes(bytesPer)) throw new Error(`unsupported AIFF (${bits} bits)`);
  const n = Math.min(frames, Math.floor((bytes.byteLength - ssnd) / (bytesPer * channels)));
  const out = Array.from({ length: channels }, () => new Float32Array(n));
  const scale = 1 / 2 ** (bytesPer * 8 - 1);
  for (let f = 0; f < n; f++) {
    for (let c = 0; c < channels; c++) {
      const o = ssnd + (f * channels + c) * bytesPer;
      let x = 0;
      for (let b = 0; b < bytesPer; b++) x = x * 256 + v.getUint8(little ? o + bytesPer - 1 - b : o + b);
      if (x >= 2 ** (bytesPer * 8 - 1)) x -= 2 ** (bytesPer * 8);
      out[c]![f] = x * scale;
    }
  }
  return { channels: out, rate };
}
