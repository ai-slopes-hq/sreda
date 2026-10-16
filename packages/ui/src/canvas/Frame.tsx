import {
  GHEAD,
  isGroupId,
  type BlockJack,
  type Group,
  type Merge,
  type NodeReadouts,
  type Role,
} from '@sreda/core';
import { createSignal, Index, Show, type JSX } from 'solid-js';
import { track } from '../live';
import { fmtRat } from './glyphs';
import { Icon } from './icons';
import { Jack } from './Jack';

/** Fills (≈ 4 % neutral, ≈ 8 % hues) and swatch colours, by tint index. */
export const TINT_FILL = [
  ['color-mix(in srgb, var(--tint-0) 4%, transparent)', 'var(--tint-0)'],
  ['color-mix(in srgb, var(--tint-1) 8%, transparent)', 'var(--tint-1)'],
  ['color-mix(in srgb, var(--tint-2) 8%, transparent)', 'var(--tint-2)'],
  ['color-mix(in srgb, var(--tint-3) 8%, transparent)', 'var(--tint-3)'],
  ['color-mix(in srgb, var(--tint-4) 8%, transparent)', 'var(--tint-4)'],
  ['color-mix(in srgb, var(--tint-5) 8%, transparent)', 'var(--tint-5)'],
  ['color-mix(in srgb, var(--tint-6) 8%, transparent)', 'var(--tint-6)'],
] as const;

export type Edge = 'l' | 'r' | 'b' | 'bl' | 'br';

export interface FrameActions {
  headDown(e: PointerEvent): void;
  rename(name: string): void;
  tint(): void;
  resizeDown(edge: Edge, e: PointerEvent): void;
  hover(on: boolean): void;
  /** the own clock: + Clock, ✕, a BPM drag, Tap */
  clock(c: Group['clock'], merge: Merge): void;
  jackDown(port: 'clkIn' | 'clkOut', e: PointerEvent): void;
  /** the CLK IN ratio field */
  fieldDown(e: PointerEvent): void;
  fieldReset(): void;
  mute(): void;
  /** Stack on / off */
  stack(): void;
  /** save the frame as a group */
  save(): void;
  /** ⌄ / › (C) */
  collapse(on: boolean): void;
  /** a press on a block jack: patches the port inside */
  blockJackDown(j: BlockJackView, e: PointerEvent): void;
}

/** A block jack as drawn: where it is, what it is and whether a cable is on it. */
export type BlockJackView = BlockJack & { role: Role; filled: boolean; listening: boolean };

/** A collapsed frame's block: its size and jacks. */
export interface BlockView {
  w: number;
  h: number;
  jacks: BlockJackView[];
  /** the modules inside, for the card's `N modules` line */
  modules: number;
}

export interface FrameProps {
  group: Group;
  selected: boolean;
  /** what is being dragged would land in this frame */
  drop: boolean;
  /** a cable in CLK IN (the own clock is dimmed and does not run) */
  cabledIn: boolean;
  cabledOut: boolean;
  /** CLK IN reads the parent frame's clock: its title */
  normal?: string | undefined;
  listening?: boolean;
  /** a collapsed frame: its block instead of the frame */
  block?: BlockView | undefined;
  /** the frame clock node's readouts, once audio runs */
  readouts?: NodeReadouts | undefined;
  /** inside a muted frame: drawn at 40 % */
  dim?: boolean;
  /** where this frame's meter is in the readouts, once audio runs */
  meter?: number | undefined;
  act: FrameActions;
}

/** BPM from the last taps (up to 4, within 2.5 s; at least 2) — null until there are two */
export function tapTempo(taps: number[], now: number): { taps: number[]; bpm: number | null } {
  const recent = [...taps.filter((t) => now - t < 2.5), now].slice(-4);
  if (recent.length < 2) return { taps: recent, bpm: null };
  const interval = (recent[recent.length - 1]! - recent[0]!) / (recent.length - 1);
  return { taps: recent, bpm: Math.round(Math.min(300, Math.max(20, 60 / interval))) };
}

const HANDLES: Record<Edge, JSX.CSSProperties> = {
  r: { right: '-5px', top: `${GHEAD}px`, bottom: '6px', width: '10px', cursor: 'ew-resize' },
  l: { left: '-5px', top: `${GHEAD}px`, bottom: '6px', width: '10px', cursor: 'ew-resize' },
  b: { left: '6px', right: '6px', bottom: '-5px', height: '10px', cursor: 'ns-resize' },
  br: { right: '-7px', bottom: '-7px', width: '14px', height: '14px', cursor: 'nwse-resize' },
  bl: { left: '-7px', bottom: '-7px', width: '14px', height: '14px', cursor: 'nesw-resize' },
};

