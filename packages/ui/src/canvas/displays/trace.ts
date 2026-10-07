import { TRACE_LEN } from '@sreda/core';

/** The paths for one trace (TRACE_LEN floats from `at`): bands and centre lines, or B against A in XY mode. */
export function tracePaths(
  buf: Float32Array,
  at: number,
  w: number,
  h: number,
  xy: boolean,
): Record<'bandA' | 'bandB' | 'lineA' | 'lineB', string> {
  const cols = TRACE_LEN / 4;
  const y = (v: number) => (h / 2 - Math.max(-1.2, Math.min(1.2, v)) * (h / 2 - 3)).toFixed(1);
  const x = (c: number) => ((c / (cols - 1)) * w).toFixed(1);
  const v = (k: number, c: number) => buf[at + k * cols + c] ?? 0;
  if (xy) {
    let line = '';
    for (let c = 0; c < cols; c++)
      line += `${c ? 'L' : 'M'}${((v(0, c) + 1) * 0.5 * w).toFixed(1)} ${y(v(2, c))}`;
    return { bandA: '', bandB: '', lineA: line, lineB: '' };
  }
  const band = (lo: number, hi: number) => {
    let top = '';
    let bottom = '';
    for (let c = 0; c < cols; c++) top += `${c ? 'L' : 'M'}${x(c)} ${y(v(hi, c))}`;
    for (let c = cols - 1; c >= 0; c--) bottom += `L${x(c)} ${y(v(lo, c))}`;
    return top + bottom + 'Z';
  };
  const line = (lo: number, hi: number) => {
    let d = '';
    for (let c = 0; c < cols; c++) d += `${c ? 'L' : 'M'}${x(c)} ${y((v(lo, c) + v(hi, c)) / 2)}`;
    return d;
  };
  return { bandA: band(0, 1), bandB: band(2, 3), lineA: line(0, 1), lineB: line(2, 3) };
}
