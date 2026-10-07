import { fromKnob, toKnob, type KnobParam, type Merge } from '@sreda/core';
import { createSignal, Show, type JSX } from 'solid-js';
import { track } from '../live';
import { ang, arc, fmt } from './glyphs';

let strokes = 0;

export interface KnobProps {
  param: KnobParam;
  /** position 0…1 */
  value: number;
  x: number;
  y: number;
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
  const [, setDragging] = createSignal(false);
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
    e.preventDefault();
    e.stopPropagation();
    const pr = p();
    const notch = pr.step ? pr.step / (pr.max - pr.min) : 0.01;
    const dir = e.deltaY < 0 ? 1 : -1;
    props.set(Math.min(1, Math.max(0, props.value + dir * notch)), { key: `wheel:${pr.id}` });
  }

  return (
    <div class="sr-cell" data-knob={p().id} style={{ left: props.x + 'px', top: props.y + 'px' }}>
      <div
        class="sr-knob"
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        onWheel={wheel}
        onDblClick={() => props.set(toKnob(p(), p().def), undefined)}
      >
        <svg width="56" height="40" viewBox="0 0 48 34" style={{ display: 'block', overflow: 'visible' }}>
          <path class="k-track" d={arc(0, 1, 11)} />
          <Show when={props.modulated}>
            <path
              class="k-ring"
              d={arc(
                Math.max(0, props.value - Math.abs(props.depth)),
                Math.min(1, props.value + Math.abs(props.depth)),
                15,
              )}
            />
          </Show>
          <path class="k-arc" d={arc(0, props.value, 11)} />
          <line
            class="k-ptr"
            x1="24"
            y1="17"
            x2={(24 + 8 * Math.sin(a())).toFixed(2)}
            y2={(17 - 8 * Math.cos(a())).toFixed(2)}
          />
          <Show when={props.modulated}>
            <g
              ref={(el) => track(el, 'modDot', () => props.readout)}
              transform={`rotate(${(-135 + 270 * props.value).toFixed(1)} 24 17)`}
            >
              <circle class="k-tick" cx="24" cy="2" r="2.2" />
            </g>
          </Show>
        </svg>
      </div>
      <div class="sr-clabel">{p().label}</div>
      <div class="sr-cval" data-value style={{ color: props.modulated ? '#6cb4ee' : undefined }}>
        {props.loud || props.modulated ? fmt(p(), fromKnob(p(), props.value)) : ''}
      </div>
    </div>
  );
}
