// One lane row of META-SEQ's drawer (spec §7b): its head (name, LEN, RATE, STEP / PLAYED, lock, ⚄) and its cells on
// the drawer's step grid. Gestures: NOTE press-drag draws notes snapped to SCALE from ROOT; GATE / TIE / ACC a click
// toggles, a drag paints the first cell's new value; VEL / CHNC press-drag draws bars, a double-click restores 1;
// LEN is the end marker's drag or the wheel over LEN. A stroke is one undo step (one merge key); ghosts are not edited.
import {
  laneLen,
  laneLocked,
  laneParam,
  laneRate,
  laneSteps,
  LANES,
  noteMode,
  noteModeParam,
  snap,
  snapInRange,
  stepId,
  type Lane as LaneId,
  type Merge,
  type ModuleSpec,
  type OptionParam,
} from '@sreda/core';
import { createMemo, Index, Show, type JSX } from 'solid-js';
import { Option } from '../canvas/Option';
import { barAt, cellAt, cells, noteAt, noteBar, stepWidth } from './grid';

export interface LaneProps {
  lane: LaneId;
  /** the edited pattern, 0–7 */
  pattern: number;
  /** the module's params (document units) */
  params: Record<string, number>;
  /** the grid's width in px */
  width: number;
  spec: ModuleSpec;
  /** the module id (wheel runs merge per module and control) */
  scope: string;
  edit(changes: Record<string, number>, merge: Merge): void;
  /** the lane's cursor, moved by the drawer from the readout without a render */
  cursor?: (el: SVGRectElement) => void;
  grid?: (el: HTMLDivElement) => void;
}

export const LANE_NAME: Record<LaneId, string> = {
  n: 'NOTE',
  g: 'GATE',
  t: 'TIE',
  a: 'ACC',
  v: 'VEL',
  c: 'CHNC',
};
export const NOTES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
/** clock steps the grid shows */
export const WINDOW = 16;
const LEN_MAX = 16;
/** two presses on one VEL / CHNC cell this close (ms) are one gesture (a double-click) */
const DOUBLE_MS = 400;
/** the LEN end marker's width in px */
const MARKER_W = 6;

let strokes = 0;

interface Stroke {
  key: string;
  /** GATE / TIE / ACC: the value painted */
  value: number;
  /** the last cell written and its raw value (NOTE: unsnapped semitones) */
  last: number;
  lastRaw: number;
  /** what this stroke wrote, by step index */
  done: Map<number, number>;
}

