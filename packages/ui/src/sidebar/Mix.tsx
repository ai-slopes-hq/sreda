import { blockOwner, toKnob, type KnobParam, type Merge, type Specs } from '@sreda/core';
import { createMemo, For, type JSX } from 'solid-js';
import { track } from '../live';
import type { SessionApi } from '../store';
import { mixStrips } from './strips';

let strokes = 0;
/** the fader's travel in pixels: a drag over it is the whole range */
const TRAVEL = 120;

/**
 * A vertical fader: drag up / down (the whole travel is the range, Shift ×0.1), double-click resets, the wheel moves
 * it 1 % a notch.
 */
function Fader(props: { value: number; label: string; set(v: number, merge: Merge): void; reset(): void }): JSX.Element {
  let start = 0;
  let v0 = 0;
  let key = '';
  return (
    <div
      class="sr-fader"
      role="slider"
      aria-label={props.label}
      aria-valuenow={Math.round(props.value * 100)}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.stopPropagation();
        e.currentTarget.setPointerCapture?.(e.pointerId);
        start = e.clientY;
        v0 = props.value;
        key = `fader:${props.label}:${++strokes}`;
      }}
      onPointerMove={(e) => {
        if (!key) return;
        const dv = ((start - e.clientY) / TRAVEL) * (e.shiftKey ? 0.1 : 1);
        props.set(Math.min(1, Math.max(0, v0 + dv)), { key, stroke: true });
      }}
      onPointerUp={() => (key = '')}
      onPointerCancel={() => (key = '')}
      onWheel={(e) => {
        e.preventDefault();
        props.set(Math.min(1, Math.max(0, props.value + (e.deltaY < 0 ? 0.01 : -0.01))), {
          key: `fader-wheel:${props.label}`,
        });
      }}
      onDblClick={() => props.reset()}
    >
      <div class="sr-fader-fill" style={{ height: props.value * 100 + '%' }} />
      <div class="sr-fader-cap" style={{ bottom: `calc(${props.value * 100}% - 2px)` }} />
    </div>
  );
}

/** MIX (spec §5a): a strip per OUT — name, fader (LVL), meter, M / S — and the master. A click on a name selects the OUT
 * and frames it (an OUT in a collapsed frame: the outermost such frame, which is what shows). */
export function Mix(props: { session: SessionApi; specs: Specs; focus(id: string): void }): JSX.Element {
  const s = props.session;
  const st = s.state;
  const strips = createMemo(() => mixStrips(st.doc, props.specs));
  const level = () => props.specs['out']!.params.find((p): p is KnobParam => p.id === 'level')!;
  const mod = (id: string) => st.doc.modules.find((m) => m.id === id);
  const meterOffset = (id: string) => () => {
    const node = st.audio ? s.nodeOf(id) : null;
    return node === null ? undefined : s.layout().nodes[node]?.state;
  };
  return (
    <div class="sr-mix">
      <For each={strips()}>
        {(strip) => (
          <div class="sr-strip" classList={{ muted: strip.muted }} data-out={strip.id}>
            <button class="sr-sname" title="select"
              onClick={() => props.focus(blockOwner(st.doc, strip.id) ?? strip.id)}
            >
              {strip.name}
            </button>
            <Fader
              label={'LVL ' + strip.id}
              value={mod(strip.id)?.params['level'] ?? level().def}
              set={(v, merge) => s.knob(strip.id, 'level', v, merge)}
              reset={() => s.knob(strip.id, 'level', toKnob(level(), level().def), undefined)}
            />
            <div class="sr-smeter">
              <div ref={(el) => track(el, 'meter', meterOffset(strip.id))} />
            </div>
            <div class="sr-sbtns">
              <button
                class="sr-gbtn"
                classList={{ on: !!mod(strip.id)?.params['mute'] }}
                onClick={() => s.params(strip.id, { mute: mod(strip.id)?.params['mute'] ? 0 : 1 }, undefined)}
              >
                M
              </button>
              <button
                class="sr-gbtn"
                classList={{ on: !!mod(strip.id)?.params['solo'] }}
                onClick={() => s.params(strip.id, { solo: mod(strip.id)?.params['solo'] ? 0 : 1 }, undefined)}
              >
                S
              </button>
            </div>
          </div>
        )}
      </For>
      <div class="sr-strip master" data-master>
        <div class="sr-sname">MASTER</div>
        <Fader
          label="MASTER"
          value={st.doc.master}
          set={(v, merge) => s.setMaster(v, merge)}
          reset={() => s.setMaster(1, undefined)}
        />
        <div class="sr-smeter">
          <div ref={(el) => track(el, 'meter', () => (st.audio ? 1 : undefined))} />
        </div>
      </div>
    </div>
  );
}
