// Pure drawing and text helpers for panels and cables (ported from the prototype).
import type { KnobParam, Role } from '@sreda/core';

export const ROLE: Record<Role, string> = {
  audio: '#e9e4d8',
  mod: '#6cb4ee',
  pitch: '#9ad18b',
  trigger: '#f5a524',
};
const NOTES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

/** Knob angle for a position 0…1 (−135° … +135°), radians. */
export function ang(k: number): number {
  return ((-135 + 270 * k) * Math.PI) / 180;
}

/** An arc of the knob between two positions at radius r, in the knob's 48 × 34 box (centre 24, 17). */
export function arc(k0: number, k1: number, r: number): string {
  if (k1 - k0 < 0.002) return '';
  const a0 = ang(k0);
  const a1 = ang(k1);
  const large = (k1 - k0) * 270 > 180 ? 1 : 0;
  const p = (a: number) => `${(24 + r * Math.sin(a)).toFixed(2)} ${(17 - r * Math.cos(a)).toFixed(2)}`;
  return `M${p(a0)} A${r} ${r} 0 ${large} 1 ${p(a1)}`;
}

/** A waveform drawn in a w × 12 box. */
export function waveGlyph(name: string, w: number): string {
  if (name === 'SIN') {
    let d = '';
    for (let i = 0; i <= 24; i++)
      d += `${i ? 'L' : 'M'}${((i / 24) * w).toFixed(1)} ${(6 - 5 * Math.sin((i / 24) * 2 * Math.PI)).toFixed(1)}`;
    return d;
  }
  if (name === 'TRI') return `M0 6 L${w / 4} 1 L${(3 * w) / 4} 11 L${w} 6`;
  if (name === 'SAW') return `M0 11 L${w / 2} 1 V11 L${w} 1`;
  return `M0 11 V1 H${w / 2} V11 H${w} V1`;
}

/** A knob value as text. */
export function fmt(p: KnobParam, v: number): string {
  if (p.unit === 'hz')
    return v < 1
      ? v.toFixed(2)
      : v < 100
        ? v.toFixed(1)
        : v < 1000
          ? '' + Math.round(v)
          : (v / 1000).toFixed(1) + 'k';
  if (p.unit === 's') return v < 1 ? Math.round(v * 1000) + 'ms' : v.toFixed(2) + 's';
  if (p.unit === 'note') return NOTES[Math.round(v) % 12]!;
  if (p.step) return '' + Math.round(v);
  return (v < 0 ? '−' : '') + Math.abs(v).toFixed(2);
}

export const fmtAtt = (v: number): string => (v < 0 ? '−' : '') + Math.abs(v).toFixed(2);
export const fmtRat = (r: number): string => (r === 1 ? '1' : r < 0 ? '÷' + -r : '×' + r);

/** A cable from an output to an input: a horizontal-tangent bezier. */
export function bez(a: { x: number; y: number }, b: { x: number; y: number }): string {
  const dx = Math.max(40, Math.abs(b.x - a.x) * 0.5);
  return `M${a.x} ${a.y} C${a.x + dx} ${a.y} ${b.x - dx} ${b.y} ${b.x} ${b.y}`;
}
