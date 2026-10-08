// @vitest-environment happy-dom
import type { Group } from '@sreda/core';
import { fireEvent, render } from '@solidjs/testing-library';
import { expect, test } from 'vitest';
import { Frame, type FrameActions } from './Frame';

const group: Group = {
  id: 'g1',
  name: 'GROUP 1',
  x: 0,
  y: 0,
  w: 400,
  h: 200,
  parent: null,
  ratio: 1,
  tint: 0,
  layout: 'free',
  muted: false,
  clock: { on: false, bpm: 120 },
};

function frame() {
  const calls: string[] = [];
  const act: FrameActions = {
    headDown: () => calls.push('down'),
    rename: (name) => calls.push(`rename ${name}`),
    tint: () => calls.push('tint'),
    resizeDown: (edge) => calls.push(`resize ${edge}`),
    hover: () => undefined,
  };
  const r = render(() => <Frame group={group} selected={false} drop={false} act={act} />);
  return { ...r, calls };
}

test('a frame shows its name; its tools appear while the header is hovered', () => {
  const { container, calls } = frame();
  expect(container.querySelector('.sr-gname')?.textContent).toBe('GROUP 1');
  const head = container.querySelector('.sr-ghead')!;
  expect(container.querySelector('.sr-swatch')).toBeNull();
  fireEvent.pointerEnter(head);
  fireEvent.click(container.querySelector('.sr-swatch')!);
  expect(calls).toEqual(['tint']);
  fireEvent.pointerLeave(head);
  expect(container.querySelector('.sr-swatch')).toBeNull();
});

test('double-clicking the name renames the frame: Enter saves, Esc cancels', async () => {
  const { container, calls } = frame();
  fireEvent.dblClick(container.querySelector('.sr-gname')!);
  const input = container.querySelector<HTMLInputElement>('.sr-gname-in')!;
  input.value = 'drums';
  fireEvent.input(input);
  fireEvent.keyDown(input, { key: 'Enter' });
  expect(calls).toEqual(['rename DRUMS']);
  expect(container.querySelector('.sr-gname-in')).toBeNull();
  fireEvent.dblClick(container.querySelector('.sr-gname')!);
  fireEvent.keyDown(container.querySelector('.sr-gname-in')!, { key: 'Escape' });
  expect(calls).toEqual(['rename DRUMS']);
});

test('the edges and bottom corners are resize handles', () => {
  const { container, calls } = frame();
  for (const edge of ['l', 'r', 'b', 'bl', 'br'])
    fireEvent.pointerDown(container.querySelector(`[data-resize=${edge}]`)!, { button: 0 });
  expect(calls).toEqual(['resize l', 'resize r', 'resize b', 'resize bl', 'resize br']);
});
