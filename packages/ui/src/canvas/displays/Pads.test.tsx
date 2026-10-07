// @vitest-environment happy-dom
import { render } from '@solidjs/testing-library';
import { expect, test, vi } from 'vitest';
import { Pads } from './Pads';

function params(grid: string, mode: number): Record<string, number> {
  const p: Record<string, number> = { mode };
  [...grid].forEach((c, i) => {
    p['g' + (i + 1)] = c === 'x' ? 1 : c === '-' ? 2 : 0;
    p['a' + (i + 1)] = 0;
  });
  return p;
}

test('a TIE pad bridges to the pad before it; pads past LEN dim', () => {
  const { container } = render(() => (
    <Pads
      x={0}
      y={0}
      w={440}
      h={122}
      params={params('x-..x...........', 1)}
      len={8}
      hits={3}
      rot={0}
      state={undefined}
      edit={() => {}}
    />
  ));
  const pads = container.querySelectorAll('.sr-pad');
  expect(pads).toHaveLength(16);
  expect(pads[1]!.classList.contains('tie')).toBe(true);
  expect(pads[9]!.classList.contains('past')).toBe(true);
});

test('touching a pad in EUCLID writes the pattern into the grid and switches to GRID', () => {
  const edit = vi.fn();
  const { container } = render(() => (
    <Pads
      x={0}
      y={0}
      w={440}
      h={122}
      params={params('................', 0)}
      len={16}
      hits={4}
      rot={0}
      state={undefined}
      edit={edit}
    />
  ));
  (container.querySelectorAll('.sr-pad')[1] as HTMLElement).dispatchEvent(
    new MouseEvent('click', { bubbles: true }),
  );
  expect(edit).toHaveBeenCalledTimes(1);
  const changes = edit.mock.calls[0]![0] as Record<string, number>;
  expect(changes['mode']).toBe(1);
  expect(changes['g1']).toBe(1); // euclid 16 / 4: steps 1, 5, 9, 13
  expect(changes['g5']).toBe(1);
  expect(changes['g2']).toBe(1); // the touched pad: OFF → ON
});
