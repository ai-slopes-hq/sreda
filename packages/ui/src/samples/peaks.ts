export const COLUMNS = 512;

/** The largest |x| of each of 512 columns, over the channels. */
export function peaksOf(channels: Float32Array[]): Float32Array {
  const out = new Float32Array(COLUMNS);
  const n = channels[0]?.length ?? 0;
  for (let c = 0; c < COLUMNS; c++) {
    const [a, b] = [
      Math.floor((c * n) / COLUMNS),
      Math.max(Math.floor(((c + 1) * n) / COLUMNS), Math.floor((c * n) / COLUMNS) + 1),
    ];
    let p = 0;
    for (const ch of channels) for (let i = a; i < b && i < n; i++) p = Math.max(p, Math.abs(ch[i]!));
    out[c] = Math.min(1, p);
  }
  return out;
}
