// @vitest-environment happy-dom
import { render } from '@solidjs/testing-library';
import { expect, test } from 'vitest';
import { Grains, grainsPaths } from './Grains';

test('one dot per grain that plays (a negative position is an idle slot); POS is a line', () => {
  const p = grainsPaths(200, 60, { grains: [0.1, -1, 0.5, -1, 0.9], head: -1, live: false, pos: 0.25 });
  expect(p.dots.match(/a2\.5/g)).toHaveLength(2 * 3);
  expect(p.ring).toBe('M50.0 0 V60');
  expect(p.shade).toBe('');
});

test('LIVE shades the region being written, just behind the head', () => {
  const p = grainsPaths(200, 60, { grains: [], head: 0.5, live: true, pos: 1 });
  expect(p.shade).toBe('M86.0 0 H100.0 V60 H86.0 Z');
  // POS 0.75 with the head at 0.5: a quarter of the buffer behind it
  expect(grainsPaths(200, 60, { grains: [], head: 0.5, live: true, pos: 0.75 }).ring).toBe('M50.0 0 V60');
});

test('the tag: the file, or LIVE · 8 s BUFFER (· FROZEN); MISSING when the file is gone', () => {
  const tag = (props: Partial<Parameters<typeof Grains>[0]>) =>
    render(() => (
      <Grains
        x={0}
        y={0}
        w={200}
        h={60}
        pos={0.5}
        live={false}
        frozen={false}
        missing={false}
        peaks={null}
        trace={undefined}
        {...props}
      />
    )).container.querySelector('.sr-dtag')!.textContent;
  expect(tag({ path: 'pads/air.wav' })).toBe('air.wav');
  expect(tag({ live: true, frozen: true })).toBe('LIVE · 8 s BUFFER · FROZEN');
  expect(tag({ path: 'pads/air.wav', missing: true })).toBe('MISSING · air.wav');
  expect(tag({})).toBe('NO SAMPLE · CLICK TO LOAD');
});
