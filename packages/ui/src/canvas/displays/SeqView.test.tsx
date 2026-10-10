// @vitest-environment happy-dom
import { render } from '@solidjs/testing-library';
import { expect, test, vi } from 'vitest';
import { SeqView } from './SeqView';

function trace(): Float32Array {
  const t = new Float32Array(110);
  const at = 3;
  t[at] = 0;
  [5, 5, 0, 0, 0, 0].forEach((c, i) => (t[at + 1 + i] = c));
  for (let k = 0; k < 16; k++) {
    t[at + 8 + k] = 12 + (k % 4); // NOTE
    t[at + 8 + 16 + k] = k % 4 === 0 ? 1 : 0; // GATE
    t[at + 8 + 64 + k] = 1; // VEL
  }
  return t;
}

test('draws 16 GATE cells with the cursor cell marked, and a NOTE contour from the live steps', () => {
  const { container } = render(() => (
    <SeqView x={0} y={0} w={130} h={110} params={{}} trace={trace()} traceAt={3} onOpen={() => {}} />
  ));
  const cells = container.querySelectorAll('.sr-seq-cell');
  expect(cells).toHaveLength(16);
  expect(container.querySelectorAll('.sr-seq-cell.cur')).toHaveLength(1);
  expect(cells[5]!.classList.contains('cur')).toBe(true);
  expect(cells[4]!.classList.contains('on')).toBe(true);
  expect(cells[5]!.classList.contains('on')).toBe(false);
  expect(container.querySelector('.d-note')!.getAttribute('d')).toMatch(/^M/);
});

test('without a trace it draws the playing pattern from the params; the lengths line reads the LENs', () => {
  const params: Record<string, number> = {
    anlen: 6 / 15,
    aglen: 1,
    atlen: 1,
    aalen: 4 / 15,
    avlen: 1,
    aclen: 1,
  };
  const { container } = render(() => (
    <SeqView x={0} y={0} w={130} h={110} params={params} trace={undefined} traceAt={undefined} onOpen={() => {}} />
  ));
  expect(container.querySelector('.sr-seq-lens')!.textContent).toBe('7 · 16 · 16 · 5 · 16 · 16');
  expect(container.querySelectorAll('.sr-seq-cell.on')).toHaveLength(4);
  expect(container.querySelectorAll('.sr-seq-cell.cur')).toHaveLength(0);
});

test('a click opens the editor', () => {
  const onOpen = vi.fn();
  const { container } = render(() => (
    <SeqView x={0} y={0} w={130} h={110} params={{}} trace={undefined} traceAt={undefined} onOpen={onOpen} />
  ));
  (container.querySelector('.sr-seq') as HTMLElement).click();
  expect(onOpen).toHaveBeenCalledTimes(1);
});
