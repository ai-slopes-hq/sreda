// @vitest-environment happy-dom
import { SPECS, starterDoc } from '@sreda/core';
import { fireEvent, render } from '@solidjs/testing-library';
import { expect, test, vi } from 'vitest';
import type { SredaBridge } from '../library';
import { createSession } from '../store';
import { SKIN_LINE, Settings } from './Settings';

const ground = () => document.documentElement.style.getPropertyValue('--ground');

function setup() {
  const setSkin = vi.fn(() => Promise.resolve());
  const bridge = { settings: { skin: () => Promise.resolve(null), setSkin } } as unknown as SredaBridge;
  const session = createSession(SPECS, starterDoc(SPECS));
  const r = render(() => <Settings session={session} bridge={bridge} />);
  const row = (name: string) => r.container.querySelector<HTMLElement>(`[data-skin="${name}"]`)!;
  return { ...r, session, setSkin, row };
}

test('six rows, each a tile (ground, panel, text, four roles), its name and its line', () => {
  const { container, row } = setup();
  const rows = container.querySelectorAll('.sr-skin');
  expect(rows).toHaveLength(6);
  for (const r of rows) {
    expect(r.querySelectorAll('.tile')).toHaveLength(1);
    expect(r.querySelectorAll('.tile .rd')).toHaveLength(4);
    expect(r.querySelector('.line')?.textContent).toBe(SKIN_LINE[r.getAttribute('data-skin') as keyof typeof SKIN_LINE]);
  }
  expect(Object.values(SKIN_LINE)).toEqual([
    'Warm graphite',
    'Deep green, neon roles',
    'Ink-blue night',
    'Neutral grey',
    'Cool slate',
    'Indigo night',
  ]);
  expect(row('NORD').querySelector('.name')?.textContent).toBe('NORD');
  expect(row('NORD').querySelector<HTMLElement>('.tile')!.style.background).toBe('#2e3440');
  expect(container.querySelector('.sr-sfoot')?.textContent).toBe('Skins change colour only');
});

test('the chosen row has the check; hovering another reads Previewing — click to keep', () => {
  const { container, row } = setup();
  expect(container.querySelectorAll('.sk-r')).toHaveLength(1);
  expect(row('DEFAULT').querySelector('.sk-r')).not.toBeNull();
  fireEvent.mouseEnter(row('KANAGAWA'));
  expect(row('KANAGAWA').querySelector('.line')?.textContent).toBe('Previewing — click to keep');
  expect(row('DEFAULT').querySelector('.line')?.textContent).toBe('Warm graphite');
  fireEvent.mouseLeave(container.querySelector('.sr-skins')!);
  expect(row('KANAGAWA').querySelector('.line')?.textContent).toBe(SKIN_LINE.KANAGAWA);
});

test('hovering previews a skin, leaving the list restores the chosen one; a click chooses and saves it', () => {
  const { container, row, setSkin, session } = setup();
  const list = container.querySelector('.sr-skins')!;
  fireEvent.mouseEnter(row('KANAGAWA'));
  expect(ground()).toBe('#1f1f28');
  expect(setSkin).not.toHaveBeenCalled();
  fireEvent.mouseLeave(list);
  expect(ground()).toBe('#121210');
  fireEvent.mouseEnter(row('NORD'));
  fireEvent.click(row('NORD'));
  expect(setSkin).toHaveBeenCalledWith('NORD');
  expect(session.state.skin).toBe('NORD');
  fireEvent.mouseEnter(row('KANAGAWA'));
  fireEvent.mouseLeave(list);
  expect(ground()).toBe('#2e3440');
});

test('unmounting the list while a row is hovered applies the chosen skin', () => {
  const { row, unmount } = setup();
  fireEvent.mouseEnter(row('KANAGAWA'));
  expect(ground()).toBe('#1f1f28');
  unmount();
  expect(ground()).toBe('#121210');
});
