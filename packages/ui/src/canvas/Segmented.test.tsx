// @vitest-environment happy-dom
import { fireEvent, render } from '@solidjs/testing-library';
import { expect, test, vi } from 'vitest';
import { Segmented } from './Segmented';

const items = [
  { id: 'a', label: 'All', count: 12 },
  { id: 'b', label: 'Modules' },
  { id: 'c', label: 'Groups', count: 3 },
];

test('items render as tabs; the value is selected; a click sets that id', () => {
  const set = vi.fn();
  const { container } = render(() => <Segmented items={items} value="b" set={set} />);
  expect(container.querySelector('[role=tablist]')).not.toBeNull();
  const tabs = [...container.querySelectorAll('button[role=tab]')];
  expect(tabs).toHaveLength(3);
  expect(tabs.map((t) => t.getAttribute('aria-selected'))).toEqual(['false', 'true', 'false']);
  fireEvent.click(tabs[2]!);
  expect(set).toHaveBeenCalledWith('c');
});

test('count renders after the label; ring marks that item only', () => {
  const { container } = render(() => <Segmented items={items} value="a" set={() => {}} ring="c" />);
  const tabs = [...container.querySelectorAll('button[role=tab]')];
  expect(tabs[0]!.textContent).toBe('All12');
  expect(tabs[0]!.querySelector('.count')!.textContent).toBe('12');
  expect(tabs[1]!.querySelector('.count')).toBeNull();
  expect(tabs.map((t) => t.classList.contains('ring'))).toEqual([false, false, true]);
});
