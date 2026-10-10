// META-SEQ's editor (spec §7b): a drawer docked under the canvas at the window's full width. The header (name,
// pattern tabs, COPY / PASTE, SCALE, ROOT, GEN, DICE, MUTATE, ✕), then one row per lane on one step grid in clock time.
// This is the shell: the tabs choose the edited pattern and ✕ closes; the rest is drawn but inert for now.
import {
  fromKnob,
  laneLen,
  laneLocked,
  laneRate,
  laneSteps,
  LANES,
  nameOf,
  noteMode,
  type KnobParam,
  type Lane,
  type OptionParam,
  type Specs,
} from '@sreda/core';
import { createEffect, createMemo, createSignal, For, Index, onCleanup, onMount, Show, type JSX } from 'solid-js';
import { readoutBuffer, track } from '../live';
import type { SessionApi } from '../store';
import { cells } from './grid';
import './seq.css';

export interface DrawerProps {
  session: SessionApi;
  specs: Specs;
  /** the META-SEQ shown */
  id: string;
}

const LANE_NAME: Record<Lane, string> = { n: 'NOTE', g: 'GATE', t: 'TIE', a: 'ACC', v: 'VEL', c: 'CHNC' };
const NOTES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
/** clock steps the grid shows */
const WINDOW = 16;
const MIN_H = 160;

