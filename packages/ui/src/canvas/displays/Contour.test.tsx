// @vitest-environment happy-dom
import { addModule, emptyDoc, SPECS } from '@sreda/core';
import { render } from '@solidjs/testing-library';
import { expect, test, vi } from 'vitest';
import { Contour } from './Contour';

function stages() {
  return addModule(emptyDoc, SPECS, 'stages', 0, 0).doc.modules[0]!;
}

function pointer(el: EventTarget, type: string, x: number, y: number) {
  el.dispatchEvent(
    new PointerEvent(type, { bubbles: true, clientX: x, clientY: y, button: 0, pointerId: 1 }),
  );
}

test('a drag across three stages at one height sets them to one scale degree, as one stroke', () => {
  const edit = vi.fn();
  const m = stages();
  m.params['length'] = (4 - 1) / 15; // LEN 4: stages 110 px wide on a 440 px display
  const { container } = render(() => (
    <Contour
      x={0}
      y={0}
      w={440}
      h={250}
      spec={SPECS['stages']!}
      params={m.params}
      advPatched={true}
      state={undefined}
      edit={edit}
    />
  ));
  const d = container.querySelector('.sr-contour')!;
  pointer(d, 'pointerdown', 50, 60);
  pointer(window, 'pointermove', 160, 60);
  pointer(window, 'pointermove', 270, 60);
  pointer(window, 'pointerup', 270, 60);
  const keys = new Set(edit.mock.calls.map((c) => (c[1] as { key: string }).key));
  expect(keys.size).toBe(1);
  const merged = Object.assign({}, ...edit.mock.calls.map((c) => c[0] as Record<string, number>));
  expect(merged['v1']).toBeDefined();
  expect(merged['v1']).toBe(merged['v2']);
  expect(merged['v2']).toBe(merged['v3']);
  // snapped to C minor: the semitone is a degree
  const s = Math.round((merged['v1']! * 2 - 1) * 12 + 12);
  expect([0, 2, 3, 5, 7, 8, 10].includes(s % 12)).toBe(true);
});

test('clicking a dot toggles that stage’s pulse', () => {
  const edit = vi.fn();
  const m = stages();
  m.params['length'] = (4 - 1) / 15;
  const { container } = render(() => (
    <Contour
      x={0}
      y={0}
      w={440}
      h={250}
      spec={SPECS['stages']!}
      params={m.params}
      advPatched={true}
      state={undefined}
      edit={edit}
    />
  ));
  const d = container.querySelector('.sr-contour')!;
  pointer(d, 'pointerdown', 165, 240);
  pointer(window, 'pointerup', 165, 240);
  expect(edit).toHaveBeenCalledWith({ p2: 1 }, undefined);
});

test('gestures follow the canvas zoom: at 0.5 a stroke across the shown width covers every stage', () => {
  const edit = vi.fn();
  const m = stages();
  m.params['length'] = (4 - 1) / 15;
  const { container } = render(() => (
    <Contour
      x={0}
      y={0}
      w={440}
      h={250}
      spec={SPECS['stages']!}
      params={m.params}
      advPatched={true}
      state={undefined}
      edit={edit}
    />
  ));
  const d = container.querySelector('.sr-contour')! as HTMLElement;
  // drawn at half size on screen
  d.getBoundingClientRect = () =>
    ({
      left: 100,
      top: 50,
      width: 220,
      height: 125,
      right: 320,
      bottom: 175,
      x: 100,
      y: 50,
      toJSON() {},
    }) as DOMRect;
  pointer(d, 'pointerdown', 105, 80);
  for (const x of [150, 200, 250, 300, 318]) pointer(window, 'pointermove', x, 80);
  pointer(window, 'pointerup', 318, 80);
  const merged = Object.assign({}, ...edit.mock.calls.map((c) => c[0] as Record<string, number>));
  expect(Object.keys(merged).sort()).toEqual(['v1', 'v2', 'v3', 'v4']);
});
