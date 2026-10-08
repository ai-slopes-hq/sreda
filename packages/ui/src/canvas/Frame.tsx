import { GHEAD, type Group } from '@sreda/core';
import { createSignal, Show, type JSX } from 'solid-js';

/** Fills (≈ 4 % neutral, ≈ 8 % hues) and swatch colours, by tint index. */
export const TINT_FILL = [
  ['rgba(233,228,216,0.035)', '#8f897c'],
  ['rgba(217,119,87,0.09)', '#d97757'],
  ['rgba(240,200,110,0.08)', '#d8b25e'],
  ['rgba(154,209,139,0.08)', '#8fbf80'],
  ['rgba(110,200,190,0.08)', '#62b3a8'],
  ['rgba(108,180,238,0.09)', '#6cb4ee'],
  ['rgba(196,140,220,0.09)', '#b98ad0'],
] as const;

export type Edge = 'l' | 'r' | 'b' | 'bl' | 'br';

export interface FrameActions {
  headDown(e: PointerEvent): void;
  rename(name: string): void;
  tint(): void;
  resizeDown(edge: Edge, e: PointerEvent): void;
  hover(on: boolean): void;
}

export interface FrameProps {
  group: Group;
  selected: boolean;
  /** what is being dragged would land in this frame */
  drop: boolean;
  act: FrameActions;
}

const HANDLES: Record<Edge, JSX.CSSProperties> = {
  r: { right: '-5px', top: `${GHEAD}px`, bottom: '6px', width: '10px', cursor: 'ew-resize' },
  l: { left: '-5px', top: `${GHEAD}px`, bottom: '6px', width: '10px', cursor: 'ew-resize' },
  b: { left: '6px', right: '6px', bottom: '-5px', height: '10px', cursor: 'ns-resize' },
  br: { right: '-7px', bottom: '-7px', width: '14px', height: '14px', cursor: 'nwse-resize' },
  bl: { left: '-7px', bottom: '-7px', width: '14px', height: '14px', cursor: 'nesw-resize' },
};

/** A frame (spec §5): a translucent rectangle with a 28 px header — name, tools — and resize handles. */
export function Frame(props: FrameProps): JSX.Element {
  const [hot, setHot] = createSignal(false);
  const [renaming, setRenaming] = createSignal(false);
  const g = () => props.group;
  let draft = '';

  function done(save: boolean): void {
    if (!renaming()) return;
    setRenaming(false);
    const name = draft.trim().toUpperCase();
    if (save && name && name !== g().name) props.act.rename(name);
  }

  return (
    <div
      class="sr-frame"
      classList={{ sel: props.selected, drop: props.drop }}
      data-frame={g().id}
      style={{
        left: g().x + 'px',
        top: g().y + 'px',
        width: g().w + 'px',
        height: g().h + 'px',
        background: TINT_FILL[g().tint]?.[0],
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
        <div class="sr-gclock">
          <Show when={hot()}>
            <button
              class="sr-swatch"
              aria-label="Frame colour"
              title="frame colour"
              style={{ background: TINT_FILL[g().tint]?.[1] }}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => props.act.tint()}
            />
          </Show>
        </div>
      </div>
      {(Object.keys(HANDLES) as Edge[]).map((edge) => (
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
    </div>
  );
}
