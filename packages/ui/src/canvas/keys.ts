// The canvas keyboard (spec §4, §5): undo, delete, Esc, `/`, F, G.
import { deleteObjects, frameSelection, isGroupId, settle, unframe, type Specs } from '@sreda/core';
import type { SessionApi } from '../store';

type Pt = { x: number; y: number };

export interface KeyCtx {
  s: SessionApi;
  specs: Specs;
  pickerOpen(): boolean;
  closePicker(): void;
  /** open the picker at a screen point */
  openPicker(at: Pt): void;
  pointer(): Pt;
  fit(selection: boolean): void;
  setSpace(on: boolean): void;
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
  } else if (e.key === '/' && !meta) {
    e.preventDefault();
    k.openPicker(k.pointer());
  } else if (key === 'f' && !meta) k.fit(e.shiftKey);
}
