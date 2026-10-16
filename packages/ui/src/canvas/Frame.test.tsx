// @vitest-environment happy-dom
import type { Group } from '@sreda/core';
import { fireEvent, render } from '@solidjs/testing-library';
import { expect, test, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Frame, type BlockView, type FrameActions } from './Frame';

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
  collapsed: false,
  clock: { on: false, bpm: 120 },
};

function frame(g: Partial<Group> = {}, cabledIn = false, block?: BlockView, selected = false) {
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
    save: () => calls.push('save'),
    collapse: (on) => calls.push(`collapse ${on}`),
    blockJackDown: (j) => calls.push(`bjack ${j.id}.${j.port}`),
  };
  const r = render(() => (
    <Frame
      group={{ ...group, ...g }}
      selected={selected}
      drop={false}
      cabledIn={cabledIn}
      cabledOut={false}
      block={block}
      act={act}
    />
  ));
  return { ...r, calls };
}

test('a frame shows its name; the swatch appears while the header is hovered', () => {
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

test('at rest a frame shows neither Stack, Save group nor the swatch; hovering the header or selecting it shows them', () => {
  const rest = frame({ layout: 'stack' });
  for (const t of ['Stack', 'Save group']) expect(rest.queryByText(t)).toBeNull();
  expect(rest.container.querySelector('.sr-swatch')).toBeNull();
  fireEvent.pointerEnter(rest.container.querySelector('.sr-ghead')!);
  for (const t of ['Stack', 'Save group']) expect(rest.queryByText(t)).not.toBeNull();
  expect(rest.container.querySelector('.sr-swatch')).not.toBeNull();
  rest.unmount();
  const sel = frame({ layout: 'stack' }, false, undefined, true);
  for (const t of ['Stack', 'Save group']) expect(sel.queryByText(t)).not.toBeNull();
  fireEvent.click(sel.getByText('Save group'));
  expect(sel.calls).toEqual(['save']);
});

test('the own clock shows as an NN BPM pill at rest; Tap and the remove button only on hover', () => {
  const { container, getByText, queryByText, queryByLabelText } = frame({ clock: { on: true, bpm: 130 } });
  expect(getByText('130 BPM')).not.toBeNull();
  expect(queryByText('Tap')).toBeNull();
  expect(queryByLabelText('Remove group clock')).toBeNull();
  fireEvent.pointerEnter(container.querySelector('.sr-ghead')!);
  expect(queryByText('Tap')).not.toBeNull();
});

test('a frame without a clock offers + Clock only on hover', () => {
  const { container, queryByText } = frame();
  expect(queryByText('+ Clock')).toBeNull();
  fireEvent.pointerEnter(container.querySelector('.sr-ghead')!);
  expect(queryByText('+ Clock')).not.toBeNull();
});

test('a muted frame shows a lit M at rest, and nothing else of the tools', () => {
  const { getByLabelText, container } = frame({ muted: true });
  expect(getByLabelText('Mute frame').classList.contains('on')).toBe(true);
  expect(container.querySelector('.sr-swatch')).toBeNull();
});

test('the collapse control sits before the name: ⌄ expanded, › collapsed', () => {
  const open = frame();
  const head = open.container.querySelector('.sr-ghead')!;
  const kids = [...head.children];
  expect(kids[0]!.getAttribute('aria-label')).toBe('Collapse frame');
  expect(kids[1]!.classList.contains('sr-gname')).toBe(true);
  open.unmount();
  const shut = frame({ collapsed: true }, false, block);
  expect(shut.container.querySelector('.sr-ghead')!.children[0]!.getAttribute('aria-label')).toBe('Expand frame');
});

test('a collapsed block says how many modules it holds', () => {
  const { container } = frame({ collapsed: true }, false, block);
  expect(container.querySelector('.sr-bcount')?.textContent).toBe('4 modules');
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

test('+ Clock turns the own clock on; ✕ turns it off; the BPM dims while CLK IN has a cable', () => {
  const off = frame();
  fireEvent.pointerEnter(off.container.querySelector('.sr-ghead')!);
  fireEvent.click(off.getByText('+ Clock'));
  expect(off.calls).toEqual(['clock true 120']);
  off.unmount();
  const on = frame({ clock: { on: true, bpm: 128 } }, true);
  expect(on.getByText('128 BPM').classList.contains('dim')).toBe(true);
  fireEvent.pointerEnter(on.container.querySelector('.sr-ghead')!);
  fireEvent.click(on.getByLabelText('Remove group clock'));
  expect(on.calls).toEqual(['clock false 128']);
});

test('Tap sets the BPM from the last taps', () => {
  const now = vi.spyOn(performance, 'now');
  const { getByText, calls, container } = frame({ clock: { on: true, bpm: 128 } });
  fireEvent.pointerEnter(container.querySelector('.sr-ghead')!);
  for (const t of [1000, 1500, 2000]) {
    now.mockReturnValue(t);
    fireEvent.click(getByText('Tap'));
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

test('M mutes; lit while on; a muted parent dims the frame', () => {
  const plain = frame();
  fireEvent.pointerEnter(plain.container.querySelector('.sr-ghead')!);
  fireEvent.click(plain.getByLabelText('Mute frame'));
  expect(plain.calls).toEqual(['mute']);
  plain.unmount();
  const muted = frame({ muted: true });
  expect(muted.getByLabelText('Mute frame').classList.contains('on')).toBe(true);
  expect(muted.container.querySelector('.sr-frame')!.classList.contains('muted')).toBe(false);
  expect(muted.container.querySelector('.sr-gmeter')).not.toBeNull();
});

test('a STACK frame lights Stack; a managed frame has only the r and br handles', () => {
  const stacked = frame({ layout: 'stack' }, false, undefined, true);
  expect(stacked.getByText('Stack').classList.contains('on')).toBe(true);
  const edges = [...stacked.container.querySelectorAll('[data-resize]')].map((e) =>
    e.getAttribute('data-resize'),
  );
  expect(edges.sort()).toEqual(['br', 'r']);
  stacked.unmount();
  const free = frame();
  expect(free.container.querySelectorAll('[data-resize]')).toHaveLength(5);
});

test('Stack is a frame tool and there is no FIX', () => {
  const stacked = frame({ layout: 'stack' }, false, undefined, true);
  fireEvent.click(stacked.getByText('Stack'));
  expect(stacked.calls).toEqual(['stack']);
  expect(stacked.queryByText('FIX')).toBeNull();
});

const block: BlockView = {
  w: 352,
  h: 96,
  modules: 4,
  jacks: [
    {
      id: 'm1',
      port: 'in',
      label: 'FILTER › LP',
      dir: 'in',
      x: 12,
      y: 48,
      role: 'audio',
      filled: true,
      listening: false,
    },
    {
      id: 'g2',
      port: 'clkOut',
      label: 'INNER › CLK',
      dir: 'out',
      x: 340,
      y: 48,
      role: 'trigger',
      filled: false,
      listening: false,
    },
  ],
};

test('a collapsed frame is a block: a jack per crossing port, no frame body; › expands', () => {
  const { container, calls, getByLabelText } = frame({ collapsed: true }, false, block);
  expect(container.querySelector('.sr-block')).not.toBeNull();
  const jacks = [...container.querySelectorAll('.sr-bjack')];
  expect(jacks.map((j) => j.textContent)).toEqual(['FILTER › LP', 'INNER › CLK']);
  expect(container.querySelector('[data-resize]')).toBeNull();
  expect(container.querySelector('.sr-plabel')).toBeNull();
  // each wrapper names the inner object and its port, so a dropped cable patches it
  expect(jacks[0]!.getAttribute('data-module')).toBe('m1');
  expect(jacks[0]!.getAttribute('data-jack')).toBe('in');
  expect(jacks[1]!.getAttribute('data-frame')).toBe('g2');
  fireEvent.pointerDown(jacks[0]!.querySelector('.sr-jack')!, { button: 0 });
  fireEvent.click(getByLabelText('Expand frame'));
  expect(calls).toEqual(['bjack m1.in', 'collapse false']);
});

test('an expanded frame has ⌄, which collapses it', () => {
  const { calls, getByLabelText } = frame();
  fireEvent.click(getByLabelText('Collapse frame'));
  expect(calls).toEqual(['collapse true']);
});

test('at the minimum width the name gives way and the tools stay: ellipsis on the name, a rigid cluster, no level meter', () => {
  const css = readFileSync(resolve(__dirname, 'canvas.css'), 'utf8');
  const rule = (sel: string) => new RegExp(`\\n${sel.replace('.', '\\.')} \\{([^}]*)\\}`).exec(css)![1]!;
  const name = rule('.sr-gname');
  for (const d of ['flex: 0 1 auto', 'min-width: 0', 'overflow: hidden', 'text-overflow: ellipsis', 'white-space: nowrap'])
    expect(name).toContain(d);
  expect(rule('.sr-gclock')).toContain('flex: none');
  const { container } = frame({ name: 'A-VERY-LONG-FRAME-NAME-THAT-CANNOT-FIT', w: 352 }, false, undefined, true);
  expect(container.querySelector('.sr-gname')!.textContent).toBe('A-VERY-LONG-FRAME-NAME-THAT-CANNOT-FIT');
  const cluster = container.querySelector('.sr-gclock')!;
  expect(cluster.querySelector('.sr-swatch')).not.toBeNull();
  expect([...cluster.querySelectorAll('.sr-gbtn')].map((b) => b.textContent)).toEqual(['Stack', 'Save group', 'M', expect.any(String)]);
  expect(cluster.querySelector('[aria-label="Mute frame"]')).not.toBeNull();
  expect(container.querySelector('.sr-gmeter')!.classList.contains('hide')).toBe(true);
});
