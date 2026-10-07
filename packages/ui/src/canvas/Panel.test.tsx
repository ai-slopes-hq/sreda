// @vitest-environment happy-dom
import { SPECS, starterDoc, type ModuleDoc } from '@sreda/core';
import { render } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { expect, test } from 'vitest';
import { waveGlyph } from './glyphs';
import { Panel, type PanelActions } from './Panel';

const noop: PanelActions = { knob() {}, option() {}, hover() {}, edit() {} };

function oscPanel(mod: Partial<ModuleDoc> = {}) {
  const osc = { ...starterDoc(SPECS).modules[0]!, ...mod };
  const [loud, setLoud] = createSignal(false);
  const r = render(() => (
    <Panel
      mod={osc}
      spec={SPECS['osc']!}
      name="OSC"
      loud={loud()}
      cabledIn={() => false}
      cabledOut={() => true}
      act={noop}
    />
  ));
  return { ...r, setLoud };
}

test('OSC renders its jacks, knobs and the WAVE option as a glyph', () => {
  const { container } = oscPanel();
  expect(container.querySelectorAll('[data-jack][data-dir=in]:not([data-mod])')).toHaveLength(3);
  expect(container.querySelectorAll('[data-jack][data-dir=out]')).toHaveLength(1);
  expect(container.querySelectorAll('[data-knob]')).toHaveLength(3);
  expect(container.querySelector('[data-option=wave] path')?.getAttribute('d')).toBe(waveGlyph('SAW', 24));
});

test("a knob's value text shows only when the module is loud (hovered, selected or edited)", () => {
  const { container, setLoud } = oscPanel();
  const value = () => container.querySelector('[data-knob=freq] [data-value]')?.textContent;
  expect(value()).toBe('');
  setLoud(true);
  expect(value()).toBe('110');
});

test('an input value shows when it is not the default', () => {
  const { container } = oscPanel({ ratios: { sync: 2 } });
  expect(container.querySelector('[data-field=sync]')?.textContent).toBe('×2');
  expect(container.querySelector('[data-field=pitch]')?.textContent).toBe('');
});
