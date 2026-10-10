import { expect, test } from 'vitest';
import { cells } from './grid';

test('a 7-step lane at ×1: 7 bright cells 100 px wide, then ghosts from x = 700 repeating steps 0…6', () => {
  const c = cells(7, 3, 16, 1600);
  expect(c).toHaveLength(16);
  expect(c.every((x) => x.w === 100)).toBe(true);
  expect(c.slice(0, 7).every((x) => !x.ghost)).toBe(true);
  expect(c.slice(7).every((x) => x.ghost)).toBe(true);
  expect(c[7]!.x).toBe(700);
  expect(c.map((x) => x.step)).toEqual([0, 1, 2, 3, 4, 5, 6, 0, 1, 2, 3, 4, 5, 6, 0, 1]);
  expect(c.map((x) => x.x)).toEqual(Array.from({ length: 16 }, (_, k) => k * 100));
});

test('a 16-step lane at ÷2: 8 cells 200 px wide, all bright', () => {
  const c = cells(16, 2, 16, 1600);
  expect(c).toHaveLength(8);
  expect(c.every((x) => x.w === 200 && !x.ghost)).toBe(true);
  expect(c.map((x) => x.step)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
});

test('a 4-step lane at ×2: 4 bright and 28 ghost cells 50 px wide', () => {
  const c = cells(4, 4, 16, 1600);
  expect(c).toHaveLength(32);
  expect(c.every((x) => x.w === 50)).toBe(true);
  expect(c.filter((x) => !x.ghost)).toHaveLength(4);
  expect(c.filter((x) => x.ghost)).toHaveLength(28);
  expect(c[31]!.x).toBe(1550);
});

test('÷3 and ×3: a cell cut by the window edge is still drawn, clipped to it', () => {
  const slow = cells(16, 1, 16, 1600);
  expect(slow[0]!.w).toBeCloseTo(300);
  expect(slow).toHaveLength(6);
  expect(slow[5]!.x + slow[5]!.w).toBeCloseTo(1600);
  const fast = cells(16, 5, 16, 1600);
  expect(fast.every((x) => x.x < 1600)).toBe(true);
  expect(fast.filter((x) => !x.ghost)).toHaveLength(16);
});
