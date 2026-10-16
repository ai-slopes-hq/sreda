import { Show, type JSX } from 'solid-js';
import { fileName, type LibraryApi } from '../library';
import { Icon } from './icons';
import type { Session, SessionApi } from '../store';

const stop = (e: Event) => e.stopPropagation();

/** The name the brand bar shows: the last path segment without `.sreda.json`; `Untitled patch` for none. */
export function projectName(project: Session['project']): string {
  if (!project) return 'Untitled patch';
  return fileName(project.path).replace(/\.sreda\.json$/, '');
}

/** The only chrome (spec §6): SREDA and the project name (● unsaved), Dice / New / Save / Sidebar, the save name field, zoom, hints. */
export function Chrome(props: {
  session: SessionApi;
  lib: LibraryApi;
  zoom(factor: number | null): void;
  /** fit the whole patch in view */
  fit(): void;
}): JSX.Element {
  const st = props.session.state;
  const title = () => {
    const sv = st.saving;
    if (!sv) return '';
    if (sv.confirm) return `Replace ${sv.confirm}? ⏎`;
    return sv.kind === 'group' ? 'Save group' : 'Save project';
  };
  return (
    <>
      <div class="sr-brand" title={st.project?.path} onPointerDown={stop} onDblClick={stop}>
        <span class="sr-word">SREDA</span>
        <span class="sr-div" />
        <span class="sr-projname">{projectName(st.project)}</span>
        <Show when={st.dirty}>
          <span class="sr-dirty">
            <i class="dot" />
            unsaved
          </span>
        </Show>
      </div>
      <div class="sr-tbtns" onPointerDown={stop} onDblClick={stop}>
        <button
          class="sr-tbtn"
          title="a random patch, rhythmic or ambient (⌘Z returns)"
          onClick={() => {
            props.lib.dice();
            props.fit();
          }}
        >
          <Icon name="dice" />
          Dice
        </button>
        <button class="sr-tbtn" title="clear the canvas" onClick={() => props.lib.clear()}>
          <Icon name="new" />
          New
        </button>
        <span class="sr-div" />
        <button class="sr-tbtn" title="save (⌘S)" onClick={() => void props.lib.save()}>
          <Icon name="save" />
          Save
          <kbd>⌘S</kbd>
        </button>
        <span class="sr-div" />
        <button
          class="sr-tbtn"
          classList={{ on: st.sidebar.open }}
          title="sidebar"
          onClick={() => props.session.setState('sidebar', 'open', !st.sidebar.open)}
        >
          <Icon name="sidebar" />
          Sidebar
        </button>
      </div>
      <Show when={st.saving}>
        {(sv) => (
          <div class="sr-save" onPointerDown={stop} onDblClick={stop}>
            <span>{title()}</span>
            <input
              aria-label="Name"
              classList={{ invalid: !!sv().invalid }}
              placeholder="Name — a/b makes folders"
              value={sv().name}
              ref={(el) => queueMicrotask(() => el.focus())}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === 'Enter') void props.lib.submit(e.currentTarget.value);
                else if (e.key === 'Escape') props.lib.cancel();
              }}
            />
            <kbd>↵</kbd>
          </div>
        )}
      </Show>
      <div class="sr-hint">
        <kbd>/</kbd> add module · <kbd>W</kbd> wires · <kbd>G</kbd> frame · <kbd>F</kbd> fit · <kbd>R</kbd> randomise
      </div>
      <div class="sr-zoom" onPointerDown={stop} onDblClick={stop}>
        <button aria-label="Zoom out" title="zoom out" onClick={() => props.zoom(1 / 1.25)}>
          <Icon name="minus" />
        </button>
        <button class="pct" title="back to 100%" onClick={() => props.zoom(null)}>
          {Math.round(st.view.z * 100)}%
        </button>
        <button aria-label="Zoom in" title="zoom in" onClick={() => props.zoom(1.25)}>
          <Icon name="plus" />
        </button>
        <span class="sr-div" />
        <button aria-label="Fit" title="fit the patch (F)" onClick={() => props.fit()}>
          <Icon name="fit" />
        </button>
      </div>
    </>
  );
}
