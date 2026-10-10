// @vitest-environment happy-dom
import { laneParam, SPECS, stepId, type Lane as LaneId, type Merge } from '@sreda/core';
import { fireEvent, render } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { expect, test } from 'vitest';
import { Lane } from './Lane';

const W = 160; // 16 clock steps of 10 px
const H = 100;

/** A lane of pattern A at 160 px; `edit` calls are recorded and applied to the params. */
function lane(l: LaneId, initial: Record<string, number> = {}) {
  const [params, setParams] = createSignal<Record<string, number>>(initial);
  const calls: { changes: Record<string, number>; merge: Merge }[] = [];
  const r = render(() => (
    <Lane
      lane={l}
      pattern={0}
      params={params()}
      width={W}
      spec={SPECS['metaseq']!}
      scope="m1"
      edit={(changes, merge) => {
        calls.push({ changes, merge });
        setParams({ ...params(), ...changes });
      }}
    />
  ));
  const svg = r.container.querySelector('.sr-lane-svg') as SVGSVGElement;
  svg.getBoundingClientRect = () =>
    ({ left: 0, top: 0, width: W, height: H, right: W, bottom: H, x: 0, y: 0 }) as DOMRect;
  const all = () => Object.assign({}, ...calls.map((c) => c.changes)) as Record<string, number>;
  return { ...r, svg, calls, all, params };
}

const at = (k: number) => k * 10 + 5; // the centre of cell k (0-based)

test('a drag across GATE cells 2–5 from an off cell turns all four on in one merge key', () => {
  const { svg, calls, all } = lane('g');
  fireEvent.pointerDown(svg, { button: 0, pointerId: 1, clientX: at(1), clientY: 50 });
  for (const k of [2, 3, 4]) fireEvent.pointerMove(svg, { pointerId: 1, clientX: at(k), clientY: 50 });
  fireEvent.pointerUp(svg, { pointerId: 1, clientX: at(4), clientY: 50 });
  const w = all();
  for (const k of [2, 3, 4, 5]) expect(w[stepId(0, 'g', k)] ?? 1).toBe(1);
  expect(w[stepId(0, 'g', 2)]).toBe(1);
  expect(w[stepId(0, 'g', 4)]).toBe(1);
  expect(Object.keys(w)).not.toContain(stepId(0, 'g', 6));
  expect(calls.length).toBeGreaterThan(0);
  const keys = new Set(calls.map((c) => c.merge?.key));
  expect(keys.size).toBe(1);
  expect(calls.every((c) => c.merge?.stroke)).toBe(true);
});

test('a GATE click on an on cell turns it off; the next stroke has its own merge key', () => {
  const { svg, calls } = lane('g');
  fireEvent.pointerDown(svg, { button: 0, pointerId: 1, clientX: at(0), clientY: 50 });
  fireEvent.pointerUp(svg, { pointerId: 1 });
  expect(calls[0]!.changes).toEqual({ [stepId(0, 'g', 1)]: 0 });
  fireEvent.pointerDown(svg, { button: 0, pointerId: 1, clientX: at(2), clientY: 50 });
  fireEvent.pointerUp(svg, { pointerId: 1 });
  expect(calls[1]!.changes).toEqual({ [stepId(0, 'g', 3)]: 1 });
  expect(calls[1]!.merge?.key).not.toBe(calls[0]!.merge?.key);
});

test('a NOTE drag writes semitones snapped to SCALE from ROOT (MIN from C: 13 → 12)', () => {
  const { svg, calls } = lane('n');
  // the pointer's height at 13 semitones: a note's bar is centred at (1 − v / 24) · 85 % + 10 %
  const y13 = ((1 - 13 / 24) * 0.85 + 0.1) * H;
  fireEvent.pointerDown(svg, { button: 0, pointerId: 1, clientX: at(3), clientY: y13 });
  fireEvent.pointerUp(svg, { pointerId: 1 });
  expect(calls[0]!.changes).toEqual({ [stepId(0, 'n', 4)]: 12 / 24 });
  // 14 is in MIN: kept
  const y14 = ((1 - 14 / 24) * 0.85 + 0.1) * H;
  fireEvent.pointerDown(svg, { button: 0, pointerId: 1, clientX: at(5), clientY: y14 });
  expect(calls[1]!.changes).toEqual({ [stepId(0, 'n', 6)]: 14 / 24 });
});

