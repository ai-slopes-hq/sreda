// The canvas keyboard (spec §4, §5): undo, delete, Esc, `/`, F, G.
import {
  deleteObjects,
  duplicate,
  frameSelection,
  isGroupId,
  randomise,
  settle,
  unframe,
  type Specs,
} from '@sreda/core';
import type { LibraryApi } from '../library';
import type { SessionApi } from '../store';
import { wireSections } from '../sidebar/rows';
import type { PickerTab } from './patching';

type Pt = { x: number; y: number };

export interface KeyCtx {
  s: SessionApi;
  specs: Specs;
  pickerOpen(): boolean;
  closePicker(): void;
  /** open the picker at a screen point, on a tab */
  openPicker(at: Pt, tab?: PickerTab): void;
  /** the middle of the canvas, on screen */
  middle(): Pt;
  pointer(): Pt;
  fit(selection: boolean): void;
  setSpace(on: boolean): void;
  lib: LibraryApi;
}

/** Wrap the selection in a new frame and select it. */
function frame(k: KeyCtx): void {
  const sel = k.s.state.sel;
  if (!sel.length) return;
  const { doc, id } = frameSelection(k.s.current(), k.specs, sel);
  k.s.commit(doc);
  k.s.setState('sel', [id]);
}

function unframeSelected(k: KeyCtx): void {
  const gids = k.s.state.sel.filter(isGroupId);
  if (!gids.length) return;
  const before = k.s.current();
  k.s.commit(settle(before, unframe(before, k.specs, gids), k.specs));
  k.s.setState('sel', []);
}

/** the wire rows WIRES shows (filter, SELECTION and collapsed sections applied), as cable indices */
function visibleWires(k: KeyCtx): number[] {
  const st = k.s.state;
  return wireSections(st.doc, k.specs, { q: st.sidebar.q, selOnly: st.sidebar.selOnly, sel: st.sel })
    .filter((sec) => !st.sidebar.closed[sec.key])
    .flatMap((sec) => sec.rows.flatMap((r) => (r.kind === 'wire' ? [r.index] : [])));
}

export function handleKey(e: KeyboardEvent, k: KeyCtx): void {
  if (e.target instanceof HTMLInputElement) return;
  if (e.code === 'Space') k.setSpace(e.type === 'keydown');
  if (e.type !== 'keydown') return;
  const s = k.s;
  const meta = e.metaKey || e.ctrlKey;
  const key = e.key.toLowerCase();
  if (meta && key === 'z') {
    e.preventDefault();
    if (e.shiftKey) s.redo();
    else s.undo();
  } else if (meta && key === 'g') {
    e.preventDefault();
    if (e.shiftKey) unframeSelected(k);
    else frame(k);
  } else if (!meta && key === 'g') {
    // G frames; on a selection of frames only it unframes them
    const sel = s.state.sel;
    if (sel.length && sel.every(isGroupId)) unframeSelected(k);
    else frame(k);
  } else if (s.state.sidebar.open && !meta && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
    // WIRES: walk the wire rows that are showing
    e.preventDefault();
    const rows = visibleWires(k);
    if (!rows.length) return;
    const at = rows.indexOf(s.state.sidebar.picked ?? -1);
    const next =
      at < 0
        ? e.key === 'ArrowDown'
          ? 0
          : rows.length - 1
        : (at + (e.key === 'ArrowDown' ? 1 : rows.length - 1)) % rows.length;
    s.setState('sidebar', 'picked', rows[next]!);
  } else if (s.state.sidebar.open && !meta && e.key === 'Enter' && s.state.sidebar.picked !== null) {
    // WIRES: the port list for the picked wire's input end
    const cable = s.current().cables[s.state.sidebar.picked];
    if (!cable) return;
    e.preventDefault();
    s.setState('sidebar', 'ports', {
      index: s.state.sidebar.picked,
      end: 'to',
      fixed: [cable.from[0], cable.from[1]],
    });
  } else if (
    s.state.sidebar.open &&
    !meta &&
    (e.key === 'Backspace' || e.key === 'Delete') &&
    s.state.sidebar.picked !== null
  ) {
    // WIRES: remove the picked wire
    e.preventDefault();
    const i = s.state.sidebar.picked;
    s.setState('sidebar', 'picked', null);
    s.edit((d) => ({ ...d, cables: d.cables.filter((_, j) => j !== i) }));
  } else if (!meta && (e.key === 'Backspace' || e.key === 'Delete') && s.state.sel.length) {
    e.preventDefault();
    const before = s.current();
    s.commit(settle(before, deleteObjects(before, s.state.sel), k.specs));
  } else if (e.key === 'Escape') {
    if (k.pickerOpen()) k.closePicker();
    else if (s.state.listen) s.setListen(null);
    else if (s.state.sidebar.open) s.setState('sidebar', 'open', false);
    else s.setState('sel', []);
  } else if (!meta && key === 'w') {
    s.setState('sidebar', 'open', !s.state.sidebar.open);
  } else if (meta && key === 'd') {
    // ⌘D: copies of the selected modules with the cables between them
    e.preventDefault();
    const before = s.current();
    const sel = s.state.sel.filter((id) => !isGroupId(id));
    if (!sel.length) return;
    const { doc, ids } = duplicate(before, k.specs, sel);
    s.commit(settle(before, doc, k.specs));
    s.setState('sel', ids);
  } else if (!meta && key === 'r') {
    // R: the module under the pointer gets random knob values (sent as knob messages, one undo step)
    const id = s.state.hover;
    const m = id && s.current().modules.find((x) => x.id === id);
    if (!m) return;
    const after = randomise(s.current(), k.specs, m.id, Math.random).modules.find(
      (x) => x.id === m.id,
    )!.params;
    s.params(
      m.id,
      Object.fromEntries(Object.entries(after).filter(([p, v]) => m.params[p] !== v)),
      undefined,
    );
  } else if (meta && key === 's') {
    e.preventDefault();
    if (e.shiftKey) k.lib.saveAs();
    else void k.lib.save();
  } else if (meta && key === 'o') {
    e.preventDefault();
    k.openPicker(k.middle(), 'PROJECTS');
  } else if (e.key === '/' && !meta) {
    e.preventDefault();
    k.openPicker(k.pointer());
  } else if (key === 'f' && !meta) k.fit(e.shiftKey);
}
