// @vitest-environment happy-dom
import type { Group } from '@sreda/core';
import { fireEvent, render } from '@solidjs/testing-library';
import { expect, test, vi } from 'vitest';
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

function frame(g: Partial<Group> = {}, cabledIn = false) {
  const calls: string[] = [];
  const act: FrameActions = {
    headDown: () => calls.push('down'),
    rename: (name) => calls.push(`rename ${name}`),
    tint: () => calls.push('tint'),
    resizeDown: (edge) => calls.push(`resize ${edge}`),
    hover: () => undefined,
    clock: (c, merge) => calls.push(`clock ${c.on} ${c.bpm}${merge ? ' ' + merge.key : ''}`),
    jackDown: (port) => calls.push(`jack ${port}`),
    fieldDown: () => calls.push('field'),
    fieldReset: () => calls.push('reset'),
    mute: () => calls.push('mute'),
    stack: () => calls.push('stack'),
    fix: () => calls.push('fix'),
  };
  const r = render(() => (
    <Frame
      group={{ ...group, ...g }}
      selected={false}
      drop={false}
      cabledIn={cabledIn}
      cabledOut={false}
      act={act}
    />
  ));
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

test('+ CLOCK turns the own clock on; ✕ turns it off; the BPM dims while CLK IN has a cable', () => {
  const off = frame();
  fireEvent.click(off.getByText('+ CLOCK'));
  expect(off.calls).toEqual(['clock true 120']);
  off.unmount();
  const on = frame({ clock: { on: true, bpm: 128 } }, true);
  expect(on.getByText('128 BPM').classList.contains('dim')).toBe(true);
  fireEvent.click(on.getByLabelText('Remove group clock'));
  expect(on.calls).toEqual(['clock false 128']);
});

test('TAP sets the BPM from the last taps', () => {
  const now = vi.spyOn(performance, 'now');
  const { getByText, calls } = frame({ clock: { on: true, bpm: 128 } });
  for (const t of [1000, 1500, 2000]) {
    now.mockReturnValue(t);
    fireEvent.click(getByText('TAP'));
  }
  expect(calls).toEqual(['clock true 120 tap:g1', 'clock true 120 tap:g1']);
  now.mockRestore();
});

test('a frame has CLK IN (with its ratio field) and CLK OUT jacks', () => {
  const { container, calls } = frame({ ratio: -2 });
  fireEvent.pointerDown(container.querySelector('[data-jack=clkIn]')!, { button: 0 });
  fireEvent.pointerDown(container.querySelector('[data-jack=clkOut]')!, { button: 0 });
  expect(container.querySelector('[data-field=clkIn]')!.textContent).toBe('÷2');
  expect(calls).toEqual(['jack clkIn', 'jack clkOut']);
});

test('M mutes; lit while on, and the tools stay visible while it is on; a muted parent dims the frame', () => {
  const plain = frame();
  fireEvent.pointerEnter(plain.container.querySelector('.sr-ghead')!);
  fireEvent.click(plain.getByLabelText('Mute frame'));
  expect(plain.calls).toEqual(['mute']);
  plain.unmount();
  const muted = frame({ muted: true });
  expect(muted.getByLabelText('Mute frame').classList.contains('on')).toBe(true);
  expect(muted.container.querySelector('.sr-swatch')).not.toBeNull();
  expect(muted.container.querySelector('.sr-frame')!.classList.contains('muted')).toBe(false);
  expect(muted.container.querySelector('.sr-gmeter')).not.toBeNull();
});

test('STACK and FIX are frame tools; FIX is lit, and the tools stay, while WIRE FIX is on', () => {
  const routed = frame({ layout: 'route' });
  expect(routed.getByText('FIX').classList.contains('on')).toBe(true);
  fireEvent.click(routed.getByText('STACK'));
  fireEvent.click(routed.getByText('FIX'));
  expect(routed.calls).toEqual(['stack', 'fix']);
  routed.unmount();
  const free = frame();
  expect(free.queryByText('FIX')).toBeNull();
});
