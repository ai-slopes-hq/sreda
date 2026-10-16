import { fromKnob, toKnob, type KnobParam, type Merge } from '@sreda/core';
import { createSignal, Show, type JSX } from 'solid-js';
import { track } from '../live';
import { ang, arc, curveGlyph, fmt } from './glyphs';
import { panning } from './wheel';

let strokes = 0;

export interface KnobProps {
  param: KnobParam;
  /** position 0…1 */
  value: number;
  x: number;
  y: number;
  /** the module this knob belongs to (wheel runs merge per module and knob) */
  scope: string;
  /** a cable is in this knob's mod jack */
  modulated: boolean;
  /** the mod jack's attenuverter (drawn as a ring) */
  depth: number;
  loud: boolean;
  /** readout offset of the knob's modulated position, when audio runs */
  readout?: number | undefined;
  set(knob: number, merge: Merge): void;
  /** Alt-drag on a modulated knob sets its mod jack's attenuverter (−1…+1, 0.01 a pixel) */
  setDepth?(value: number, merge: Merge): void;
  edit(on: boolean): void;
}

/** A knob: vertical drag (200 px = full range, Shift ×0.1), wheel 1 % a notch, double-click resets;
 *  Alt-drag on a modulated knob sets the modulation depth. */
export function Knob(props: KnobProps): JSX.Element {
  const [dragging, setDragging] = createSignal(false);
  let start = 0;
  let k0 = 0;
  let key = '';
  let depth = false;
  const p = () => props.param;
  const a = () => ang(props.value);

  function down(e: PointerEvent): void {
    if (e.button !== 0) return;
    e.stopPropagation();
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    start = e.clientY;
    depth = e.altKey && props.modulated;
    k0 = depth ? props.depth : props.value;
    key = `${depth ? 'depth' : 'knob'}:${p().id}:${++strokes}`;
    setDragging(true);
    props.edit(true);
  }
  function move(e: PointerEvent): void {
    if (!key) return;
    if (depth) {
      props.setDepth?.(Math.min(1, Math.max(-1, k0 + (start - e.clientY) * 0.01)), { key, stroke: true });
      return;
    }
    const dk = ((start - e.clientY) / 200) * (e.shiftKey ? 0.1 : 1);
    props.set(Math.min(1, Math.max(0, k0 + dk)), { key, stroke: true });
  }
  function up(): void {
    if (!key) return;
    key = '';
    setDragging(false);
    props.edit(false);
  }
  function wheel(e: WheelEvent): void {
    if (panning()) return; // let a pan in progress go on
    e.preventDefault();
    e.stopPropagation();
    const pr = p();
    const notch = pr.step ? pr.step / (pr.max - pr.min) : 0.01;
    const dir = e.deltaY < 0 ? 1 : -1;
    props.set(Math.min(1, Math.max(0, props.value + dir * notch)), { key: `wheel:${props.scope}:${pr.id}` });
  }

  return (
    <div class="sr-cell" classList={{ dragging: dragging() }} data-knob={p().id} style={{ left: props.x + 'px', top: props.y + 'px' }}>
      <div
        class="sr-knob"
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        onWheel={wheel}
        onDblClick={() => props.set(toKnob(p(), p().def), undefined)}
      >
        <svg width="56" height="44" viewBox="0 0 56 44" style={{ display: 'block', overflow: 'visible' }}>
          <path class="k-track" d={arc(0, 1, 14)} />
          <Show when={props.modulated}>
            <path
              class="k-ring"
              d={arc(
                Math.max(0, props.value - Math.abs(props.depth)),
                Math.min(1, props.value + Math.abs(props.depth)),
                18,
              )}
            />
          </Show>
          <path class="k-arc" d={arc(0, props.value, 14)} />
          <circle class="k-body" cx="28" cy="22" r="9.5" />
          <line
            class="k-ptr"
            x1="28"
            y1="22"
            x2={(28 + 7 * Math.sin(a())).toFixed(2)}
            y2={(22 - 7 * Math.cos(a())).toFixed(2)}
          />
          <Show when={props.modulated}>
            <g
              ref={(el) => track(el, 'modDot', () => props.readout)}
              transform={`rotate(${(-135 + 270 * props.value).toFixed(1)} 28 22)`}
            >
              <circle class="k-tick" cx="28" cy="4" r="2.2" />
            </g>
          </Show>
        </svg>
      </div>
      <div class="sr-clabel">{p().label}</div>
      <div class="sr-cval" data-value style={{ color: props.modulated ? 'var(--role-mod)' : undefined }}>
        <Show when={props.loud || props.modulated}>
          <Show when={p().glyph === 'curve'} fallback={fmt(p(), fromKnob(p(), props.value))}>
            <svg class="g-svg" width="22" height="9">
              <path class="g-wave" d={curveGlyph(fromKnob(p(), props.value))} />
            </svg>
          </Show>
        </Show>
      </div>
    </div>
  );
}