export function Lane(props: LaneProps): JSX.Element {
  const l = () => props.lane;
  const p = () => props.pattern;
  const toggles = () => l() === 'g' || l() === 't' || l() === 'a';
  const len = () => laneLen(props.params, p(), l());
  const rate = () => laneRate(props.params, p(), l());
  const steps = createMemo(() => laneSteps(props.params, p(), l()));
  const grid = createMemo(() => cells(len(), rate(), WINDOW, props.width));
  const scale = () => props.params['scale'] ?? 2;
  const root = () => Math.round((props.params['root'] ?? 0) * 11);
  const option = (id: string) =>
    props.spec.params.find((x): x is OptionParam => x.kind === 'option' && x.id === id);
  const lenId = () => laneParam(p(), l(), 'len');
  const setLen = (n: number, merge: Merge) => {
    const k = Math.min(LEN_MAX, Math.max(1, n));
    if (k !== len()) props.edit({ [lenId()]: (k - 1) / (LEN_MAX - 1) }, merge);
  };

  // ── strokes on the cells ──
  let svg: SVGSVGElement | undefined;
  let stroke: Stroke | null = null;
  let lastDown = { k: -1, at: 0, key: '' };
  const local = (e: MouseEvent): { x: number; fy: number } => {
    const r = svg!.getBoundingClientRect();
    return { x: e.clientX - r.left, fy: r.height > 0 ? (e.clientY - r.top) / r.height : 0 };
  };
  /** the pointer's raw value: NOTE semitones (unsnapped), VEL / CHNC 0…1 */
  const rawAt = (fy: number): number => (l() === 'n' ? noteAt(fy) : barAt(fy));
  /** the stored value of a raw one */
  const stored = (raw: number): number =>
    l() === 'n' ? snapInRange(Math.round(raw), scale(), root()) / 24 : raw;

  function paint(s: Stroke, k: number, raw: number): void {
    const changes: Record<string, number> = {};
    const from = s.last < 0 ? k : s.last;
    const dir = k >= from ? 1 : -1;
    for (let i = s.last < 0 ? k : from + dir; dir > 0 ? i <= k : i >= k; i += dir) {
      const t = k === from ? 1 : (i - from) / (k - from);
      const v = toggles() ? s.value : stored(s.lastRaw + (raw - s.lastRaw) * t);
      if (s.done.get(i) === v) continue;
      s.done.set(i, v);
      const id = stepId(p(), l(), i + 1);
      // a step already holding the value (stored or by default) is not written again
      const now = l() === 'n' ? (steps()[i] ?? 0) / 24 : (steps()[i] ?? 0);
      if (props.params[id] !== v && now !== v) changes[id] = v;
    }
    s.last = k;
    s.lastRaw = raw;
    if (Object.keys(changes).length) props.edit(changes, { key: s.key, stroke: true });
  }

  function down(e: PointerEvent): void {
    if (e.button !== 0) return;
    const { x, fy } = local(e);
    const k = cellAt(grid(), x);
    if (k < 0 || grid()[k]!.ghost) return;
    e.preventDefault();
    svg!.setPointerCapture?.(e.pointerId);
    const now = performance.now();
    const again = !toggles() && l() !== 'n' && lastDown.k === k && now - lastDown.at < DOUBLE_MS;
    const key = again ? lastDown.key : `lane:${props.scope}:${l()}:${++strokes}`;
    lastDown = { k, at: now, key };
    const raw = rawAt(fy);
    stroke = {
      key,
      value: (steps()[k] ?? 0) >= 0.5 ? 0 : 1,
      last: -1,
      lastRaw: raw,
      done: new Map(),
    };
    paint(stroke, k, raw);
  }
  function move(e: PointerEvent): void {
    if (!stroke) return;
    const { x, fy } = local(e);
    const at = cellAt(grid(), x);
    const k = at < 0 ? (x < 0 ? 0 : len() - 1) : Math.min(at, len() - 1);
    paint(stroke, Math.min(k, grid().length - 1), rawAt(fy));
  }
  function up(e: PointerEvent): void {
    if (!stroke) return;
    stroke = null;
    if (svg?.hasPointerCapture?.(e.pointerId)) svg.releasePointerCapture(e.pointerId);
  }
  function dbl(e: MouseEvent): void {
    if (l() !== 'v' && l() !== 'c') return;
    const k = cellAt(grid(), local(e).x);
    if (k < 0 || grid()[k]!.ghost) return;
    const key = lastDown.k === k && lastDown.key ? lastDown.key : `lane:${props.scope}:${l()}:${++strokes}`;
    props.edit({ [stepId(p(), l(), k + 1)]: 1 }, { key, stroke: true });
  }

  // ── LEN: the end marker ──
  const sw = () => stepWidth(rate(), WINDOW, props.width);
  const end = () => sw() * len();
  /** the marker's 6 px hit area starts just past the last bright cell; past the window it is pinned to the right edge */
  const markerX = () => Math.min(end(), props.width - MARKER_W);
  let lenKey = '';
  function markerDown(e: PointerEvent): void {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    lenKey = `len:${props.scope}:${lenId()}:${++strokes}`;
  }
  function markerMove(e: PointerEvent): void {
    if (!lenKey || !(sw() > 0)) return;
    setLen(Math.round(local(e).x / sw()), { key: lenKey, stroke: true });
  }
  function markerUp(e: PointerEvent): void {
    if (!lenKey) return;
    markerMove(e);
    lenKey = '';
  }
  function lenWheel(e: WheelEvent): void {
    e.preventDefault();
    e.stopPropagation();
    setLen(len() + (e.deltaY < 0 ? 1 : -1), { key: `wheel:${props.scope}:${lenId()}` });
  }

  /** getters, so a params change updates the Option instead of rebuilding it (a stroke edits params every move) */
  const optionCell = (id: () => string, value: () => number, w: number) => (
    <Show when={option(id())}>
      {(prm) => (
        <span class="sr-lane-opt" style={{ width: w + 'px' }}>
          <Option
            param={prm()}
            value={value()}
            x={0}
            y={0}
            w={w}
            closeEpoch={0}
            scope={props.scope}
            set={(v, merge) => props.edit({ [id()]: v }, merge)}
          />
        </span>
      )}
    </Show>
  );

  const name = (v: number) => {
    const s = snap(v, scale(), root());
    return NOTES[((s % 12) + 12) % 12]!;
  };

  return (
    <div class="sr-lane" classList={{ up: LANES.indexOf(l()) >= 3 }} data-lane={l()}>
      <div class="sr-lane-head">
        <span class="sr-lane-name">{LANE_NAME[l()]}</span>
        <span class="sr-lane-field" data-field="len" title="LEN (wheel)" onWheel={lenWheel}>
          {len()}
        </span>
        {optionCell(() => laneParam(p(), l(), 'rate'), rate, 44)}
        <Show when={l() === 'n'}>
          {optionCell(
            () => noteModeParam(p()),
            () => noteMode(props.params, p()),
            60,
          )}
        </Show>
        <button
          class="sr-lane-btn"
          classList={{ on: laneLocked(props.params, p(), l()) }}
          data-lock
          title="Lock: DICE and MUTATE leave this lane"
          onClick={() =>
            props.edit(
              { [laneParam(p(), l(), 'lock')]: laneLocked(props.params, p(), l()) ? 0 : 1 },
              undefined,
            )
          }
        >
          🔒
        </button>
        <span class="sr-lane-btn" title="DICE this lane">
          ⚄
        </span>
      </div>
      <div class="sr-lane-grid" ref={(el) => props.grid?.(el)}>
        <svg
          ref={(el) => (svg = el)}
          width={props.width}
          class={`sr-lane-svg lane-${l()}`}
          onPointerDown={down}
          onPointerMove={move}
          onPointerUp={up}
          onPointerCancel={up}
          onDblClick={dbl}
        >
          <Index each={grid()}>
            {(c) => {
              const v = () => steps()[c().step] ?? 0;
              const x = () => c().x + 3;
              const w = () => Math.max(1, c().w - 6);
              return (
                <g classList={{ ghost: c().ghost }}>
                  <rect class="sr-step" x={c().x + 1} y="0" width={Math.max(1, c().w - 2)} height="100%" />
                  <Show when={l() === 'n'}>
                    <rect
                      class="sr-step-val"
                      x={x()}
                      y={`${(noteBar(v()).y * 100).toFixed(1)}%`}
                      width={w()}
                      height="10%"
                    />
                    <text class="sr-note-name" x={x()} y="100%" dy="-2">
                      {name(v())}
                    </text>
                  </Show>
                  <Show when={l() === 'v' || l() === 'c'}>
                    <rect
                      class="sr-step-val"
                      x={x()}
                      y={`${((1 - Math.min(1, Math.max(0, v()))) * 100).toFixed(1)}%`}
                      width={w()}
                      height={`${(Math.min(1, Math.max(0, v())) * 100).toFixed(1)}%`}
                    />
                  </Show>
                  <Show when={toggles() && v() >= 0.5}>
                    <rect class="sr-step-on" x={x()} y="20%" width={w()} height="60%" />
                  </Show>
                </g>
              );
            }}
          </Index>
          <Show when={props.width > MARKER_W}>
            <rect
              class="sr-len-marker"
              data-len-marker
              x={markerX()}
              y="0"
              width={MARKER_W}
              height="100%"
              onPointerDown={markerDown}
              onPointerMove={markerMove}
              onPointerUp={markerUp}
              onPointerCancel={markerUp}
            />
          </Show>
          <rect
            class="sr-lane-cur"
            visibility="hidden"
            x="0"
            y="0"
            width="1"
            height="100%"
            ref={(el) => props.cursor?.(el)}
          />
        </svg>
      </div>
    </div>
  );
}
