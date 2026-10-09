import { expect, test } from 'vitest';
import { responseGlyph } from './glyphs';

/** the x and y of the curve's highest point (smallest y) */
function peak(d: string): { x: number; y: number } {
  const pts = [...d.matchAll(/[ML](-?[\d.]+) (-?[\d.]+)/g)].map((m) => ({ x: +m[1]!, y: +m[2]! }));
  return pts.reduce((a, p) => (p.y < a.y ? p : a));
}

test('the response glyph puts its resonant peak at the cutoff and raises it with RES', () => {
  for (const model of ['SVF', 'LADDER', 'DIODE', 'SK']) {
    const lo = peak(responseGlyph(model, 30, { cut: 0.25, res: 0.9 }));
    const hi = peak(responseGlyph(model, 30, { cut: 0.75, res: 0.9 }));
    expect(Math.abs(lo.x - 7.5)).toBeLessThanOrEqual(2);
    expect(Math.abs(hi.x - 22.5)).toBeLessThanOrEqual(2);
    const flat = peak(responseGlyph(model, 30, { cut: 0.5, res: 0 }));
    const sharp = peak(responseGlyph(model, 30, { cut: 0.5, res: 0.9 }));
    expect(sharp.y).toBeLessThan(flat.y - 2);
  }
});
