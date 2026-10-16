// META-SEQ's editor (spec §7b): a drawer docked under the canvas at the window's full width. The header (name,
// pattern tabs, editing / playing text, Copy / Paste, Scale, Root, Gen, Dice, Mutate, undo, ✕), then one row per lane
// on one step grid in clock time. The tabs choose the edited pattern, Scale / Root / Gen write, the lanes take their
// gestures (Lane.tsx), ✕ closes; Copy / Paste copy the edited pattern into a clip and write it back as one undo step;
// Dice writes the edited pattern's unlocked lanes and ⚄ one lane (locked or not), each one undo step; Mutate is drawn
// but inert.
import {
  copyPattern,
  fromKnob,
  laneLen,
  laneRate,
  LANES,
  mulberry32,
  nameOf,
  type Lane as LaneId,
  pastePattern,
  type KnobParam,
  type Merge,
  type OptionParam,
  type Specs,
} from '@sreda/core';
import { createEffect, createMemo, createSignal, For, onCleanup, onMount, Show, type JSX } from 'solid-js';
import { Icon } from '../canvas/icons';
import { Option } from '../canvas/Option';
import { Segmented } from '../canvas/Segmented';
import { diceChanges } from '../dice';
import { readoutBuffer, track } from '../live';
import type { SessionApi } from '../store';
import { cells } from './grid';
import { Lane, NOTES, WINDOW } from './Lane';
import './seq.css';

export interface DrawerProps {
  session: SessionApi;
  specs: Specs;
  /** the META-SEQ shown */
  id: string;
}

const MIN_H = 160;
const PATTERNS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'] as const;
/** px of vertical drag per semitone on ROOT */
const ROOT_PX = 10;

let rootStrokes = 0;