test("the NOTE lane's names follow SCALE and ROOT", () => {
  const { container } = lane('n', { an1: 13 / 24, an2: 14 / 24 });
  const names = () => [...container.querySelectorAll('.sr-note-name')].slice(0, 2).map((t) => t.textContent);
  expect(names()).toEqual(['C', 'D']); // 13 plays as 12 in MIN from C
  const { container: c2 } = lane('n', { an1: 13 / 24, an2: 14 / 24, scale: 0, root: 1 / 11 });
  expect([...c2.querySelectorAll('.sr-note-name')].slice(0, 2).map((t) => t.textContent)).toEqual([
    'C#',
    'D',
  ]);
});

test('dragging the end marker past LEN sets LEN', () => {
  const { container, calls } = lane('g', { [laneParam(0, 'g', 'len')]: 3 / 15 });
  const marker = container.querySelector('[data-len-marker]') as SVGElement;
  expect(marker.getAttribute('x')).toBe(String(40 - 3));
  fireEvent.pointerDown(marker, { button: 0, pointerId: 1, clientX: 40, clientY: 50 });
  fireEvent.pointerMove(marker, { pointerId: 1, clientX: 62, clientY: 50 });
  fireEvent.pointerMove(marker, { pointerId: 1, clientX: 80, clientY: 50 });
  fireEvent.pointerUp(marker, { pointerId: 1, clientX: 80, clientY: 50 });
  expect(calls.at(-1)!.changes).toEqual({ [laneParam(0, 'g', 'len')]: 7 / 15 });
  expect(new Set(calls.map((c) => c.merge?.key)).size).toBe(1);
  // no step was painted
  expect(
    calls.some((c) => Object.keys(c.changes).some((k) => k.startsWith('ag') && !k.endsWith('len'))),
  ).toBe(false);
});

test('the wheel over LEN steps it by one', () => {
  const { container, calls } = lane('v');
  fireEvent.wheel(container.querySelector('[data-field=len]')!, { deltaY: 100 });
  expect(calls[0]!.changes).toEqual({ [laneParam(0, 'v', 'len')]: 14 / 15 });
});

test('ghost cells ignore the pointer', () => {
  const { svg, calls } = lane('g', { [laneParam(0, 'g', 'len')]: 3 / 15 });
  fireEvent.pointerDown(svg, { button: 0, pointerId: 1, clientX: at(6), clientY: 50 });
  fireEvent.pointerMove(svg, { pointerId: 1, clientX: at(9), clientY: 50 });
  fireEvent.pointerUp(svg, { pointerId: 1 });
  fireEvent.dblClick(svg, { clientX: at(6), clientY: 50 });
  expect(calls).toEqual([]);
  // a stroke from a bright cell does not paint into the ghosts
  fireEvent.pointerDown(svg, { button: 0, pointerId: 1, clientX: at(1), clientY: 50 });
  fireEvent.pointerMove(svg, { pointerId: 1, clientX: at(7), clientY: 50 });
  expect(Object.keys(Object.assign({}, ...calls.map((c) => c.changes)))).toEqual([
    stepId(0, 'g', 2),
    stepId(0, 'g', 3),
    stepId(0, 'g', 4),
  ]);
});

test('VEL draws bars; a double-click restores 1 within the same undo step', () => {
  const { svg, calls } = lane('v');
  fireEvent.pointerDown(svg, { button: 0, pointerId: 1, clientX: at(2), clientY: 75 });
  fireEvent.pointerUp(svg, { pointerId: 1 });
  expect(calls[0]!.changes).toEqual({ [stepId(0, 'v', 3)]: 0.25 });
  fireEvent.pointerDown(svg, { button: 0, pointerId: 1, clientX: at(2), clientY: 75 });
  fireEvent.pointerUp(svg, { pointerId: 1 });
  fireEvent.dblClick(svg, { clientX: at(2), clientY: 75 });
  expect(calls.at(-1)!.changes).toEqual({ [stepId(0, 'v', 3)]: 1 });
  expect(new Set(calls.map((c) => c.merge?.key)).size).toBe(1);
});

test('🔒 toggles the lane lock', () => {
  const { container, calls } = lane('t');
  fireEvent.click(container.querySelector('[data-lock]')!);
  expect(calls[0]!.changes).toEqual({ [laneParam(0, 't', 'lock')]: 1 });
});
