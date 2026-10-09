// @vitest-environment happy-dom
import { SPECS, starterDoc } from '@sreda/core';
import { fireEvent, render } from '@solidjs/testing-library';
import { expect, test, vi } from 'vitest';
import type { SredaBridge } from '../library';
import { createSession } from '../store';
import { Settings } from './Settings';

const ground = () => document.documentElement.style.getPropertyValue('--ground');

function setup() {
  const setSkin = vi.fn(() => Promise.resolve());
  const bridge = { settings: { skin: () => Promise.resolve(null), setSkin } } as unknown as SredaBridge;
  const session = createSession(SPECS, starterDoc(SPECS));
  const r = render(() => <Settings session={session} bridge={bridge} />);
  const row = (name: string) => r.container.querySelector<HTMLElement>(`[data-skin="${name}"]`)!;
  return { ...r, session, setSkin, row };
}

test('six rows, each with its name and seven swatches', () => {
  const { container, row } = setup();
  const rows = container.querySelectorAll('.sr-skin');
  expect(rows).toHaveLength(6);
  for (const r of rows) expect(r.querySelectorAll('.sw')).toHaveLength(7);
  expect(row('NORD').querySelector('.name')?.textContent).toBe('NORD');
  expect(row('NORD').querySelector<HTMLElement>('.sw')!.style.background).toBe('#2e3440');
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
