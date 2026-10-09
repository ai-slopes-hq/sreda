// @vitest-environment happy-dom
import { render } from '@solidjs/testing-library';
import { expect, test } from 'vitest';
import type { Cursor } from './gesture';
import { Wave, wavePaths } from './Wave';

const peaks = Float32Array.from({ length: 512 }, (_, i) => (i % 64) / 64);
const base = { peaks, mode: 0, start: 0.25, len: 0.67, slices: 8, hits: [] as number[] };

test('ONE: START / LEN markers at 0.25 and 0.75 of the width, the outside shaded', () => {
  const p = wavePaths(200, 60, base);
  expect(p.marks).toBe('M50.0 0 V60 M150.5 0 V60');
  expect(p.shade).toContain('M0 0 H50.0');
  expect(p.fill.startsWith('M0 30')).toBe(true);
});

test('SLICE: equal slices of the region, or the hits with AUTO', () => {
  const eq = wavePaths(200, 60, { ...base, mode: 2, start: 0, len: 1, slices: 4 }).marks;
  expect(eq).toBe('M50.0 0 V60 M100.0 0 V60 M150.0 0 V60');
  const auto = wavePaths(200, 60, { ...base, mode: 2, start: 0, len: 1, auto: true, hits: [0.1, 0.6] }).marks;
  expect(auto).toBe('M20.0 0 V60 M120.0 0 V60');
});

test('the tag names the file and the mode; a missing sample says MISSING', () => {
  const r = render(() => (
    <Wave
      x={0}
      y={0}
      w={200}
      h={60}
      {...base}
      start={0}
      len={1}
      mode={2}
      auto
      hits={[0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7]}
      path="breaks/amen.wav"
      missing={false}
      state={undefined}
    />
  ));
  expect(r.container.querySelector('.sr-dtag')!.textContent).toBe('amen.wav · 8 SLICES · AUTO');
  const m = render(() => (
    <Wave x={0} y={0} w={200} h={60} {...base} peaks={null} path="drums/kick.wav" missing state={undefined} />
  ));
  expect(m.container.querySelector('.sr-dtag')!.textContent).toBe('MISSING · kick.wav');
  const none = render(() => (
    <Wave x={0} y={0} w={200} h={60} {...base} peaks={null} missing={false} state={undefined} />
  ));
  expect(none.container.querySelector('.sr-dtag')!.textContent).toBe('NO SAMPLE · CLICK TO LOAD');
});

function cursorWave(events: Cursor[], extra: Partial<Parameters<typeof Wave>[0]> = {}) {
  const r = render(() => (
    <Wave
      x={0}
      y={0}
      w={200}
      h={60}
      {...base}
      path="a.wav"
      missing={false}
      state={undefined}
      onCursor={(c) => events.push(c)}
      {...extra}
    />
  ));
  const box = r.container.querySelector('.sr-wave-box') as HTMLElement;
  box.getBoundingClientRect = () => ({ left: 100, width: 200, top: 0, height: 60 }) as DOMRect;
  return box;
}
const ptr = (type: string, clientX: number, pointerId = 1) =>
  new PointerEvent(type, { clientX, pointerId, button: 0, bubbles: true });

test('a click at 25 % of the width is a click cursor at 0.25', () => {
  const events: Cursor[] = [];
  const box = cursorWave(events);
  box.dispatchEvent(ptr('pointerdown', 150));
  box.dispatchEvent(ptr('pointerup', 151));
  expect(events).toEqual([{ phase: 'click', t: 0.255 }]);
  events.length = 0;
  box.dispatchEvent(ptr('pointerdown', 150));
  box.dispatchEvent(ptr('pointerup', 150));
  expect(events).toEqual([{ phase: 'click', t: 0.25 }]);
});

test('a drag sends every move (the first at the press point) and one end at the release', () => {
  const events: Cursor[] = [];
  const box = cursorWave(events);
  box.dispatchEvent(ptr('pointerdown', 120));
  box.dispatchEvent(ptr('pointermove', 121)); // under 3 px: still a click
  expect(events).toEqual([]);
  box.dispatchEvent(ptr('pointermove', 150));
  box.dispatchEvent(ptr('pointermove', 200));
  box.dispatchEvent(ptr('pointerup', 220));
  expect(events.map((e) => e.phase)).toEqual(['drag', 'drag', 'drag', 'end']);
  expect(events.map((e) => e.t)).toEqual([0.1, 0.25, 0.5, 0.6]);
});

test('pointercancel and lostpointercapture end the scrub once', () => {
  for (const type of ['pointercancel', 'lostpointercapture']) {
    const events: Cursor[] = [];
    const box = cursorWave(events);
    box.dispatchEvent(ptr('pointerdown', 120));
    box.dispatchEvent(ptr('pointermove', 160));
    box.dispatchEvent(ptr(type, 160));
    box.dispatchEvent(ptr('lostpointercapture', 160));
    box.dispatchEvent(ptr('pointermove', 190));
    expect(events.filter((e) => e.phase === 'end')).toHaveLength(1);
    expect(events.at(-1)).toEqual({ phase: 'end', t: 0.3 });
  }
});

test('without a sample a click opens the dialog and a drag does nothing', () => {
  const events: Cursor[] = [];
  let loads = 0;
  const box = cursorWave(events, { peaks: null, path: undefined, onLoad: () => loads++ });
  box.dispatchEvent(ptr('pointerdown', 150));
  box.dispatchEvent(ptr('pointermove', 190));
  box.dispatchEvent(ptr('pointerup', 190));
  expect(events).toEqual([]);
  expect(loads).toBe(0);
  box.dispatchEvent(ptr('pointerdown', 150));
  box.dispatchEvent(ptr('pointerup', 150));
  expect(loads).toBe(1);
});
