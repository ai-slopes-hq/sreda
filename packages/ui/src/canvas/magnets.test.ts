import { expect, test } from 'vitest';
import { magnet } from './magnets';

const other = { x: 0, y: 0, w: 168, h: 144 };

test('a box 6 px right of a module snaps flush to its right edge, with a guide there', () => {
  const m = magnet({ x: 174, y: 0, w: 168, h: 144 }, [other], 10);
  expect(m.dx).toBe(-6);
  expect(m.gx).toMatchObject({ x: 168 });
});

test('12 px away does not snap at a threshold of 10', () => {
  const m = magnet({ x: 180, y: 300, w: 168, h: 144 }, [other], 10);
  expect(m.dx).toBe(0);
  expect(m.gx).toBeNull();
});

test('tops align', () => {
  const m = magnet({ x: 168, y: 7, w: 168, h: 144 }, [other], 10);
  expect(m.dy).toBe(-7);
  expect(m.gy).toMatchObject({ y: 0 });
});
