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
  expect(grainsPaths(200, 60, { grains: [], head: 0.5, live: true, frozen: true, pos: 1 }).shade).toBe('');
  // near the start of the ring the region wraps to its end
  expect(grainsPaths(200, 60, { grains: [], head: 0.02, live: true, pos: 1 }).shade).toBe(
    'M0.0 0 H4.0 V60 H0.0 Z M190.0 0 H200.0 V60 H190.0 Z',
  );
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

test('a click or drag reports POS; LIVE reads relative to the head, as the display draws it', () => {
  const got: [number, string][] = [];
  const r = render(() => (
    <Grains
      x={0}
      y={0}
      w={200}
      h={60}
      pos={0.5}
      live={false}
      frozen={false}
      path="a.wav"
      missing={false}
      peaks={new Float32Array(512)}
      trace={undefined}
      onPos={(p, ph) => got.push([p, ph])}
    />
  ));
  const box = r.container.querySelector('.sr-wave-box') as HTMLElement;
  box.getBoundingClientRect = () => ({ left: 0, width: 200, top: 0, height: 60 }) as DOMRect;
  const ptr = (type: string, clientX: number) =>
    new PointerEvent(type, { clientX, pointerId: 1, button: 0, bubbles: true });
  box.dispatchEvent(ptr('pointerdown', 50));
  box.dispatchEvent(ptr('pointerup', 50));
  box.dispatchEvent(ptr('pointerdown', 20));
  box.dispatchEvent(ptr('pointermove', 100));
  box.dispatchEvent(ptr('pointerup', 100));
  expect(got).toEqual([
    [0.25, 'click'],
    [0.1, 'drag'],
    [0.5, 'drag'],
    [0.5, 'end'],
  ]);
});

test('without a sample a click on GRAINS opens the dialog; LIVE has nothing to load', () => {
  let loads = 0;
  const mk = (live: boolean) => {
    const r = render(() => (
      <Grains
        x={0}
        y={0}
        w={200}
        h={60}
        pos={0.5}
        live={live}
        frozen={false}
        missing={false}
        peaks={null}
        trace={undefined}
        onLoad={() => loads++}
      />
    ));
    const box = r.container.querySelector('.sr-wave-box') as HTMLElement;
    box.getBoundingClientRect = () => ({ left: 0, width: 200, top: 0, height: 60 }) as DOMRect;
    box.dispatchEvent(new PointerEvent('pointerdown', { clientX: 5, pointerId: 1, button: 0, bubbles: true }));
    box.dispatchEvent(new PointerEvent('pointerup', { clientX: 5, pointerId: 1, button: 0, bubbles: true }));
  };
  mk(false);
  expect(loads).toBe(1);
  mk(true);
  expect(loads).toBe(1);
});
