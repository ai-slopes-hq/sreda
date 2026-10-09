// @vitest-environment happy-dom
import { frameSelection, SPECS, starterDoc } from '@sreda/core';
import { fireEvent, render } from '@solidjs/testing-library';
import { expect, test, vi } from 'vitest';
import { createSession } from '../store';
import { Mix } from './Mix';

function setup() {
  const session = createSession(SPECS, starterDoc(SPECS));
  const knob = vi.spyOn(session, 'knob');
  const params = vi.spyOn(session, 'params');
  const setMaster = vi.spyOn(session, 'setMaster');
  const focus = vi.fn();
  const r = render(() => <Mix session={session} specs={SPECS} focus={focus} />);
  const strip = r.container.querySelector<HTMLElement>('.sr-strip[data-out]')!;
  const out = session.state.doc.modules.find((m) => m.type === 'out')!;
  return { ...r, session, knob, params, setMaster, strip, out, focus };
}

test('dragging a strip fader turns the OUT level; a double-click resets it', () => {
  const { strip, knob, out } = setup();
  const fader = strip.querySelector('.sr-fader')!;
  const v0 = Number(fader.getAttribute('aria-valuenow')) / 100;
  fireEvent.pointerDown(fader, { clientY: 200, button: 0, pointerId: 1 });
  fireEvent.pointerMove(fader, { clientY: 230, pointerId: 1 });
  expect(knob).toHaveBeenCalledWith(out.id, 'level', expect.closeTo(v0 - 0.25, 5), expect.anything());
  fireEvent.pointerUp(fader, { pointerId: 1 });
  fireEvent.dblClick(fader);
  expect(knob).toHaveBeenLastCalledWith(out.id, 'level', expect.any(Number), undefined);
});

test('M and S set the OUT’s mute and solo', () => {
  const { strip, params, out } = setup();
  const [m, s] = strip.querySelectorAll('button.sr-gbtn');
  fireEvent.click(m!);
  expect(params).toHaveBeenCalledWith(out.id, { mute: 1 }, undefined);
  fireEvent.click(s!);
  expect(params).toHaveBeenCalledWith(out.id, { solo: 1 }, undefined);
});

test('the master fader calls setMaster; double-click resets to 1', () => {
  const { container, setMaster } = setup();
  const fader = container.querySelector('.sr-strip.master .sr-fader')!;
  fireEvent.pointerDown(fader, { clientY: 200, button: 0, pointerId: 1 });
  fireEvent.pointerMove(fader, { clientY: 260, pointerId: 1 });
  expect(setMaster).toHaveBeenCalledWith(expect.closeTo(0.5, 5), expect.anything());
  fireEvent.dblClick(fader);
  expect(setMaster).toHaveBeenLastCalledWith(1, undefined);
});

test('a click on a name selects and frames the OUT (the canvas focus path)', () => {
  const { strip, focus, out } = setup();
  fireEvent.click(strip.querySelector('.sr-sname')!);
  expect(focus).toHaveBeenCalledWith(out.id);
});

test('a click on the name of an OUT hidden in a collapsed frame focuses the block', () => {
  const { session, container, focus, out } = setup();
  const framed = frameSelection(session.current(), SPECS, [out.id]);
  session.commit(framed.doc);
  session.collapse([framed.id], true);
  fireEvent.click(container.querySelector('.sr-strip[data-out] .sr-sname')!);
  expect(focus).toHaveBeenCalledWith(framed.id);
});