/** A frame (spec §5): a translucent rectangle with a 32 px header — collapse, name, state; tools on hover or selection — and resize handles. */
export function Frame(props: FrameProps): JSX.Element {
  const [hot, setHot] = createSignal(false);
  const [renaming, setRenaming] = createSignal(false);
  const g = () => props.group;
  const block = () => (g().collapsed ? props.block : undefined);
  const tools = () => hot() || props.selected;
  let draft = '';
  let taps: number[] = [];

  function tap(): void {
    const t = tapTempo(taps, performance.now() / 1000);
    taps = t.taps;
    if (t.bpm !== null) props.act.clock({ on: true, bpm: t.bpm }, { key: `tap:${g().id}`, stroke: true });
  }

  /** drag the BPM vertically: 1 per 4 px, Shift 1 per 10 px */
  function bpmDown(e: PointerEvent): void {
    if (e.button !== 0) return;
    e.stopPropagation();
    const y0 = e.clientY;
    const b0 = g().clock.bpm;
    const key = `bpm:${g().id}:${y0}:${performance.now()}`;
    const move = (ev: PointerEvent) => {
      const bpm = Math.round(
        Math.min(300, Math.max(20, b0 + (y0 - ev.clientY) * (ev.shiftKey ? 0.1 : 0.25))),
      );
      if (bpm !== g().clock.bpm) props.act.clock({ on: true, bpm }, { key, stroke: true });
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  function done(save: boolean): void {
    if (!renaming()) return;
    setRenaming(false);
    const name = draft.trim().toUpperCase();
    if (save && name && name !== g().name) props.act.rename(name);
  }

  return (
    <div
      class="sr-frame"
      classList={{ sel: props.selected, drop: props.drop, muted: !!props.dim, collapsed: !!block() }}
      data-frame={g().id}
      style={{
        left: g().x + 'px',
        top: g().y + 'px',
        width: (block()?.w ?? g().w) + 'px',
        height: (block()?.h ?? g().h) + 'px',
        background: block()
          ? `color-mix(in srgb, ${TINT_FILL[g().tint]?.[1]} 8%, var(--panel))`
          : TINT_FILL[g().tint]?.[0],
      }}
    >
      <div
        class="sr-ghead"
        data-ghead={g().id}
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          e.stopPropagation();
          props.act.headDown(e);
        }}
        onPointerEnter={() => {
          setHot(true);
          props.act.hover(true);
        }}
        onPointerLeave={() => {
          setHot(false);
          props.act.hover(false);
        }}
      >
        <button
          class="sr-gcollapse"
          aria-label={block() ? 'Expand frame' : 'Collapse frame'}
          title={block() ? 'expand (C)' : 'collapse to its connections (C)'}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => props.act.collapse(!block())}
        >
          <Icon name={block() ? 'chevron-right' : 'chevron-down'} size={14} />
        </button>
        <Show
          when={renaming()}
          fallback={
            <span
              class="sr-gname"
              onDblClick={(e) => {
                e.stopPropagation();
                draft = g().name;
                setRenaming(true);
              }}
            >
              {g().name}
            </span>
          }
        >
          <input
            class="sr-gname-in"
            aria-label="Group name"
            value={g().name}
            ref={(el) => queueMicrotask(() => el.select())}
            onPointerDown={(e) => e.stopPropagation()}
            onInput={(e) => (draft = e.currentTarget.value)}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'Enter') done(true);
              else if (e.key === 'Escape') done(false);
            }}
            onBlur={() => done(true)}
          />
        </Show>
        <div class="sr-gmeter" title="level leaving the frame">
          <div ref={(el) => track(el, 'meter', () => props.meter)} />
        </div>
        <div class="sr-gclock">
          <Show when={!block() && g().clock.on}>
            <div
              class="sr-bpm"
              classList={{ dim: props.cabledIn }}
              title="drag to change"
              onPointerDown={bpmDown}
              onDblClick={(e) => e.stopPropagation()}
            >
              {g().clock.bpm} BPM
            </div>
          </Show>
          <Show when={tools() && !block()}>
            <button
              class="sr-swatch"
              aria-label="Frame colour"
              title="frame colour"
              style={{ background: TINT_FILL[g().tint]?.[1] }}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => props.act.tint()}
            />
            <button
              class="sr-gbtn"
              classList={{ on: g().layout === 'stack' }}
              title="pack the frame's contents densely; the width decides the rows"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => props.act.stack()}
            >
              Stack
            </button>
            <button
              class="sr-gbtn"
              title="save as a group (⌘S)"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => props.act.save()}
            >
              Save group
            </button>
          </Show>
          <Show when={tools() || g().muted}>
            <button
              class="sr-gbtn sr-gmute"
              classList={{ on: g().muted }}
              aria-label="Mute frame"
              title="mute frame"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => props.act.mute()}
            >
              M
            </button>
          </Show>
          <Show when={tools() && !block()}>
            <Show
              when={g().clock.on}
              fallback={
                <button
                  class="sr-gbtn"
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={() => props.act.clock({ on: true, bpm: g().clock.bpm }, undefined)}
                >
                  + Clock
                </button>
              }
            >
              <button class="sr-gbtn" onPointerDown={(e) => e.stopPropagation()} onClick={tap}>
                Tap
              </button>
              <button
                class="sr-gbtn sr-gx"
                aria-label="Remove group clock"
                title="remove the group clock"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={() => props.act.clock({ on: false, bpm: g().clock.bpm }, undefined)}
              >
                <Icon name="close" size={12} />
              </button>
            </Show>
          </Show>
        </div>
      </div>
      <div
        class="sr-gfield"
        data-field="clkIn"
        title="CLK IN ratio ÷16…×8 · drag, double-click resets"
        style={{ color: g().ratio === 1 ? 'var(--faint)' : undefined }}
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          e.stopPropagation();
          props.act.fieldDown(e);
        }}
        onDblClick={(e) => {
          e.stopPropagation();
          props.act.fieldReset();
        }}
      >
        {g().ratio !== 1 || hot() ? fmtRat(g().ratio) : ''}
      </div>
      <Jack
        port="clkIn"
        dir="in"
        role="trigger"
        x={0}
        y={GHEAD / 2}
        filled={props.cabledIn}
        normalled={!!props.normal}
        title={props.normal ?? 'CLK IN'}
        onPointerDown={(e) => props.act.jackDown('clkIn', e)}
        ref={(el) => track(el, 'flash', () => props.readouts?.trigs)}
      />
      <Show
        when={block()}
        fallback={
          <>
            <Jack
              port="clkOut"
              dir="out"
              role="trigger"
              x={12}
              y={GHEAD + 8}
              filled={props.cabledOut}
              listening={!!props.listening}
              title="CLK OUT · patch to members · click to listen"
              onPointerDown={(e) => props.act.jackDown('clkOut', e)}
              ref={(el) => track(el, 'flash', () => props.readouts?.state)}
            />
            <div class="sr-plabel" style={{ left: '22px', top: `${GHEAD + 3}px` }}>
              CLK
            </div>
            {(Object.keys(HANDLES) as Edge[])
              .filter((edge) => g().layout === 'free' || edge === 'r' || edge === 'br')
              .map((edge) => (
                <div
                  class="sr-rs"
                  data-resize={edge}
                  style={HANDLES[edge]}
                  onPointerDown={(e) => {
                    if (e.button !== 0) return;
                    e.stopPropagation();
                    props.act.resizeDown(edge, e);
                  }}
                />
              ))}
          </>
        }
      >
        {(b) => (
          <>
            <Jack
              port="clkOut"
              dir="out"
              role="trigger"
              x={b().w}
              y={GHEAD / 2}
              filled={props.cabledOut}
              listening={!!props.listening}
              title="CLK OUT · patch to members · click to listen"
              onPointerDown={(e) => props.act.jackDown('clkOut', e)}
              ref={(el) => track(el, 'flash', () => props.readouts?.state)}
            />
            <div
              class="sr-block"
              style={{ top: GHEAD + 'px' }}
              onPointerDown={(e) => {
                if (e.button !== 0) return;
                e.stopPropagation();
                props.act.headDown(e);
              }}
            >
              <Index each={b().jacks}>
                {(j) => (
                  // the wrapper is what a dropped cable resolves: the inner object and its port
                  <div
                    class="sr-bjack"
                    data-module={isGroupId(j().id) ? undefined : j().id}
                    data-frame={isGroupId(j().id) ? j().id : undefined}
                    data-jack={j().port}
                  >
                    <Jack
                      port={j().port}
                      dir={j().dir}
                      role={j().role}
                      x={j().x}
                      y={j().y - GHEAD}
                      filled={j().filled}
                      listening={j().listening}
                      title={j().label}
                      onPointerDown={(e) => props.act.blockJackDown(j(), e)}
                    />
                    <div
                      class="sr-blabel"
                      classList={{ out: j().dir === 'out' }}
                      style={{ [j().dir === 'in' ? 'left' : 'right']: '22px', top: j().y - GHEAD - 6 + 'px' }}
                    >
                      {j().label}
                    </div>
                  </div>
                )}
              </Index>
              <div class="sr-bcount">
                {b().modules} {b().modules === 1 ? 'module' : 'modules'}
              </div>
            </div>
          </>
        )}
      </Show>
    </div>
  );
}
