// @vitest-environment happy-dom
import { addModule, connect, emptyDoc, frameSelection, SPECS, starterDoc, type Doc } from '@sreda/core';
import { fireEvent, render } from '@solidjs/testing-library';
import { expect, test, vi } from 'vitest';
import { createSession } from '../store';
import { Mix } from './Mix';

function setup(doc: Doc = starterDoc(SPECS)) {
  const session = createSession(SPECS, doc);
  const knob = vi.spyOn(session, 'knob');
  const params = vi.spyOn(session, 'params');
  const setMaster = vi.spyOn(session, 'setMaster');
  const focus = vi.fn();
  const r = render(() => <Mix session={session} specs={SPECS} focus={focus} />);
  const strip = r.container.querySelector<HTMLElement>('.sr-strip[data-out]')!;
  const out = session.state.doc.modules.find((m) => m.type === 'out')!;
  return { ...r, session, knob, params, setMaster, strip, out, focus };
}

test('the strip fader is horizontal: a drag right raises the OUT level; a double-click resets it', () => {
  const { strip, knob, out } = setup();
  const fader = strip.querySelector('.sr-fader')!;
  expect(fader.getAttribute('aria-orientation')).toBe('horizontal');
  const v0 = Number(fader.getAttribute('aria-valuenow')) / 100;
  fireEvent.pointerDown(fader, { clientX: 200, button: 0, pointerId: 1 });
  fireEvent.pointerMove(fader, { clientX: 230, pointerId: 1 });
  expect(knob).toHaveBeenCalledWith(out.id, 'level', expect.closeTo(v0 + 0.15, 5), expect.anything());
  fireEvent.pointerMove(fader, { clientX: 230, shiftKey: true, pointerId: 1 });
  expect(knob).toHaveBeenLastCalledWith(out.id, 'level', expect.closeTo(v0 + 0.015, 5), expect.anything());
  fireEvent.pointerUp(fader, { pointerId: 1 });
  fireEvent.dblClick(fader);
  expect(knob).toHaveBeenLastCalledWith(out.id, 'level', expect.any(Number), undefined);
});

test('M and S set the OUT’s mute and solo', () => {
  const { strip, params, out } = setup();
  const [m, s] = strip.querySelectorAll('.sr-ms button');
  fireEvent.click(m!);
  expect(params).toHaveBeenCalledWith(out.id, { mute: 1 }, undefined);
  fireEvent.click(s!);
  expect(params).toHaveBeenCalledWith(out.id, { solo: 1 }, undefined);
});

test('the master fader calls setMaster; double-click resets to 1', () => {
  const { container, setMaster } = setup();
  const fader = container.querySelector('.sr-strip.master .sr-fader')!;
  fireEvent.pointerDown(fader, { clientX: 260, button: 0, pointerId: 1 });
  fireEvent.pointerMove(fader, { clientX: 200, pointerId: 1 });
  expect(setMaster).toHaveBeenCalledWith(expect.closeTo(0.7, 5), expect.anything());
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

function fed(outs: number): Doc {
  let doc = addModule(emptyDoc, SPECS, 'mix', 0, 0).doc;
  const mix = doc.modules[0]!;
  for (let i = 0; i < outs; i++) doc = addModule(doc, SPECS, 'out', 400 + i * 300, 0).doc;
  const out = doc.modules.filter((m) => m.type === 'out').at(-1)!;
  return connect(doc, SPECS, [mix.id, 'out'], [out.id, 'l']);
}

test('an OUT card says which module feeds it', () => {
  const { container } = setup(fed(1));
  const card = container.querySelector('.sr-strip[data-out]')!;
  expect(card.querySelector('.sr-st-s')?.textContent).toBe('from MIX');
});

test('the one-OUT note shows with one OUT and hides with two; MASTER is the last element', () => {
  const one = setup();
  expect(one.container.querySelector('.sr-note')?.textContent).toBe(
    'One strip per OUT module. Add another OUT to give a voice its own strip, mute and solo.',
  );
  expect(one.container.querySelector('.sr-mix')!.lastElementChild!.matches('.master')).toBe(true);
  one.unmount();
  const two = setup(fed(2));
  expect(two.container.querySelectorAll('.sr-strip[data-out]')).toHaveLength(2);
  expect(two.container.querySelector('.sr-note')).toBeNull();
  expect(two.container.querySelector('.sr-mix')!.lastElementChild!.matches('.master')).toBe(true);
  expect(two.container.querySelector('.sr-sfoot')?.textContent).toBe('after the limiter');
});
