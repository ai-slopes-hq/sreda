// The session: the document (with undo), the view, hover and listening; every structural change compiles a plan
// and sends it to the engine; a knob turn sends only a knob message.
import {
  compile,
  History,
  setParam,
  type Doc,
  type KnobParam,
  type Merge,
  type Plan,
  type Specs,
} from '@sreda/core';
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
    host?.post({ t: 'plan', plan });
    sendListen(); // a new plan clears listening in the engine
  }

  function show(doc: Doc): void {
    setState('doc', reconcile(structuredClone(doc), { key: 'id', merge: false }));
    scheduleSave(doc);
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
    nodeOf,
    layout: () => plan.layout,
    readout: (i: number): number => host?.readouts[i] ?? 0,
  };
}

export type SessionApi = ReturnType<typeof createSession>;
