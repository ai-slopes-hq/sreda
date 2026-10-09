import type { OptionParam } from '@sreda/core';
import { createSignal, For, onCleanup, Show, type JSX } from 'solid-js';
import type { Merge } from '@sreda/core';
import { SCALES } from '@sreda/core';
import { readoutBuffer, track } from '../live';
import { responseGlyph, scaleGlyph, waveGlyph } from './glyphs';
import { panning } from './wheel';

export interface OptionProps {
  param: OptionParam;
  value: number;
  x: number;
  y: number;
  w: number;
  /** bumps when the canvas pans or zooms: an open list closes */
  closeEpoch: number;
  /** the module this option belongs to (wheel runs merge per module and option) */
  scope: string;
  set(value: number, merge?: Merge): void;
  /**
   * FILTER's response glyph follows the filter: `cut` / `res` from the knobs (0…1), and while audio runs the readout
   * offsets of the live cutoff (the module's state) and of RES's modulated knob
   */
  live?: { cut: number; res: number; state: number | undefined; res_knob: number | undefined } | undefined;
}

/** An option value drawn as its shape: a waveform, or a scale's 12 semitones; else its name. */
function Glyph(props: {
  param: OptionParam;
  value: number;
  big: boolean;
  live?: OptionProps['live'] | undefined;
}): JSX.Element {
  const w = () => (props.big ? 30 : 24);
  const model = () => props.param.options[props.value]!;
  const at = () => (props.live ? { cut: props.live.cut, res: props.live.res } : undefined);
  let path: SVGPathElement | undefined;
  /** every frame while audio runs: the live cutoff and RES */
  const follow = (off: number) => {
    const buf = readoutBuffer();
    const k = props.live?.res_knob;
    if (!buf || !path || k === undefined) return;
    path.setAttribute('d', responseGlyph(model(), w(), { cut: buf[off] ?? 0.5, res: buf[k] ?? 0 }));
  };
  const scale = () => scaleGlyph(SCALES[props.value] ?? [], props.big);
  return (
    <Show
      when={props.param.glyph !== 'response'}
      fallback={
        <svg class="g-svg" width={w()} height="12">
          <path
            class="g-wave"
            ref={(el) => {
              path = el;
              track(el, 'tick', () => props.live?.state, follow);
            }}
            d={responseGlyph(model(), w(), at())}
          />
        </svg>
      }
    >
      <Show
        when={props.param.glyph === 'wave'}
        fallback={
          <Show
            when={props.param.glyph === 'scale'}
            fallback={<span>{props.param.options[props.value]}</span>}
          >
            <svg class="g-svg" width={scale().w} height="12">
              <path class="g-on" d={scale().on} />
              <path class="g-off" d={scale().off} />
            </svg>
          </Show>
        }
      >
        <svg class="g-svg" width={w()} height="12">
          <path class="g-wave" d={waveGlyph(props.param.options[props.value]!, w())} />
        </svg>
      </Show>
    </Show>
  );
}

/** A mode-strip button: two values toggle; three or more open a small list anchored under the cell. */
export function Option(props: OptionProps): JSX.Element {
  const [open, setOpen] = createSignal(false);
  const p = () => props.param;
  const toggle = () => p().options.length === 2 && p().options[0] === 'OFF' && p().options[1] === 'ON';
  let epoch = props.closeEpoch;

  const outside = (e: PointerEvent) => {
    if (!(e.target as Element).closest?.(`[data-option="${p().id}"]`)) setOpen(false);
  };
  const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
  document.addEventListener('pointerdown', outside, true);
  document.addEventListener('keydown', esc);
  onCleanup(() => {
    document.removeEventListener('pointerdown', outside, true);
    document.removeEventListener('keydown', esc);
  });

  const isOpen = () => {
    if (props.closeEpoch !== epoch) {
      epoch = props.closeEpoch;
      setOpen(false);
    }
    return open();
  };

  function click(e: MouseEvent): void {
    e.stopPropagation();
    if (p().options.length === 2) props.set(1 - props.value);
    else setOpen(!open());
  }
  function wheel(e: WheelEvent): void {
    if (panning()) return; // let a pan in progress go on
    e.preventDefault();
    e.stopPropagation();
    const n = p().options.length;
    props.set((props.value + (e.deltaY < 0 ? 1 : n - 1)) % n, { key: `wheel:${props.scope}:${p().id}` });
  }

  return (
    <div
      class="sr-cell sr-mode"
      data-option={p().id}
      style={{ left: props.x + 'px', top: props.y + 'px', width: props.w + 'px' }}
    >
      <button
        class="sr-opt"
        classList={{ on: toggle() && props.value === 1 }}
        style={{ width: props.w - 8 + 'px' }}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={click}
        onWheel={wheel}
        aria-haspopup={p().options.length > 2 ? 'listbox' : undefined}
        aria-label={`${p().label} ${p().options[props.value]}`}
      >
        <Show when={!toggle()} fallback={p().label}>
          <Glyph param={p()} value={props.value} big={false} live={props.live} />
          <Show when={p().options.length > 2}>
            <span class="caret">▾</span>
          </Show>
        </Show>
      </button>
      <Show when={isOpen()}>
        <div class="sr-menu" role="listbox" onPointerDown={(e) => e.stopPropagation()}>
          <For each={p().options}>
            {(name, i) => (
              <button
                class="sr-mitem"
                classList={{ on: i() === props.value }}
                onClick={(e) => {
                  e.stopPropagation();
                  props.set(i());
                  setOpen(false);
                }}
              >
                <Show when={p().glyph}>
                  <Glyph param={p()} value={i()} big={true} />
                </Show>
                {name}
              </button>
            )}
          </For>
        </div>
      </Show>
    </div>
  );
}
