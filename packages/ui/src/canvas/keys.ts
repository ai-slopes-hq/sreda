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
  } else if (!meta && (e.key === 'Backspace' || e.key === 'Delete') && s.state.sel.length) {
    e.preventDefault();
    const before = s.current();
    s.commit(settle(before, deleteObjects(before, s.state.sel), k.specs));
  } else if (e.key === 'Escape') {
    if (k.pickerOpen()) k.closePicker();
    else if (s.state.listen) s.setListen(null);
    else s.setState('sel', []);
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
