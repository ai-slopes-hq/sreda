import { expect, test } from 'vitest';
import { glideTo } from './glide';

const visible = { x: 0, y: 0, w: 1000, h: 800 };

test('a target already in view needs no glide', () => {
  expect(glideTo({ x: 0, y: 0, z: 1 }, { x: 100, y: 100, w: 200, h: 100 }, visible)).toBeNull();
});

test("otherwise the target's centre lands at the visible centre, zoom unchanged", () => {
  const v = glideTo({ x: 50, y: 20, z: 0.5 }, { x: 3000, y: 2000, w: 200, h: 100 }, visible)!;
  expect(v.z).toBe(0.5);
  // screen = canvas · z + offset
  expect((3000 + 100) * v.z + v.x).toBeCloseTo(500, 6);
  expect((2000 + 50) * v.z + v.y).toBeCloseTo(400, 6);
});
