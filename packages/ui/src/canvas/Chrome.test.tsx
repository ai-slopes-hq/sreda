// @vitest-environment happy-dom
import { fireEvent, render } from '@solidjs/testing-library';
import { expect, test, vi } from 'vitest';
import { createSession } from '../store';
import type { LibraryApi } from '../library';
import { Chrome, projectName } from './Chrome';

test('projectName: Untitled patch, the last path segment, no .sreda.json', () => {
  expect(projectName(null)).toBe('Untitled patch');
  expect(projectName({ path: 'FACTORY/techno', factory: true })).toBe('techno');
  expect(projectName({ path: 'acid/jam', factory: false })).toBe('jam');
  expect(projectName({ path: '/Users/x/jam.sreda.json', factory: false, file: true })).toBe('jam');
});

const lib = {} as LibraryApi;
const mount = (project: Parameters<typeof createSession>[3], dirty = false) => {
  const s = createSession({} as never, { modules: [], cables: [], groups: [] } as never, null, project);
  if (dirty) s.setState('dirty', true);
  const r = render(() => <Chrome session={s} lib={lib} zoom={() => {}} fit={() => {}} />);
  return r.container;
};

test('the brand bar names the project, its title is the full path', () => {
  const c = mount({ path: '/Users/x/jam.sreda.json', factory: false, file: true });
  const bar = c.querySelector('.sr-brand')!;
  expect(bar.getAttribute('title')).toBe('/Users/x/jam.sreda.json');
  expect(bar.querySelector('.sr-projname')!.textContent).toBe('jam');
  expect(bar.textContent).not.toContain('unsaved');
});

test('dirty shows unsaved; no project reads Untitled patch', () => {
  const c = mount(null, true);
  expect(c.querySelector('.sr-brand')!.textContent).toContain('unsaved');
  expect(c.querySelector('.sr-projname')!.textContent).toBe('Untitled patch');
});

test('the right bar reads Dice, New, Save, Sidebar in that order', () => {
  const c = mount(null);
  const names = [...c.querySelectorAll('.sr-tbtns button')].map((b) => b.textContent!.replace('⌘S', '').trim());
  expect(names).toEqual(['Dice', 'New', 'Save', 'Sidebar']);
});

test('a 60-character name sits in .sr-projname', () => {
  const name = 'x'.repeat(60);
  const c = mount({ path: `a/${name}`, factory: false });
  expect(c.querySelector('.sr-projname')!.textContent).toBe(name);
});

test('a press or double-click on the brand bar does not reach the canvas', () => {
  const s = createSession({} as never, { modules: [], cables: [], groups: [] } as never, null, null);
  const seen = vi.fn();
  const { container } = render(() => (
    <div onPointerDown={seen} onDblClick={seen}>
      <Chrome session={s} lib={lib} zoom={() => {}} fit={() => {}} />
    </div>
  ));
  const bar = container.querySelector('.sr-brand')!;
  fireEvent.pointerDown(bar);
  fireEvent.dblClick(bar);
  expect(seen).not.toHaveBeenCalled();
});
