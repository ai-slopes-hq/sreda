// @vitest-environment happy-dom
import { render } from '@solidjs/testing-library';
import { expect, test } from 'vitest';
import { Room, roomPaths } from './Room';

const base = { size: 0.5, fill: 0.5, damp: 0.4, pre: 0.2 };

test('the room is the TYPE: ROOM a cube, HALL wider than tall, PLATE a flat slab; SIZE scales it', () => {
  const room = roomPaths(216, 58, { ...base, type: 'ROOM' }).box;
  expect(room.w).toBeCloseTo(room.h, 6);
  const hall = roomPaths(216, 58, { ...base, type: 'HALL' }).box;
  expect(hall.w).toBeGreaterThan(hall.h);
  expect(roomPaths(216, 58, { ...base, type: 'PLATE' }).box.h).toBe(6);
  const big = roomPaths(216, 58, { ...base, type: 'ROOM', size: 1 }).box;
  const small = roomPaths(216, 58, { ...base, type: 'ROOM', size: 0 }).box;
  expect(big.w).toBeGreaterThan(small.w);
});

test('the display tags TYPE and DECAY; FREEZE turns it amber', () => {
  const r = render(() => (
    <Room
      x={0}
      y={0}
      w={216}
      h={58}
      type="HALL"
      size={0.6}
      decay={4}
      damp={0.4}
      pre={0.1}
      freeze={true}
      state={undefined}
    />
  ));
  expect(r.container.querySelector('.sr-dtag')?.textContent).toBe('HALL · 4.0 s');
  expect(r.container.querySelector('svg')!.classList.contains('frozen')).toBe(true);
});
