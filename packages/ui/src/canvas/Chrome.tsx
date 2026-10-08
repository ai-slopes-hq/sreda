import { Show, type JSX } from 'solid-js';
import type { LibraryApi } from '../library';
import type { SessionApi } from '../store';

const HINT =
  'DRAG FROM A JACK TO PATCH · DROP IN EMPTY SPACE TO ADD · CLICK AN OUTPUT TO LISTEN · / SEARCH · W WIRES · ⌘S SAVE · ' +
  'DRAW MELODIES ON STAGES · DRAG EMPTY SPACE TO SELECT · SCROLL OR SPACE-DRAG TO PAN · G FRAME / UNFRAME · ' +
  'DOUBLE-CLICK A NAME TO REPLACE · DROP A FREE MODULE ON A CABLE TO INSERT · F FIT · R RANDOMISE · ⌘Z UNDO';

const stop = (e: Event) => e.stopPropagation();

/** The only chrome (spec §6): SREDA and the project path (● unsaved), SAVE / NEW, the save name field, zoom, hints. */
export function Chrome(props: {
  session: SessionApi;
  lib: LibraryApi;
  zoom(factor: number | null): void;
}): JSX.Element {
  const st = props.session.state;
  const title = () => {
    const sv = st.saving;
    if (!sv) return '';
    if (sv.confirm) return `REPLACE ${sv.confirm}? ⏎`;
    return sv.kind === 'group' ? 'SAVE GROUP' : 'SAVE PROJECT';
  };
  return (
    <>
      <div class="sr-brand">
        SREDA
        <Show when={st.project}>{(p) => <span class="sr-path">{p().path}</span>}</Show>
        <Show when={st.dirty}>
          <span class="sr-dirty"> ●</span>
        </Show>
      </div>
      <div class="sr-tbtns" onPointerDown={stop} onDblClick={stop}>
        <button class="sr-tbtn" title="save (⌘S)" onClick={() => void props.lib.save()}>
          SAVE
        </button>
        <button class="sr-tbtn" title="clear the canvas" onClick={() => props.lib.clear()}>
          NEW
        </button>
      </div>
      <Show when={st.saving}>
        {(sv) => (
          <div class="sr-save" onPointerDown={stop} onDblClick={stop}>
            <span>{title()}</span>
            <input
              aria-label="Name"
              classList={{ invalid: !!sv().invalid }}
              placeholder="NAME — a/b makes folders"
              value={sv().name}
              ref={(el) => queueMicrotask(() => el.focus())}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === 'Enter') void props.lib.submit(e.currentTarget.value);
                else if (e.key === 'Escape') props.lib.cancel();
              }}
            />
            <span>↵</span>
          </div>
        )}
      </Show>
      <div class="sr-hint">{HINT}</div>
      <div class="sr-zoom" onPointerDown={stop} onDblClick={stop}>
        <button aria-label="Zoom out" onClick={() => props.zoom(1 / 1.25)}>
          −
        </button>
        <span onClick={() => props.zoom(null)}>{Math.round(st.view.z * 100)}%</span>
        <button aria-label="Zoom in" onClick={() => props.zoom(1.25)}>
          +
        </button>
      </div>
    </>
  );
}
