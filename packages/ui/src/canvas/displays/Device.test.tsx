// @vitest-environment happy-dom
import { cleanup, render } from '@solidjs/testing-library';
import { afterEach, expect, test } from 'vitest';
import { frame, setLayoutSeq, setSource } from '../../live';
import { Device } from './Device';

afterEach(cleanup);
const base = { x: 0, y: 0, w: 200, h: 60, label: 'A4 · T2' };

test('shows NOT CONNECTED when missing', () => {
  const r = render(() => <Device {...base} status="missing" state={undefined} />);
  expect(r.container.textContent).toContain('A4 · T2 · NOT CONNECTED');
  expect(r.container.querySelector('.sr-device.missing')).not.toBeNull();
});

test('before MIDI is requested (idle) the label shows as usual: not dimmed, not NOT CONNECTED', () => {
  const r = render(() => <Device {...base} status="idle" state={undefined} />);
  expect(r.container.textContent).toContain('A4 · T2');
  expect(r.container.textContent).not.toContain('NOT CONNECTED');
  expect(r.container.textContent).not.toContain('NO MIDI');
  expect(r.container.querySelector('.sr-device.missing')).toBeNull();
});

test('shows NO MIDI when unavailable', () => {
  const r = render(() => <Device {...base} status="unavailable" state={undefined} />);
  expect(r.container.textContent).toContain('NO MIDI');
  expect(r.container.querySelector('.sr-device.missing')).not.toBeNull();
});

test('lights while state is 1', () => {
  const buf = new Float32Array(8);
  setSource(buf);
  setLayoutSeq(3);
  const r = render(() => <Device {...base} status="connected" state={5} />);
  expect(r.container.textContent).toContain('A4 · T2');
  expect(r.container.textContent).not.toContain('NOT CONNECTED');
  const lamp = r.container.querySelector('.sr-lamp')!;
  buf[0] = 3;
  buf[5] = 1;
  frame(0);
  expect(lamp.getAttribute('data-cur')).toBe('1');
  buf[5] = 0;
  frame(16);
  expect(lamp.getAttribute('data-cur')).toBe('0');
  setSource(null);
});
