// @vitest-environment happy-dom
import { render } from '@solidjs/testing-library';
import { expect, test, vi } from 'vitest';
import { frame, setLayoutSeq, setSource } from '../../live';
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

test('live: the registered frame follows the trace pattern, not the PAT knob (lengths line and past dimming)', () => {
  // knob says A (pat 0); pattern C (2) plays with NOTE LEN 3 and GATE LEN 8
  const params: Record<string, number> = { pat: 0, cnlen: 2 / 15, cglen: 7 / 15 };
  const buf = new Float32Array(200);
  const at = 10;
  setLayoutSeq(1);
  buf[0] = 1;
  buf[at] = 2;
  [0, 3, 0, 0, 0, 0].forEach((c, i) => (buf[at + 1 + i] = c));
  for (let k = 0; k < 16; k++) buf[at + 8 + 16 + k] = k % 2;
  setSource(buf);
  const { container } = render(() => (
    <SeqView x={0} y={0} w={130} h={110} params={params} trace={undefined} traceAt={at} onOpen={() => {}} />
  ));
  expect(container.querySelector('.sr-seq-lens')!.textContent).toBe('16 · 16 · 16 · 16 · 16 · 16');
  frame(1000);
  expect(container.querySelector('.sr-seq-lens')!.textContent).toBe('3 · 8 · 16 · 16 · 16 · 16');
  const cells = container.querySelectorAll('.sr-seq-cell');
  expect(cells[3]!.classList.contains('cur')).toBe(true);
  expect(cells[1]!.classList.contains('on')).toBe(true);
  expect(cells[7]!.classList.contains('past')).toBe(false);
  expect(cells[8]!.classList.contains('past')).toBe(true);
  setSource(null);
});

test('a trace prop whose pattern differs from the knob: lengths and past follow the trace', () => {
  const params: Record<string, number> = { pat: 0, cglen: 3 / 15 };
  const t = trace();
  t[3] = 2; // pattern C plays, the knob says A
  const { container } = render(() => (
    <SeqView x={0} y={0} w={130} h={110} params={params} trace={t} traceAt={3} onOpen={() => {}} />
  ));
  expect(container.querySelector('.sr-seq-lens')!.textContent).toBe('16 · 4 · 16 · 16 · 16 · 16');
});
