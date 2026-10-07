import { expect, test } from 'vitest';
import { euclid, genNotes, mulberry32, SCALES, type Algo } from './generators';

const ALGOS: Algo[] = ['303', 'MOTIF', 'WALK', 'TURING', 'ARP', 'PHRASE', 'PEDAL'];

test('euclid spreads hits evenly, rotated', () => {
  const str = (b: boolean[]) => b.map((x) => (x ? 'x' : '.')).join('');
  expect(str(euclid(16, 5, 0))).toBe('x...x..x..x..x..');
  expect(str(euclid(8, 3, 1))).toBe('.x..x..x');
  expect(str(euclid(4, 0, 0))).toBe('....');
  expect(str(euclid(4, 9, 0))).toBe('xxxx');
});

test('every algorithm gives 16 notes in 0…24, in the scale from the root', () => {
  for (const algo of ALGOS)
    for (const [scale, root] of [
      [SCALES[2]!, 9],
      [SCALES[1]!, 0],
      [SCALES[5]!, 4],
    ] as const) {
      const line = genNotes(algo, 16, scale, root, mulberry32(11));
      expect(line, algo).toHaveLength(16);
      for (const s of line) {
        expect(s >= 0 && s <= 24, `${algo}: ${s}`).toBe(true);
        expect(scale.includes((((s - root) % 12) + 12) % 12), `${algo}: ${s} not in the scale`).toBe(true);
      }
    }
});

test('the same seed gives the same line', () => {
  expect(genNotes('WALK', 16, SCALES[2]!, 0, mulberry32(3))).toEqual(
    genNotes('WALK', 16, SCALES[2]!, 0, mulberry32(3)),
  );
  expect(mulberry32(1)()).toBeCloseTo(2693262067 / 4294967296, 12); // the same sequence as the engine's Rng
});
