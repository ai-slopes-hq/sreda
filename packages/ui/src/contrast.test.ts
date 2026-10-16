import { describe, expect, it } from 'vitest';
import { SKIN_NAMES, SKINS } from './skins';

function luminance(hex: string): number {
  const channel = (i: number): number => {
    const c = parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(0) + 0.7152 * channel(1) + 0.0722 * channel(2);
}

/** WCAG 2 contrast ratio of two `#rrggbb` colours. */
function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

describe('contrast', () => {
  it('measures black on white as 21 : 1', () => {
    expect(contrast('#ffffff', '#000000')).toBeCloseTo(21, 1);
  });

  for (const name of SKIN_NAMES) {
    it(`${name}: labels and hints are readable on panel and popover`, () => {
      const s = SKINS[name];
      expect(contrast(s.label, s.panel)).toBeGreaterThanOrEqual(5);
      expect(contrast(s.label, s.popover)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(s.muted, s.panel)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(s.muted, s.popover)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(s.text, s.popover)).toBeGreaterThanOrEqual(7);
    });
  }

  it("KANAGAWA's faint no longer equals line-2", () => {
    expect(contrast(SKINS.KANAGAWA.faint, SKINS.KANAGAWA['line-2'])).toBeGreaterThan(1.15);
  });

  it('pins the four fixed colours and the DEFAULT popover', () => {
    expect(SKINS.KANAGAWA.faint).toBe('#676678');
    expect(SKINS.NORD.muted).toBe('#bac0cc');
    expect(SKINS['TOKYO NIGHT'].muted).toBe('#8c94bd');
    expect(SKINS.TOUCH.muted).toBe('#a3a3a3');
    expect(SKINS.DEFAULT.popover).toBe('#232320');
  });
});
