import { createEffect, createMemo, createSignal, For, onCleanup, Show, type JSX } from 'solid-js';
import type { LibEntry } from '../canvas/patching';
import type { LibraryApi, SredaBridge } from '../library';
import { Icon } from '../canvas/icons';
import type { SessionApi } from '../store';
import { SearchField } from './SideField';

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

/** a section longer than this shows its first rows and `Show all N` */
const SHORT = 8;

/**
 * LIBRARY (spec §5a, §1b): PROJECTS, GROUPS and SAMPLES under one filter, each collapsible. A project opens on a
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
  const [loaded, setLoaded] = createSignal(false);
  const [open, setOpen] = createSignal<Record<Section, boolean>>({
    PROJECTS: true,
    GROUPS: true,
    SAMPLES: true,
  });
  const [all, setAll] = createSignal<Record<Section, boolean>>({
    PROJECTS: false,
    GROUPS: false,
    SAMPLES: false,
  });
  const [q, setQ] = createSignal('');
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
        setLoaded(true);
        if (first)
          queueMicrotask(() =>
            root
              ?.querySelector('[data-section=SAMPLES] .sr-lrow.new')
              ?.scrollIntoView?.({ block: 'nearest' }),
          );
      })
      .catch(() => {
        if (!live) return;
        setSamples([]);
        setLoaded(true);
      });
  });

  const match = (r: Row): boolean => {
    const t = q().trim().toLowerCase();
    return !t || `${r.folder}/${r.name}`.toLowerCase().includes(t);
  };
  const entryRows = (kind: 'project' | 'group') =>
    createMemo(() =>
      props.entries
        .filter((e) => e.kind === kind)
        .map((e) => split(e.path, e.factory))
        .filter(match)
        // factory entries first, then the library's
        .sort((a, b) => Number(b.factory) - Number(a.factory) || a.path.localeCompare(b.path)),
    );
  const projects = entryRows('project');
  const groups = entryRows('group');
  const sampleRows = createMemo(() =>
    samples()
      .map((p) => split(p, false))
      .filter(match)
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

  const head = (sec: Section, n: number, extra?: JSX.Element): JSX.Element => (
    <div class="sr-lhead" onClick={() => setOpen({ ...open(), [sec]: !open()[sec] })}>
      <Icon name={open()[sec] ? 'chevron-down' : 'chevron-right'} size={10} />
      <span class="title">{sec}</span>
      <span class="n">{n}</span>
      <span class="sp" />
      {extra}
    </div>
  );
  /** the rows to show: all of them, or the first eight and `Show all N` */
  const list = (sec: Section, rows: Row[], one: (r: Row) => JSX.Element): JSX.Element => (
    <>
      <For each={all()[sec] ? rows : rows.slice(0, SHORT)}>{one}</For>
      <Show when={!all()[sec] && rows.length > SHORT}>
        <button class="sr-more" onClick={() => setAll({ ...all(), [sec]: true })}>
          Show all {rows.length}
        </button>
      </Show>
    </>
  );
  const stop = (e: Event) => e.stopPropagation();
  const opened = (r: Row): boolean => {
    const p = s.state.project;
    return !!p && !p.file && p.path === r.path;
  };
  const rowEl = (r: Row, sec: Section, rowProps: JSX.HTMLAttributes<HTMLDivElement>): JSX.Element => (
    <div
      class="sr-lrow"
      classList={{ new: sec === 'SAMPLES' && hot().has(r.path), on: sec === 'PROJECTS' && opened(r) }}
      data-path={r.path}
      {...rowProps}
    >
      <Show when={r.folder}>
        <span class="folder">{r.folder} · </span>
      </Show>
      <span class="name">{r.name}</span>
      <Show when={sec === 'PROJECTS' && opened(r)}>
        <span class="r open">
          <i class="dot" />
          open
        </span>
      </Show>
      <Show when={sec === 'GROUPS'}>
        <span class="r drag">
          drag to canvas
          <Icon name="grip" size={14} />
        </span>
      </Show>
    </div>
  );
  return (
    <>
      <SearchField
        value={q()}
        set={setQ}
        placeholder="Filter projects, groups, samples"
        label="Filter library"
      />
      <div class="sr-lib" ref={(el) => (root = el)}>
        <div class="sr-lsec" data-section="PROJECTS">
          {head('PROJECTS', projects().length)}
          <Show when={open().PROJECTS}>
            {list('PROJECTS', projects(), (r) =>
              rowEl(r, 'PROJECTS', { onClick: () => void openProject(r.path) }),
            )}
          </Show>
        </div>
        <div class="sr-lsec" data-section="GROUPS">
          {head('GROUPS', groups().length)}
          <Show when={open().GROUPS}>
            {list('GROUPS', groups(), (r) =>
              rowEl(r, 'GROUPS', {
                draggable: true,
                onClick: () => void placeGroup(r.path),
                onDragStart: (e) => {
                  e.dataTransfer?.setData(DRAG_GROUP, r.path);
                  if (e.dataTransfer) e.dataTransfer.effectAllowed = 'copy';
                },
              }),
            )}
          </Show>
        </div>
        <div class="sr-lsec" data-section="SAMPLES">
          {head(
            'SAMPLES',
            sampleRows().length,
            <button class="sr-import" onClick={(e) => (stop(e), void props.lib.importSamples())}>
              <Icon name="import" size={12} />
              Import
            </button>,
          )}
          <Show when={open().SAMPLES}>
            {list('SAMPLES', sampleRows(), (r) =>
              rowEl(r, 'SAMPLES', {
                draggable: true,
                onMouseEnter: () => hear(r.path),
                onMouseLeave: () => hear(null),
                onDragStart: (e) => {
                  hear(null);
                  e.dataTransfer?.setData(DRAG_SAMPLE, r.path);
                  if (e.dataTransfer) e.dataTransfer.effectAllowed = 'copy';
                },
              }),
            )}
            <Show when={loaded() && samples().length === 0}>
              <div class="sr-empty">
                No samples yet. Import audio files or drop them here; hover a sample to hear it.
              </div>
            </Show>
          </Show>
        </div>
      </div>
    </>
  );
}
