// The session: the document (with undo), the view, hover and listening; every structural change compiles a plan
// and sends it to the engine; a knob turn sends only a knob message.
import {
  compile,
  History,
  inputPorts,
  setAtt,
  setParam,
  setRatio,
  type Doc,
  type KnobParam,
  type Merge,
  type Plan,
  type Specs,
} from '@sreda/core';
import { createSignal } from 'solid-js';
import { createStore, reconcile } from 'solid-js/store';
import type { AudioHost } from './audio/host';
import { scheduleSave } from './autosave';
import { setSeq, setSource } from './live';

export interface Session {
  doc: Doc;
  view: { x: number; y: number; z: number };
  sel: string[];
  hover: string | null;
  /** the module being edited (a knob drag): its values stay visible */
  editing: string | null;
  listen: { id: string; port: string } | null;
  notice: string | null;
  audio: boolean;
}

export function createSession(specs: Specs, initial: Doc, notice: string | null = null) {
  // the store gets copies: Solid updates its objects in place, and history snapshots must stay untouched
  const [state, setState] = createStore<Session>({
    doc: structuredClone(initial),
    view: { x: 80, y: 120, z: 1 },
    sel: [],
    hover: null,
    editing: null,
    listen: null,
    notice,
    audio: false,
  });
  const history = new History(initial);
  let host: AudioHost | null = null;
  let seq = 0;
  let plan: Plan = compile(initial, specs, seq);
  // reactive: panels re-register their live readouts when a new plan moves the offsets
  const [layout, setLayout] = createSignal(plan.layout);

  const nodeOf = (id: string): number | null => {
    const i = state.doc.modules.findIndex((m) => m.id === id);
    return i < 0 ? null : i;
  };

  function sendListen(): void {
    const l = state.listen;
    const node = l ? nodeOf(l.id) : null;
    const port =
      l && node !== null
        ? specs[state.doc.modules[node]!.type]!.outputs.findIndex((p) => p.id === l.port)
        : -1;
    host?.post({ t: 'listen', target: node !== null && port >= 0 ? { node, port } : null });
  }

  function send(): void {
    plan = compile(state.doc, specs, ++seq);
    setSeq(seq);
    setLayout(plan.layout);
    host?.post({ t: 'plan', plan });
    sendListen(); // a new plan clears listening in the engine
  }

  function show(doc: Doc): void {
    setState('doc', reconcile(structuredClone(doc), { key: 'id', merge: false }));
    scheduleSave(doc);
    // selection and listening follow what still exists
    const ids = new Set(doc.modules.map((m) => m.id));
    if (state.sel.some((id) => !ids.has(id)))
      setState(
        'sel',
        state.sel.filter((id) => ids.has(id)),
      );
    if (state.listen && !ids.has(state.listen.id)) setState('listen', null);
  }

  /** an input's index in the plan (inputs, then mod jacks) */
  function inputIndex(id: string, port: string): { node: number; input: number } | null {
    const node = nodeOf(id);
    if (node === null) return null;
    const input = inputPorts(specs[state.doc.modules[node]!.type]!).findIndex((p) => p.id === port);
    return input < 0 ? null : { node, input };
  }

  return {
    state,
    setState,
    /** after the first click: the engine starts playing the current document */
    attach(h: AudioHost): void {
      host = h;
      setSource(h.readouts);
      setState('audio', true);
      send();
    },
    commit(doc: Doc, merge?: Merge): void {
      history.commit(doc, merge);
      show(doc);
      send();
    },
    /** an edit of the current document (never of the store's copy) */
    edit(f: (doc: Doc) => Doc, merge?: Merge): void {
      this.commit(f(history.current), merge);
    },
    undo(): void {
      const d = history.undo();
      if (d) {
        show(d);
        send();
      }
    },
    redo(): void {
      const d = history.redo();
      if (d) {
        show(d);
        send();
      }
    },
    /** a knob turn: the document and a knob message, no new plan */
    knob(id: string, param: string, knob: number, merge: Merge): void {
      const doc = setParam(history.current, specs, id, param, knob);
      history.commit(doc, merge);
      show(doc);
      const node = nodeOf(id);
      const m = state.doc.modules[node ?? -1];
      if (node === null || !m) return;
      const visible = specs[m.type]!.params.filter((p): p is KnobParam => p.kind === 'knob' && !p.hidden);
      host?.post({
        t: 'knob',
        node,
        index: visible.findIndex((p) => p.id === param),
        value: doc.modules[node]!.params[param]!,
      });
    },
    /** an attenuverter drag: the document and an att message, no new plan */
    att(id: string, port: string, v: number | null, merge: Merge): void {
      const doc = setAtt(history.current, id, port, v);
      history.commit(doc, merge);
      show(doc);
      const at = inputIndex(id, port);
      const spec = specs[doc.modules.find((m) => m.id === id)!.type]!;
      const knob = spec.params.find((p) => '@' + p.id === port);
      const def = knob?.kind === 'knob' ? (knob.modDepth ?? 1) : 1;
      if (at) host?.post({ t: 'att', ...at, value: v ?? def });
    },
    /** a ratio drag: the document and a ratio message */
    ratio(id: string, port: string, r: number, merge: Merge): void {
      const doc = setRatio(history.current, id, port, r);
      history.commit(doc, merge);
      show(doc);
      const at = inputIndex(id, port);
      if (at) host?.post({ t: 'ratio', ...at, value: r });
    },
    /** show a document while a gesture is under way (no undo step, no save, no plan) */
    preview(doc: Doc): void {
      setState('doc', reconcile(structuredClone(doc), { key: 'id', merge: false }));
    },
    current: (): Doc => history.current,
    setListen(l: { id: string; port: string } | null): void {
      setState('listen', l);
      sendListen();
    },
    nodeOf,
    layout,
    readout: (i: number): number => host?.readouts[i] ?? 0,
  };
}

export type SessionApi = ReturnType<typeof createSession>;
