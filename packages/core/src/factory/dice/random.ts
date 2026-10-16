// Seeded helpers over a `Rand` (core never calls Math.random: the same seed gives the same patch).
import type { Rand } from './types';

export const between = (R: Rand, a: number, b: number): number => a + (b - a) * R();
/** log-uniform between a and b */
export const logBetween = (R: Rand, a: number, b: number): number => a * (b / a) ** R();
export const pick = <T>(R: Rand, xs: readonly T[]): T => xs[Math.floor(R() * xs.length)]!;
export const chance = (R: Rand, p: number): boolean => R() < p;
/** an integer in a…b, both inclusive */
export const intIn = (R: Rand, a: number, b: number): number => a + Math.floor(R() * (b - a + 1));
export function weighted<T>(R: Rand, xs: readonly [T, number][]): T {
  let total = 0;
  for (const [, w] of xs) total += w;
  let t = R() * total;
  for (const [x, w] of xs) {
    t -= w;
    if (t < 0) return x;
  }
  return xs[xs.length - 1]![0];
}
