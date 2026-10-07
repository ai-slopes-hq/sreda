import { euclid } from '@sreda/core';
import { For, type JSX } from 'solid-js';
import { track } from '../../live';

export interface PadsProps {
  x: number;
  y: number;
  w: number;
  h: number;
  /** the module's params: g1–16 (0 off, 1 on, 2 tie), a1–16, mode (0 EUCLID, 1 GRID) */
  params: Record<string, number>;
  len: number;
  hits: number;
  rot: number;
  /** the readout offset of the current step */
  state: number | undefined;
  edit(changes: Record<string, number>): void;
}

/** RHYTHM's 16 pads in two rows of eight, an accent strip under each (spec §7). */
export function Pads(props: PadsProps): JSX.Element {
  const euclidMode = () => (props.params['mode'] ?? 0) === 0;
  const pattern = () => euclid(props.len, props.hits, props.rot);
  /** 0 off, 1 on, 2 tie as it sounds now */
  const gate = (k: number) =>
    euclidMode() ? (k < props.len && pattern()[k] ? 1 : 0) : (props.params['g' + (k + 1)] ?? 0);
  const pitch = () => (props.w + 6) / 8;
  const padW = () => pitch() - 6;

  function clickPad(k: number): void {
    const changes: Record<string, number> = {};
    if (euclidMode()) {
      // touching a pad turns the live euclid pattern into a grid first
      for (let i = 0; i < 16; i++) changes['g' + (i + 1)] = i < props.len && pattern()[i] ? 1 : 0;
      changes['mode'] = 1;
    }
    const now = changes['g' + (k + 1)] ?? props.params['g' + (k + 1)] ?? 0;
    changes['g' + (k + 1)] = (now + 1) % 3; // OFF → ON → TIE
    props.edit(changes);
  }

  return (
    <div
      class="sr-disp sr-pads"
      style={{ left: props.x + 'px', top: props.y + 'px', width: props.w + 'px', height: props.h + 'px' }}
      ref={(el) => track(el, 'step', () => props.state)}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <For each={Array.from({ length: 16 }, (_, k) => k)}>
        {(k) => {
          const left = () => (k % 8) * pitch();
          const top = Math.floor(k / 8) * 62;
          return (
            <>
              <div
                class="sr-pad"
                data-step={k}
                classList={{
                  on: gate(k) === 1,
                  tie: gate(k) === 2,
                  euclid: euclidMode(),
                  past: k >= props.len,
                }}
                style={{ left: left() + 'px', top: top + 'px', width: padW() + 'px' }}
                onClick={() => clickPad(k)}
              >
                {k + 1}
              </div>
              <div
                class="sr-acc"
                classList={{ on: (props.params['a' + (k + 1)] ?? 0) === 1, past: k >= props.len }}
                style={{ left: left() + 'px', top: top + 48 + 'px', width: padW() + 'px' }}
                onClick={() => props.edit({ ['a' + (k + 1)]: 1 - (props.params['a' + (k + 1)] ?? 0) })}
              />
            </>
          );
        }}
      </For>
    </div>
  );
}