export function Drawer(props: DrawerProps): JSX.Element {
  const s = props.session;
  const st = s.state;
  const spec = () => props.specs['metaseq']!;
  const mod = () => st.doc.modules.find((m) => m.id === props.id);
  const params = (): Record<string, number> => mod()?.params ?? {};
  const option = (id: string) => spec().params.find((p): p is OptionParam => p.kind === 'option' && p.id === id);
  const knob = (id: string) => spec().params.find((p): p is KnobParam => p.kind === 'knob' && p.id === id);
  const optionLabel = (id: string): string => {
    const p = option(id);
    return p ? (p.options[params()[id] ?? p.def] ?? '') : '';
  };
  const knobValue = (id: string): number => {
    const p = knob(id);
    if (!p) return 0;
    const k = params()[id];
    return k === undefined ? p.def : fromKnob(p, k);
  };

  const edited = () => params()['edit'] ?? 0;
  const knobPattern = () => Math.max(0, Math.min(7, Math.round(knobValue('pat'))));
  /** the pattern the engine plays (from the readout); the PAT knob until one is read */
  const [playing, setPlaying] = createSignal<number | undefined>(undefined);
  const playingPattern = () => playing() ?? knobPattern();

  // ── the grid's width, measured ──
  const [gridW, setGridW] = createSignal(0);
  let gridEl: HTMLDivElement | undefined;
  onMount(() => {
    const measure = () => gridEl && setGridW(gridEl.clientWidth);
    measure();
    if (typeof ResizeObserver === 'function' && gridEl) {
      const ro = new ResizeObserver(measure);
      ro.observe(gridEl);
      onCleanup(() => ro.disconnect());
    } else {
      window.addEventListener('resize', measure);
      onCleanup(() => window.removeEventListener('resize', measure));
    }
  });

  const lanes = createMemo(() =>
    LANES.map((l) => {
      const p = edited();
      const len = laneLen(params(), p, l);
      const rate = laneRate(params(), p, l);
      return {
        l,
        len,
        rate,
        locked: laneLocked(params(), p, l),
        steps: laneSteps(params(), p, l),
        cells: cells(len, rate, WINDOW, gridW()),
      };
    }),
  );

  // ── live: the playing pattern and each lane's cursor, written straight to the cursor elements ──
  const cursors: SVGRectElement[] = [];
  const traceAt = (): number | undefined => {
    if (!st.audio) return undefined;
    const node = s.nodeOf(props.id);
    return node === null ? undefined : (s.layout().nodes[node]?.trace ?? undefined);
  };
  const frame = (off: number): void => {
    const buf = readoutBuffer();
    if (!buf) return;
    const pat = Math.max(0, Math.min(7, Math.round(buf[off] ?? 0)));
    if (pat !== playing()) setPlaying(pat);
    const shown = pat === edited();
    const ls = lanes();
    for (let l = 0; l < 6; l++) {
      const el = cursors[l];
      const lane = ls[l];
      if (!el || !lane) continue;
      const k = Math.round(buf[off + 1 + l] ?? -1);
      const c = k >= 0 && k < lane.len ? lane.cells[k] : undefined;
      if (!shown || !c) {
        el.setAttribute('visibility', 'hidden');
        continue;
      }
      el.setAttribute('visibility', 'visible');
      el.setAttribute('x', String(c.x));
      el.setAttribute('width', String(Math.max(1, c.w)));
    }
  };
  // no readout: no cursors
  createEffect(() => {
    if (traceAt() === undefined) {
      setPlaying(undefined);
      for (const el of cursors) el?.setAttribute('visibility', 'hidden');
    }
  });

  // ── the top edge: drag the height ──
  function gripDown(e: PointerEvent): void {
    if (e.button !== 0) return;
    e.preventDefault();
    const move = (ev: PointerEvent) =>
      s.seqHeight(Math.round(Math.min(innerHeight * 0.7, Math.max(MIN_H, innerHeight - ev.clientY))));
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  const cellValue = (l: Lane, v: number): { y: string; h: string } => {
    if (l === 'n') {
      const y = 1 - Math.min(24, Math.max(0, v)) / 24;
      return { y: `${(y * 85 + 5).toFixed(1)}%`, h: '10%' };
    }
    const k = Math.min(1, Math.max(0, v));
    return { y: `${((1 - k) * 100).toFixed(1)}%`, h: `${(k * 100).toFixed(1)}%` };
  };

  return (
    <section class="sr-drawer" data-seq={props.id} style={{ height: st.seq.h + 'px' }}>
      <div class="sr-drawer-grip" onPointerDown={gripDown} />
      <header class="sr-drawer-head">
        <span class="sr-drawer-name">{nameOf(st.doc, props.specs, props.id)}</span>
        <div class="sr-drawer-tabs">
          <For each={['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']}>
            {(t, i) => (
              <button
                class="sr-gbtn sr-drawer-tab"
                classList={{ on: edited() === i(), play: playingPattern() === i() }}
                data-pattern={t}
                onClick={() => s.params(props.id, { edit: i() }, undefined)}
              >
                {t}
              </button>
            )}
          </For>
        </div>
        <button class="sr-gbtn">COPY</button>
        <button class="sr-gbtn">PASTE</button>
        <span class="sr-drawer-field">
          SCALE <b>{optionLabel('scale')} ▾</b>
        </span>
        <span class="sr-drawer-field">
          ROOT <b>{NOTES[Math.round(knobValue('root')) % 12]}</b>
        </span>
        <span class="sr-drawer-field">
          GEN <b>{optionLabel('gen')} ▾</b>
        </span>
        <button class="sr-gbtn">DICE</button>
        <span class="sr-drawer-field">
          MUTATE <b>{Math.round(knobValue('mut') * 100)}%</b>
        </span>
        <button class="sr-gbtn sr-drawer-close" title="Close (Esc)" onClick={() => s.closeSeq()}>
          ✕
        </button>
      </header>
      <div class="sr-drawer-body">
        <Index each={lanes()}>
          {(lane, li) => (
            <div class="sr-lane" data-lane={lane().l}>
              <div class="sr-lane-head">
                <span class="sr-lane-name">{LANE_NAME[lane().l]}</span>
                <span class="sr-lane-field" title="LEN">
                  {lane().len}
                </span>
                <span class="sr-lane-field" title="RATE">
                  {option(`${'abcdefgh'[edited()]}${lane().l}rate`)?.options[lane().rate] ?? ''}
                </span>
                <Show when={lane().l === 'n'}>
                  <span class="sr-lane-field">{noteMode(params(), edited()) ? 'STEP' : 'PLAYED'}</span>
                </Show>
                <span class="sr-lane-btn" classList={{ on: lane().locked }} title="lock">
                  🔒
                </span>
                <span class="sr-lane-btn" title="DICE this lane">
                  ⚄
                </span>
              </div>
              <div class="sr-lane-grid" ref={(el) => li === 0 && (gridEl = el)}>
                <svg width={gridW()} class={`sr-lane-svg lane-${lane().l}`}>
                  <For each={lane().cells}>
                    {(c) => {
                      const v = () => cellValue(lane().l, lane().steps[c.step] ?? 0);
                      return (
                        <g classList={{ ghost: c.ghost }}>
                          <rect class="sr-step" x={c.x + 1} y="0" width={Math.max(1, c.w - 2)} height="100%" />
                          <Show
                            when={lane().l === 'n' || lane().l === 'v' || lane().l === 'c'}
                            fallback={
                              <Show when={(lane().steps[c.step] ?? 0) >= 0.5}>
                                <rect class="sr-step-on" x={c.x + 3} y="20%" width={Math.max(1, c.w - 6)} height="60%" />
                              </Show>
                            }
                          >
                            <rect class="sr-step-val" x={c.x + 3} y={v().y} width={Math.max(1, c.w - 6)} height={v().h} />
                          </Show>
                        </g>
                      );
                    }}
                  </For>
                  <rect
                    class="sr-lane-cur"
                    visibility="hidden"
                    x="0"
                    y="0"
                    width="1"
                    height="100%"
                    ref={(el) => (cursors[li] = el)}
                  />
                  <Show when={li === 0}>
                    <g ref={(el) => track(el, 'tick', traceAt, frame)} />
                  </Show>
                </svg>
              </div>
            </div>
          )}
        </Index>
      </div>
    </section>
  );
}
