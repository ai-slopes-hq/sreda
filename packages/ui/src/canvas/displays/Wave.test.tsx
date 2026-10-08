// @vitest-environment happy-dom
import { render } from '@solidjs/testing-library';
import { expect, test } from 'vitest';
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