export function Drawer(props: DrawerProps): JSX.Element {
  const s = props.session;
  const st = s.state;
  const spec = () => props.specs['metaseq']!;
  const mod = () => st.doc.modules.find((m) => m.id === props.id);
  const params = (): Record<string, number> => mod()?.params ?? {};
  const option = (id: string) =>
    spec().params.find((p): p is OptionParam => p.kind === 'option' && p.id === id);
  const knob = (id: string) => spec().params.find((p): p is KnobParam => p.kind === 'knob' && p.id === id);
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

  /** each lane's length and cells, for the cursors */
  const lanes = createMemo(() =>
    LANES.map((l) => {
      const len = laneLen(params(), edited(), l);
      return { len, cells: cells(len, laneRate(params(), edited(), l), WINDOW, gridW()) };
    }),
  );
  // ── COPY / PASTE: the clip lives here, not in the system clipboard ──
  const [clip, setClip] = createSignal<Record<string, number> | undefined>(undefined);
  const paste = () => {
    const c = clip();
    if (c) s.params(props.id, pastePattern(c, edited()), undefined);
  };
  const edit = (changes: Record<string, number>, merge: Merge) => s.params(props.id, changes, merge);
  /** DICE (all unlocked lanes of the edited pattern) or ⚄ (`only`): one undo step */
  const dice = (only?: LaneId) => {
    const changes = diceChanges(
      s.current(),
      props.specs,
      props.id,
      mulberry32((Math.random() * 2 ** 32) >>> 0),
      only,
    );
    // every lane locked (or nothing new drawn): no empty undo step
    if (Object.keys(changes).length > 0) edit(changes, undefined);
  };

  // ── ROOT: vertical drag or the wheel, a semitone a step ──
  const root = () => Math.round(knobValue('root'));
  const setRoot = (r: number, merge: Merge) => {
    const k = Math.min(11, Math.max(0, r));
    if (k !== root()) edit({ root: k / 11 }, merge);
  };
  let rootDrag = { key: '', y: 0, r: 0 };
  function rootDown(e: PointerEvent): void {
    if (e.button !== 0) return;
    e.preventDefault();
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    rootDrag = { key: `root:${props.id}:${++rootStrokes}`, y: e.clientY, r: root() };
  }
  function rootMove(e: PointerEvent): void {
    if (!rootDrag.key) return;
    setRoot(rootDrag.r + Math.round((rootDrag.y - e.clientY) / ROOT_PX), { key: rootDrag.key, stroke: true });
  }
  function rootWheel(e: WheelEvent): void {
    e.preventDefault();
    e.stopPropagation();
    setRoot(root() + (e.deltaY < 0 ? 1 : -1), { key: `wheel:${props.id}:root` });
  }
  /** SCALE / GEN: a label and the option's name, one field button that opens the list */
  const headOption = (id: string, label: string) => (
    <Show when={option(id)}>
      {(prm) => (
        <span class="sr-dfield" data-field={id}>
          <span class="sr-dlabel">{label}</span>
          <Option
            param={prm()}
            value={params()[id] ?? prm().def}
            x={0}
            y={0}
            w={0}
            text
            closeEpoch={0}
            scope={props.id}
            set={(v, merge) => edit({ [id]: v }, merge)}
          />
        </span>
      )}
    </Show>
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
      // the ring sits 1 px inside the cell (cells are 4 px apart)
      el.setAttribute('x', String(c.x + 3));
      el.setAttribute('width', String(Math.max(1, c.w - 6)));
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

  return (
    <section class="sr-drawer" data-seq={props.id} style={{ height: st.seq.h + 'px' }}>
      <div class="sr-drawer-grip" onPointerDown={gripDown} />
      <header class="sr-drawer-head">
        <span class="sr-drawer-name">{nameOf(st.doc, props.specs, props.id)}</span>
        <Segmented
          label="Pattern"
          items={PATTERNS.map((t) => ({ id: t, label: t }))}
          value={PATTERNS[edited()] ?? 'A'}
          ring={PATTERNS[playingPattern()] ?? null}
          set={(t) => s.seqTab(props.id, PATTERNS.indexOf(t))}
        />
        <span class="sr-drawer-status">
          {edited() === playingPattern()
            ? `editing ${PATTERNS[edited()]}`
            : `editing ${PATTERNS[edited()]} · playing ${PATTERNS[playingPattern()]}`}
        </span>
        <span class="sr-drawer-gap" />
        <button class="sr-dbtn" data-act="copy" onClick={() => setClip(copyPattern(params(), edited()))}>
          Copy
        </button>
        <button class="sr-dbtn" data-act="paste" disabled={clip() === undefined} onClick={paste}>
          Paste
        </button>
        {headOption('scale', 'Scale')}
        <span
          class="sr-dfield sr-drawer-root"
          data-field="root"
          title="Root (drag or wheel)"
          onPointerDown={rootDown}
          onPointerMove={rootMove}
          onPointerUp={() => (rootDrag.key = '')}
          onPointerCancel={() => (rootDrag.key = '')}
          onWheel={rootWheel}
        >
          <span class="sr-dlabel">Root</span>
          <b>{NOTES[root() % 12]}</b>
        </span>
        {headOption('gen', 'Gen')}
        <button class="sr-dbtn" data-act="dice" onClick={() => dice()}>
          Dice
        </button>
        <span class="sr-dfield" data-field="mutate">
          <span class="sr-dlabel">Mutate</span>
          <b>{Math.round(knobValue('mut') * 100)}%</b>
        </span>
        <button
          class="sr-dbtn sr-dicon"
          data-act="undo"
          aria-label="Undo"
          title="Undo (⌘Z)"
          onClick={() => s.undo()}
        >
          <Icon name="undo" size={16} />
        </button>
        <button class="sr-dbtn sr-dicon" aria-label="Close" title="Close (Esc)" onClick={() => s.closeSeq()}>
          <Icon name="close" size={16} />
        </button>
      </header>
      <div class="sr-drawer-body">
        <For each={LANES}>
          {(l, li) => (
            <Lane
              lane={l}
              pattern={edited()}
              params={params()}
              width={gridW()}
              spec={spec()}
              scope={props.id}
              edit={edit}
              dice={() => dice(l)}
              cursor={(el) => (cursors[li()] = el)}
              grid={(el) => li() === 0 && (gridEl = el)}
            />
          )}
        </For>
        <span hidden ref={(el) => track(el, 'tick', traceAt, frame)} />
      </div>
    </section>
  );
}
