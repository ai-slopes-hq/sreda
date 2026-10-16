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
  /** ⚄: DICE this lane alone (locked or not), one undo step */
  dice?(): void;
  /** the lane's cursor, moved by the drawer from the readout without a render */
  cursor?: (el: SVGRectElement) => void;
  grid?: (el: HTMLDivElement) => void;
}

/** the lock, drawn: no icon for it yet */
function Lock(): JSX.Element {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" aria-label="Lock">
      <rect x="1.75" y="5.25" width="8.5" height="5.5" rx="1.5" fill="currentColor" />
      <path
        d="M3.75 5.25V3.75a2.25 2.25 0 0 1 4.5 0v1.5"
        fill="none"
        stroke="currentColor"
        stroke-width="1.2"
      />
    </svg>
  );
}

/** ⚄ drawn: the drawer's font has no die glyph */
function Die(): JSX.Element {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" aria-label="⚄">
      <rect
        x="0.75"
        y="0.75"
        width="10.5"
        height="10.5"
        rx="2"
        fill="none"
        stroke="currentColor"
        stroke-width="1.2"
      />
      <circle cx="3.75" cy="3.75" r="1" fill="currentColor" />
      <circle cx="8.25" cy="3.75" r="1" fill="currentColor" />
      <circle cx="6" cy="6" r="1" fill="currentColor" />
      <circle cx="3.75" cy="8.25" r="1" fill="currentColor" />
      <circle cx="8.25" cy="8.25" r="1" fill="currentColor" />
    </svg>
  );
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
/** px of vertical drag per step on the LEN field */
const LEN_PX = 8;

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
    // a move inside the last cell rewrites it (a slider: the value follows the pointer until release)
    for (let i = s.last < 0 || k === s.last ? k : from + dir; dir > 0 ? i <= k : i >= k; i += dir) {
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
  /** the LEN field: a vertical drag like a knob, a step per LEN_PX */
  let lenDrag = { key: '', y: 0, n: 0 };
  function fieldDown(e: PointerEvent): void {
    if (e.button !== 0) return;
    e.preventDefault();
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    lenDrag = { key: `len:${props.scope}:${lenId()}:${++strokes}`, y: e.clientY, n: len() };
  }
  function fieldMove(e: PointerEvent): void {
    if (!lenDrag.key) return;
    setLen(lenDrag.n + Math.round((lenDrag.y - e.clientY) / LEN_PX), { key: lenDrag.key, stroke: true });
  }
  function lenWheel(e: WheelEvent): void {
    e.preventDefault();
    e.stopPropagation();
    setLen(len() + (e.deltaY < 0 ? 1 : -1), { key: `wheel:${props.scope}:${lenId()}` });
  }

  /** getters, so a params change updates the Option instead of rebuilding it (a stroke edits params every move) */
  const optionCell = (id: () => string, value: () => number, label?: string) => (
    <Show when={option(id())}>
      {(prm) => (
        <span class="sr-lchip sr-lane-opt">
          <Show when={label}>
            <i>{label}</i>
          </Show>
          <Option
            param={prm()}
            value={value()}
            x={0}
            y={0}
            w={0}
            text
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
        <div class="sr-lane-top">
          <span class="sr-lane-name">{LANE_NAME[l()]}</span>
          <Show when={l() === 'n'}>
            {optionCell(
              () => noteModeParam(p()),
              () => noteMode(props.params, p()),
            )}
          </Show>
          <span class="sr-lane-tools">
            <button
              class="sr-lane-btn"
              classList={{ on: laneLocked(props.params, p(), l()) }}
              data-lock
              title="Lock: Dice and Mutate leave this lane"
              onClick={() =>
                props.edit(
                  { [laneParam(p(), l(), 'lock')]: laneLocked(props.params, p(), l()) ? 0 : 1 },
                  undefined,
                )
              }
            >
              <Lock />
            </button>
            <button
              class="sr-lane-btn sr-lane-dice"
              data-dice
              title="DICE this lane"
              onClick={() => props.dice?.()}
            >
              <Die />
            </button>
          </span>
        </div>
        <div class="sr-lane-chips">
          <span
            class="sr-lchip sr-lane-field"
            title="LEN (drag or wheel)"
            onPointerDown={fieldDown}
            onPointerMove={fieldMove}
            onPointerUp={() => (lenDrag.key = '')}
            onPointerCancel={() => (lenDrag.key = '')}
            onWheel={lenWheel}
          >
            <i>LEN</i>
            <span data-field="len">{len()}</span>
          </span>
          {optionCell(() => laneParam(p(), l(), 'rate'), rate, 'RATE')}
        </div>
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
              const x = () => c().x + 2;
              const w = () => Math.max(1, c().w - 4);
              return (
                <g classList={{ ghost: c().ghost }}>
                  <rect class="sr-step" rx="4" x={x()} y="0" width={w()} height="100%" />
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
                      rx="4"
                      x={x()}
                      y={`${((1 - Math.min(1, Math.max(0, v()))) * 100).toFixed(1)}%`}
                      width={w()}
                      height={`${(Math.min(1, Math.max(0, v())) * 100).toFixed(1)}%`}
                    />
                  </Show>
                  <Show when={l() === 'c'}>
                    <text class="sr-pct" x={x() + w() / 2} y="12" text-anchor="middle">
                      {Math.round(Math.min(1, Math.max(0, v())) * 100)}%
                    </text>
                  </Show>
                  <Show when={toggles() && v() >= 0.5}>
                    <rect class="sr-step-on" rx="4" x={x()} y="20%" width={w()} height="60%" />
                  </Show>
                </g>
              );
            }}
          </Index>
          <Show when={props.width > MARKER_W}>
            <rect
              class="sr-len-line"
              x={Math.min(end() - 1, props.width - 2)}
              y="0"
              width="2"
              height="100%"
              rx="1"
            />
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
            rx="4"
            x="0"
            y="1"
            width="1"
            height="100%"
            ref={(el) => props.cursor?.(el)}
          />
        </svg>
      </div>
    </div>
  );
}
