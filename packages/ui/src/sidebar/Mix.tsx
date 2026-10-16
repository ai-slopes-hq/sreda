import { blockOwner, toKnob, type KnobParam, type Merge, type Specs } from '@sreda/core';
import { createMemo, For, Show, type JSX } from 'solid-js';
import { track } from '../live';
import type { SessionApi } from '../store';
import { SideFooter } from './SideField';
import { mixStrips } from './strips';

let strokes = 0;
/** the fader's travel in pixels: a drag over it is the whole range */
const TRAVEL = 200;
const clamp = (v: number): number => Math.min(1, Math.max(0, v));

/**
 * A horizontal fader: drag right to raise (the whole travel is the range, Shift ×0.1), double-click resets, the wheel
 * moves it 1 % a notch. Its value reads at the right.
 */
function Fader(props: { value: number; label: string; set(v: number, merge: Merge): void; reset(): void }): JSX.Element {
  let start = 0;
  let v0 = 0;
  let key = '';
  return (
    <div class="sr-fd">
      <div
        class="sr-fader"
        role="slider"
        aria-label={props.label}
        aria-orientation="horizontal"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(props.value * 100)}
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          e.stopPropagation();
          e.currentTarget.setPointerCapture?.(e.pointerId);
          start = e.clientX;
          v0 = props.value;
          key = `fader:${props.label}:${++strokes}`;
        }}
        onPointerMove={(e) => {
          if (!key) return;
          const dv = ((e.clientX - start) / TRAVEL) * (e.shiftKey ? 0.1 : 1);
          props.set(clamp(v0 + dv), { key, stroke: true });
        }}
        onPointerUp={() => (key = '')}
        onPointerCancel={() => (key = '')}
        onWheel={(e) => {
          e.preventDefault();
          props.set(clamp(props.value + (e.deltaY < 0 ? 0.01 : -0.01)), { key: `fader-wheel:${props.label}` });
        }}
        onDblClick={() => props.reset()}
      >
        <div class="sr-fader-fill" style={{ width: props.value * 100 + '%' }} />
        <div class="sr-fader-cap" style={{ left: props.value * 100 + '%' }} />
      </div>
      <span class="sr-fader-v">{props.value.toFixed(2)}</span>
    </div>
  );
}

/** A level bar over its dB scale (−48 … 0). One bar; stereo comes with Plan 17. */
function Meter(props: { offset(): number | undefined }): JSX.Element {
  return (
    <div class="sr-mt">
      <div class="sr-smeter">
        <div ref={(el) => track(el, 'meterDb', props.offset)} />
      </div>
      <div class="sr-mt-s">
        <span>−48</span>
        <span>−24</span>
        <span>−12</span>
        <span>−6</span>
        <span>0 dB</span>
      </div>
    </div>
  );
}

/**
 * MIX (spec §5a, §1b): a flat card per OUT — name and `from <source>`, M / S, a horizontal fader (LVL), a level meter —
 * then the master pinned at the bottom. A click on a name selects the OUT and frames it (an OUT in a collapsed
 * frame: the outermost such frame, which is what shows).
 */
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
    <>
      <div class="sr-mix">
        <div class="sr-mixlist">
          <For each={strips()}>
            {(strip) => (
              <div class="sr-strip" classList={{ muted: strip.muted }} data-out={strip.id}>
                <div class="sr-st-h">
                  <button
                    class="sr-sname"
                    title="select"
                    onClick={() => props.focus(blockOwner(st.doc, strip.id) ?? strip.id)}
                  >
                    {strip.name}
                  </button>
                  <Show when={strip.source}>
                    <span class="sr-st-s">from {strip.source}</span>
                  </Show>
                  <div class="sr-ms">
                    <button
                      aria-label={'Mute ' + strip.name}
                      classList={{ on: !!mod(strip.id)?.params['mute'] }}
                      onClick={() => s.params(strip.id, { mute: mod(strip.id)?.params['mute'] ? 0 : 1 }, undefined)}
                    >
                      M
                    </button>
                    <button
                      aria-label={'Solo ' + strip.name}
                      classList={{ on: !!mod(strip.id)?.params['solo'] }}
                      onClick={() => s.params(strip.id, { solo: mod(strip.id)?.params['solo'] ? 0 : 1 }, undefined)}
                    >
                      S
                    </button>
                  </div>
                </div>
                <Fader
                  label={'LVL ' + strip.id}
                  value={mod(strip.id)?.params['level'] ?? level().def}
                  set={(v, merge) => s.knob(strip.id, 'level', v, merge)}
                  reset={() => s.knob(strip.id, 'level', toKnob(level(), level().def), undefined)}
                />
                <Meter offset={meterOffset(strip.id)} />
              </div>
            )}
          </For>
          <Show when={strips().length <= 1}>
            <div class="sr-note">
              One strip per <b>OUT</b> module. Add another OUT to give a voice its own strip, mute and solo.
            </div>
          </Show>
        </div>
        <div class="sr-strip master" data-master>
          <div class="sr-st-h">
            <div class="sr-sname">MASTER</div>
          </div>
          <Fader
            label="MASTER"
            value={st.doc.master}
            set={(v, merge) => s.setMaster(v, merge)}
            reset={() => s.setMaster(1, undefined)}
          />
          <Meter offset={() => (st.audio ? 1 : undefined)} />
        </div>
      </div>
      <SideFooter>
        <span>after the limiter</span>
      </SideFooter>
    </>
  );
}
