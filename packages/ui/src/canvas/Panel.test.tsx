// @vitest-environment happy-dom
import { SPECS, starterDoc, type ModuleDoc } from '@sreda/core';
import { render } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { expect, test } from 'vitest';
import { responseGlyph, waveGlyph } from './glyphs';
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

test('a held port has no ratio field', () => {
  const spec = {
    ...SPECS['osc']!,
    inputs: SPECS['osc']!.inputs.map((p) => (p.id === 'sync' ? { ...p, held: true } : p)),
  };
  const osc = { ...starterDoc(SPECS).modules[0]!, ratios: { sync: 2 } };
  const { container } = render(() => (
    <Panel
      mod={osc}
      spec={spec}
      name="OSC"
      loud={true}
      cabledIn={() => false}
      cabledOut={() => true}
      act={noop}
    />
  ));
  expect(container.querySelector('[data-field=sync]')).toBeNull();
  expect(container.querySelector('[data-field=pitch]')).not.toBeNull();
});

test("FILTER's MODEL is drawn as a response glyph at its CUT and RES", () => {
  const { container } = render(() => (
    <Panel
      mod={{
        id: 'm1',
        type: 'filter',
        x: 0,
        y: 0,
        parent: null,
        params: { model: 2, cutoff: 0.3, res: 0.8 },
        atts: {},
        ratios: {},
      }}
      spec={SPECS['filter']!}
      name="FILTER"
      loud={false}
      cabledIn={() => false}
      cabledOut={() => false}
      act={noop}
    />
  ));
  expect(container.querySelector('[data-option=model] path')?.getAttribute('d')).toBe(
    responseGlyph('DIODE', 24, { cut: 0.3, res: 0.8 }),
  );
});

test('SAMPLER display: a drag scrubs and moves START in one undo stroke; SLICE: a click plays the slice', () => {
  const calls: string[] = [];
  const keys = new Set<string | undefined>();
  const act: PanelActions = {
    ...noop,
    knob: (p, k, m) => {
      calls.push(`knob ${p} ${k.toFixed(2)}`);
      keys.add(m?.key);
    },
    fixed: (p, v) => calls.push(`fixed ${p} ${v.toFixed(2)}`),
  };
  const mount = (mode: number) => {
    const { container } = render(() => (
      <Panel
        mod={{
          id: 'm1',
          type: 'sampler',
          x: 0,
          y: 0,
          parent: null,
          params: { mode, start: 0 },
          atts: {},
          ratios: {},
        }}
        spec={SPECS['sampler']!}
        name="SAMPLER"
        loud={false}
        cabledIn={() => false}
        cabledOut={() => false}
        act={act}
        sample={{ path: 'a.wav', missing: false, peaks: new Float32Array(512), hits: [] }}
      />
    ));
    const box = container.querySelector('.sr-wave-box') as HTMLElement;
    box.getBoundingClientRect = () => ({ left: 0, width: 200, top: 0, height: 60 }) as DOMRect;
    return box;
  };
  const ptr = (type: string, clientX: number) =>
    new PointerEvent(type, { clientX, pointerId: 1, button: 0, bubbles: true });
  const box = mount(0);
  box.dispatchEvent(ptr('pointerdown', 100));
  box.dispatchEvent(ptr('pointerup', 100));
  expect(calls).toEqual(['knob start 0.50']);
  calls.length = 0;
  box.dispatchEvent(ptr('pointerdown', 20));
  box.dispatchEvent(ptr('pointermove', 60));
  box.dispatchEvent(ptr('pointerup', 60));
  expect(calls).toEqual([
    'fixed scrub 0.10',
    'knob start 0.10',
    'fixed scrub 0.30',
    'knob start 0.30',
    'fixed scrub -1.00',
  ]);
  expect([...keys].filter(Boolean)).toHaveLength(1);
  calls.length = 0;
  const slice = mount(2);
  slice.dispatchEvent(ptr('pointerdown', 100));
  slice.dispatchEvent(ptr('pointerup', 100));
  slice.dispatchEvent(ptr('pointerdown', 100));
  slice.dispatchEvent(ptr('pointerup', 100));
  expect(calls).toEqual(['fixed play 1.50', 'fixed play 2.50']);
});

test('a knob cell wears `dragging` while its knob is dragged, a field `editing` while it is dragged', async () => {
  const { container } = oscPanel();
  const cell = container.querySelector('[data-knob=freq]')!;
  const knob = cell.querySelector('.sr-knob')!;
  (knob as HTMLElement).setPointerCapture = () => {};
  expect(cell.classList.contains('dragging')).toBe(false);
  knob.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, clientY: 100 }));
  expect(cell.classList.contains('dragging')).toBe(true);
  knob.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
  expect(cell.classList.contains('dragging')).toBe(false);
  const field = container.querySelector('[data-field]')!;
  expect(field).not.toBeNull();
  {
    field.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    expect(field.classList.contains('editing')).toBe(true);
    window.dispatchEvent(new PointerEvent('pointerup'));
    expect(field.classList.contains('editing')).toBe(false);
  }
});
