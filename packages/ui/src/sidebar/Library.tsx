import { createEffect, createMemo, createSignal, For, onCleanup, Show, type JSX } from 'solid-js';
import type { LibEntry } from '../canvas/patching';
import type { LibraryApi, SredaBridge } from '../library';
import type { SessionApi } from '../store';

type Section = 'PROJECTS' | 'GROUPS' | 'SAMPLES';
interface Row {
  path: string;
  folder: string;
  name: string;
  factory: boolean;
}

/** the MIME types a row carries when dragged onto the canvas (Canvas.tsx decides what the drop does) */
export const DRAG_GROUP = 'application/x-sreda-group';
export const DRAG_SAMPLE = 'application/x-sreda-sample';

const split = (path: string, factory: boolean): Row => {
  const i = path.lastIndexOf('/');
  return { path, folder: i > 0 ? path.slice(0, i) : '', name: path.slice(i + 1), factory };
};

/**
 * LIBRARY (spec §5a): PROJECTS, GROUPS and SAMPLES, each collapsible with its own filter. A project opens on a
 * click; a group is placed in the middle of the view by a click or at the drop point; a sample auditions on hover
 * (120 ms) and is dropped onto the canvas. Paths just imported (File › Import Samples…) come first.
 */
export function Library(props: {
  session: SessionApi;
  lib: LibraryApi;
  /** the groups and projects on offer: factory and library */
  entries: LibEntry[];
  /** opening a project fits the view to it */
  fit(): void;
  /** the middle of the visible canvas, in canvas coordinates */
  middle(): { x: number; y: number };
  bridge?: SredaBridge | undefined;
}): JSX.Element {
  const s = props.session;
  let root: HTMLDivElement | undefined;
  const [samples, setSamples] = createSignal<string[]>([]);
  const [open, setOpen] = createSignal<Record<Section, boolean>>({
    PROJECTS: true,
    GROUPS: true,
    SAMPLES: true,
  });
  const [q, setQ] = createSignal<Record<Section, string>>({ PROJECTS: '', GROUPS: '', SAMPLES: '' });
  const bridge = () => props.bridge ?? window.sreda;
  // paths just imported (File › Import Samples…, a drop) come first; importing while this tab shows re-lists
  const hot = createMemo(() => new Set(s.state.sidebar.highlight));
  void props.lib.refresh();
  createEffect(() => {
    const first = s.state.sidebar.highlight[0];
    let live = true;
    onCleanup(() => (live = false));
    void bridge()
      ?.library.samples()
      .then((list) => {
        if (!live) return;
        setSamples(list);
        if (first)
          queueMicrotask(() =>
            root
              ?.querySelector('[data-section=SAMPLES] .sr-lrow.new')
              ?.scrollIntoView?.({ block: 'nearest' }),
          );
      })
      .catch(() => live && setSamples([]));
  });

  const match = (r: Row, sec: Section): boolean => {
    const t = q()[sec].trim().toLowerCase();
    return !t || `${r.folder}/${r.name}`.toLowerCase().includes(t);
  };
  const entryRows = (kind: 'project' | 'group', sec: Section) =>
    createMemo(() =>
      props.entries
        .filter((e) => e.kind === kind)
        .map((e) => split(e.path, e.factory))
        .filter((r) => match(r, sec))
        // factory entries first, then the library's
        .sort((a, b) => Number(b.factory) - Number(a.factory) || a.path.localeCompare(b.path)),
    );
  const projects = entryRows('project', 'PROJECTS');
  const groups = entryRows('group', 'GROUPS');
  const sampleRows = createMemo(() =>
    samples()
      .map((p) => split(p, false))
      .filter((r) => match(r, 'SAMPLES'))
      .sort(
        (a, b) =>
          Number(hot().has(b.path)) - Number(hot().has(a.path)) ||
          a.folder.localeCompare(b.folder) ||
          a.name.localeCompare(b.name),
      ),
  );

  const entry = (path: string): LibEntry | undefined => props.entries.find((e) => e.path === path);
  async function openProject(path: string): Promise<void> {
    const e = entry(path);
    const doc = e && (await props.lib.read(e));
    if (!e || !doc) return;
    s.openProject(doc, { path: e.path, factory: e.factory });
    props.fit();
  }
  async function placeGroup(path: string): Promise<void> {
    const e = entry(path);
    const doc = e && (await props.lib.read(e));
    if (doc) s.placeGroup(doc, props.middle(), null);
  }

  // audition: the hovered SAMPLES row plays 120 ms after the pointer arrives; leaving stops it
  let timer: ReturnType<typeof setTimeout> | undefined;
  let playing = false;
  function hear(path: string | null): void {
    clearTimeout(timer);
    if (playing) void s.samples.audition(null);
    playing = false;
    if (!path) return;
    timer = setTimeout(() => {
      playing = true;
      void s.samples.audition(path);
    }, 120);
  }
  onCleanup(() => {
    hear(null);
    s.setState('sidebar', 'highlight', []);
  });

  const head = (sec: Section, extra?: JSX.Element): JSX.Element => (
    <div class="sr-lhead" onClick={() => setOpen({ ...open(), [sec]: !open()[sec] })}>
      <span class="car">{open()[sec] ? '▾' : '▸'}</span>
      <span class="title">{sec}</span>
      <span class="sp" />
      {extra}
    </div>
  );
  const filter = (sec: Section): JSX.Element => (
    <input
      class="sr-wfilter"
      placeholder="FILTER…"
      value={q()[sec]}
      onInput={(e) => setQ({ ...q(), [sec]: e.currentTarget.value })}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Escape') {
          setQ({ ...q(), [sec]: '' });
          e.currentTarget.blur();
        }
      }}
    />
  );
  const stop = (e: Event) => e.stopPropagation();
  const rowEl = (r: Row, sec: Section, rowProps: JSX.HTMLAttributes<HTMLDivElement>): JSX.Element => (
    <div
      class="sr-lrow"
      classList={{ new: sec === 'SAMPLES' && hot().has(r.path) }}
      data-path={r.path}
      {...rowProps}
    >
      <Show when={r.folder}>
        <span class="folder">{r.folder} · </span>
      </Show>
      <span class="name">{r.name}</span>
    </div>
  );
  return (
    <div class="sr-lib" ref={(el) => (root = el)}>
      <div class="sr-lsec" data-section="PROJECTS">
        {head(
          'PROJECTS',
          <>
            <button class="sr-gbtn" onClick={(e) => (stop(e), props.lib.saveAs())}>
              SAVE AS
            </button>
            <button class="sr-gbtn" onClick={(e) => (stop(e), props.lib.clear())}>
              NEW
            </button>
          </>,
        )}
        <Show when={open().PROJECTS}>
          {filter('PROJECTS')}
          <For each={projects()}>
            {(r) => rowEl(r, 'PROJECTS', { onClick: () => void openProject(r.path) })}
          </For>
        </Show>
      </div>
      <div class="sr-lsec" data-section="GROUPS">
        {head('GROUPS')}
        <Show when={open().GROUPS}>
          {filter('GROUPS')}
          <For each={groups()}>
            {(r) =>
              rowEl(r, 'GROUPS', {
                draggable: true,
                onClick: () => void placeGroup(r.path),
                onDragStart: (e) => {
                  e.dataTransfer?.setData(DRAG_GROUP, r.path);
                  if (e.dataTransfer) e.dataTransfer.effectAllowed = 'copy';
                },
              })
            }
          </For>
        </Show>
      </div>
      <div class="sr-lsec" data-section="SAMPLES">
        {head(
          'SAMPLES',
          <button class="sr-gbtn" onClick={(e) => (stop(e), void props.lib.importSamples())}>
            IMPORT
          </button>,
        )}
        <Show when={open().SAMPLES}>
          {filter('SAMPLES')}
          <For each={sampleRows()}>
            {(r) =>
              rowEl(r, 'SAMPLES', {
                draggable: true,
                onMouseEnter: () => hear(r.path),
                onMouseLeave: () => hear(null),
                onDragStart: (e) => {
                  hear(null);
                  e.dataTransfer?.setData(DRAG_SAMPLE, r.path);
                  if (e.dataTransfer) e.dataTransfer.effectAllowed = 'copy';
                },
              })
            }
          </For>
        </Show>
      </div>
    </div>
  );
}
