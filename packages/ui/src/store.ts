// The session: the document (with undo), the view, hover and listening; every structural change compiles a plan
// and sends it to the engine; a knob turn sends only a knob message.
import {
  clockNode,
  compile,
  connect,
  mergeDoc,
  recomputeParents,
  settle,
  editFrame,
  effectiveMuted,
  fromKnob,
  History,
  inputPorts,
  setAtt,
  setParam,
  setRatio,
  type Doc,
  type Group,
  type KnobParam,
  type Role,
  type Merge,
  type Plan,
  type Specs,
  blockOwner,
  revealFrames,
  setCollapsed,
} from '@sreda/core';
import { createSignal } from 'solid-js';
import { createStore, reconcile } from 'solid-js/store';
import { encodePlan, type ToEngine } from '@sreda/protocol';
import type { AudioHost } from './audio/host';
import { scheduleSave } from './autosave';
import { setLayoutSeq, setSource } from './live';
import type { LibEntry } from './canvas/patching';
import { createSampleRegistry } from './samples';
import type { SkinName } from './skins';

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
  /** the open project: its library path (factory ones are read-only), or `file` for an absolute path from ⌘O */
  project: { path: string; factory: boolean; file?: true } | null;
  /** changed since it was opened or saved (the `●` by the project name) */
  dirty: boolean;
  /** the name field of a save in progress */
  saving: Saving | null;
  /** the library folder's groups and projects (factory ones are added by the picker) */
  library: LibEntry[];
  sidebar: SidebarState;
  /** the chosen skin (SETTINGS) */
  skin: SkinName;
  /** the port a WIRES port list points at: ringed on the canvas */
  candidate: { id: string; port: string } | null;
  /** sample paths the library could not read (spec §7a: MISSING) */
  missing: string[];
  /** bumps when a sample is loaded, refused or found missing (displays re-read the registry) */
  samplesVersion: number;
}

/** The sidebar (spec §5a): docked right, WIRES, MIX and SETTINGS tabs. */
export interface SidebarState {
  open: boolean;
  /** the tab showing; kept for the session */
  tab: 'WIRES' | 'MIX' | 'SETTINGS' | 'LIBRARY';
  width: number;
  /** sample paths just imported (the LIBRARY tab marks them) */
  highlight: string[];
  /** SELECTION: only the wires touching the selection */
  selOnly: boolean;
  /** the filter field */
  q: string;
  /** collapsed sections */
  closed: Record<string, boolean>;
  /** the wire row picked with a click or ↑ / ↓ (an index into doc.cables) */
  picked: number | null;
  /** the wire row under the pointer */
  hover: number | null;
  /** the port list open on a row's end (or `+ new wire`); `fixed` is the end that stays */
  ports: PortsState | null;
}

export interface PortsState {
  /** the wire being moved, or a new wire */
  index: number | 'new';
  /** the end being chosen */
  end: 'from' | 'to';
  fixed: [string, string] | null;
}
export const SIDEBAR_WIDTH = 440;

/** A save waiting for its name: `confirm` holds a name that exists and is to be replaced on the next Enter. */
export interface Saving {
  kind: 'group' | 'project';
  /** the frame being saved as a group */
  gid?: string;
  name: string;
  confirm?: string;
  invalid?: boolean;
}

export function createSession(
  specs: Specs,
  initial: Doc,
  notice: string | null = null,
  project: Session['project'] = null,
) {
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
    project,
    dirty: false,
    saving: null,
    library: [],
    skin: 'DEFAULT',
    sidebar: {
      open: false,
      tab: 'WIRES',
      width: SIDEBAR_WIDTH,
      highlight: [],
      selOnly: false,
      q: '',
      closed: {},
      picked: null,
      hover: null,
      ports: null,
    },
    candidate: null,
    missing: [],
    samplesVersion: 0,
  });
  /** the document last opened or saved: anything else is unsaved */
  let saved: Doc = initial;
  /** the cables last shown (WIRES rows point into them) */
  let shownCables = initial.cables;
  const history = new History(initial);
  let host: AudioHost | null = null;
  let seq = 0;
  const samples = createSampleRegistry({
    read: (path) => window.sreda?.library.readSample(path) ?? Promise.reject(new Error('no library')),
    notice: (text) => setState('notice', text),
    changed: () => {
      updateMissing();
      setState('samplesVersion', (v) => v + 1);
      send();
    },
  });
  /** WIRES' MISSING rows: the document's samples the registry could not read */
  function updateMissing(): void {
    const missing = [...new Set(state.doc.modules.flatMap((m) => (m.sample ? [m.sample] : [])))].filter(
      (p) => samples.status(p) === 'missing',
    );
    if (missing.join('\0') !== state.missing.join('\0')) setState('missing', missing);
  }
  /** a module's sample as the engine's pool id (−1: none, or missing) */
  const sampleId = (path: string) => (samples.status(path) === 'missing' ? -1 : samples.id(path));
  samples.loadDoc(initial);
  let plan: Plan = compile(initial, specs, seq, sampleId);
  // reactive: panels re-register their live readouts when a new plan moves the offsets
  const [layout, setLayout] = createSignal(plan.layout);

  /** a module's plan node, or a frame's clock node */
  const nodeOf = (id: string): number | null => {
    const i = state.doc.modules.findIndex((m) => m.id === id);
    if (i >= 0) return i;
    return state.doc.groups.some((g) => g.id === id) ? clockNode(state.doc, id) : null;
  };

  function sendListen(): void {
    const l = state.listen;
    const node = l ? nodeOf(l.id) : null;
    const mod = node !== null ? state.doc.modules[node] : undefined;
    const port =
      !l || node === null ? -1 : mod ? specs[mod.type]!.outputs.findIndex((p) => p.id === l.port) : 0;
    host?.post({ t: 'listen', target: node !== null && port >= 0 ? { node, port } : null });
  }

  /** the document without positions and sizes: an edit that leaves it unchanged needs no new plan (a move) */
  let sentKey = '';
  /**
   * A knob, option, attenuverter, ratio, clock or mute message: the engine now differs from the last plan, so the
   * next send (an undo, say) must not be skipped as "nothing structural changed".
   */
  function message(msg: ToEngine): void {
    sentKey = '';
    host?.post(msg);
  }
  /** the master last sent to the engine (NaN: none yet) */
  let sentMaster = Number.NaN;
  function sendMaster(master: number): void {
    if (!host || master === sentMaster) return;
    sentMaster = master;
    host.post({ t: 'master', value: master });
  }
  const structure = (d: Doc): string =>
    JSON.stringify([
      d.modules.map((m) => [
        m.id,
        m.type,
        m.parent,
        m.params,
        m.atts,
        m.ratios,
        m.sample,
        m.sample && sampleId(m.sample),
      ]),
      d.cables,
      d.groups.map((g) => [g.id, g.parent, g.ratio, g.muted, g.clock]),
    ]);

  function send(force = false): void {
    if (!host) return;
    const key = structure(state.doc);
    if (!force && key === sentKey) return;
    plan = compile(state.doc, specs, ++seq, sampleId);
    sentKey = key;
    setLayoutSeq(seq);
    setLayout(plan.layout);
    host.post({ t: 'plan', seq, bytes: encodePlan(plan) });
    sendListen(); // a new plan clears listening in the engine
  }

  function show(doc: Doc): void {
    // WIRES rows are cable indices: when the cables change they mean other cables, so let go of them
    if (doc.cables !== shownCables) {
      shownCables = doc.cables;
      if (state.sidebar.picked !== null || state.sidebar.hover !== null || state.sidebar.ports)
        setState('sidebar', { picked: null, hover: null, ports: null });
      if (state.candidate) setState('candidate', null);
    }
    setState('doc', reconcile(structuredClone(doc), { key: 'id', merge: true }));
    samples.loadDoc(doc);
    sendMaster(doc.master); // an undo, a redo or an opened project can carry another master
    updateMissing(); // an undo can bring back a module whose sample is known to be missing
    setState('dirty', history.current !== saved);
    scheduleSave(doc, state.project);
    // selection and listening follow what still exists
    const ids = new Set([...doc.modules.map((m) => m.id), ...doc.groups.map((g) => g.id)]);
    // (inside a collapsed frame, an object is out of sight and out of the selection; listening stays)
    const shown = (id: string) => ids.has(id) && !blockOwner(doc, id);
    if (state.sel.some((id) => !shown(id))) setState('sel', state.sel.filter(shown));
    if (state.hover !== null && !shown(state.hover)) setState('hover', null);
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
    /** the sample registry (SAMPLER, GRAINS, the SAMPLES picker) */
    samples,
    /** after the first click: the engine starts playing the current document */
    attach(h: AudioHost): void {
      host = h;
      h.onMessage = (msg) => {
        if (msg.code !== 0)
          setState('notice', `THE ENGINE REFUSED THE PATCH (${msg.code}) — THE PREVIOUS ONE KEEPS PLAYING`);
      };
      h.onError = () => setState('notice', 'THE AUDIO ENGINE STOPPED — RESTART THE APP');
      setSource(h.readouts);
      setState('audio', true);
      samples.attach((msg) => h.post(msg), h.sampleRate);
      send(true);
      sendMaster(history.current.master);
      h.post({ t: 'fade', ms: 200 }); // the patch fades in
    },
    commit(doc: Doc, merge?: Merge): void {
      history.commit(doc, merge);
      show(doc);
      send();
    },
    /** a module's sample (one undo step; the sample loads and the plan follows) */
    setSample(id: string, path: string): void {
      const doc: Doc = {
        ...history.current,
        modules: history.current.modules.map((m) => (m.id === id ? { ...m, sample: path } : m)),
      };
      history.commit(doc);
      show(doc);
      send();
    },
    /** a change made by the patch itself (a DICE input): shown, saved and played, but not an undo step */
    replaceDoc(doc: Doc): void {
      history.replace(doc);
      show(doc);
      send();
    },
    /**
     * Params of one module changed (an option, a display edit, DICE): visible knobs go as knob messages, options and
     * hidden knobs as fixed messages — no new plan, unless a param decides one of the module's own normals.
     * `undoable` false: a change made by the patch itself (no undo step).
     */
    params(id: string, changes: Record<string, number>, merge: Merge, undoable = true): void {
      let doc = history.current;
      for (const [k, v] of Object.entries(changes)) doc = setParam(doc, specs, id, k, v);
      if (undoable) history.commit(doc, merge);
      else history.replace(doc);
      show(doc);
      const node = nodeOf(id);
      const m = doc.modules.find((x) => x.id === id);
      const spec = m && specs[m.type];
      if (node === null || !m || !spec) return;
      const structural = Object.keys(changes).some((k) =>
        spec.normals.some((n) => n.kind === 'own' && n.when?.param === k),
      );
      if (structural) {
        send();
        return;
      }
      const visible = spec.params.filter((p): p is KnobParam => p.kind === 'knob' && !p.hidden);
      const fixed = spec.params.filter((p) => p.kind === 'option' || (p.kind === 'knob' && p.hidden));
      for (const k of Object.keys(changes)) {
        const v = visible.findIndex((p) => p.id === k);
        if (v >= 0) {
          message({ t: 'knob', node, index: v, value: m.params[k]! });
          continue;
        }
        const f = fixed.findIndex((p) => p.id === k);
        const p = fixed[f];
        if (!p) continue;
        message({
          t: 'fixed',
          node,
          index: f,
          value: p.kind === 'knob' ? fromKnob(p, m.params[k]!) : m.params[k]!,
        });
      }
    },
    /**
     * A frame's name, tint, clock, CLK IN ratio or mute: the document, and messages to the engine (no new plan).
     */
    frame(
      gid: string,
      patch: Partial<Pick<Group, 'name' | 'tint' | 'muted' | 'ratio' | 'clock'>>,
      merge: Merge,
    ): void {
      const before = history.current;
      const doc = editFrame(before, gid, patch);
      history.commit(doc, merge);
      show(doc);
      const node = nodeOf(gid);
      if (node === null) return;
      if (patch.clock) {
        message({ t: 'fixed', node, index: 0, value: patch.clock.on ? 1 : 0 });
        message({ t: 'fixed', node, index: 1, value: patch.clock.bpm });
      }
      if (patch.ratio !== undefined) message({ t: 'ratio', node, input: 0, value: patch.ratio });
      if (patch.muted !== undefined)
        // a frame inside a muted frame is muted too: tell the engine about every frame whose state changed
        doc.groups.forEach((g, frame) => {
          const on = effectiveMuted(doc, g.id);
          if (on !== effectiveMuted(before, g.id)) message({ t: 'mute', frame, on });
        });
    },
    /** A project replaces the canvas: one undo step; the speakers fade in over 200 ms. */
    openProject(doc: Doc, project: NonNullable<Session['project']>): void {
      setState('project', null); // a store set would merge into the old project (a stale `file`)
      setState('project', project);
      // the sidebar opens at its fixed width with every opened project
      setState('sidebar', { width: SIDEBAR_WIDTH, picked: null });
      this.commit(doc);
      this.markSaved();
      host?.post({ t: 'fade', ms: 200 });
    },
    /** the current document is what is saved now */
    markSaved(): void {
      saved = history.current;
      setState('dirty', false);
    },
    setProject(project: Session['project']): void {
      setState('project', null);
      setState('project', project);
      scheduleSave(history.current, project);
    },
    /**
     * A group lands with its frame's top-left at `at`, with fresh ids, in whatever frame it lands in; opened from a
     * trigger output, that output is cabled into the group's CLK IN. Selects it.
     */
    placeGroup(
      src: Doc,
      at: { x: number; y: number },
      from: { id: string; port: string; dir: 'in' | 'out'; role: Role } | null,
    ): void {
      const top = src.groups.find((g) => g.parent === null);
      if (!top) return;
      const before = history.current;
      const { doc: merged, map } = mergeDoc(before, src, Math.round(at.x - top.x), Math.round(at.y - top.y));
      const gid = map[top.id]!;
      let doc = recomputeParents(merged, specs, [gid], Object.values(map));
      if (from?.dir === 'out' && from.role === 'trigger')
        doc = connect(doc, specs, [from.id, from.port], [gid, 'clkIn']);
      this.commit(settle(before, doc, specs));
      setState('sel', [gid]);
    },
    /** C: collapse or expand frames (one undo step) */
    collapse(gids: readonly string[], on: boolean): void {
      this.commit(setCollapsed(history.current, gids, on));
    },
    /** WIRES: pick a row; a wire hidden in collapsed frames expands every one of them (one undo step) */
    pickWire(index: number): void {
      const cable = history.current.cables[index];
      const frames = cable ? revealFrames(history.current, cable) : [];
      if (frames.length) this.collapse(frames, false);
      setState('sidebar', 'picked', index);
    },
    /** WIRES arrows: only pick the row; a wire hidden in a collapsed frame stays hidden until a click or Enter */
    pickRow(index: number): void {
      setState('sidebar', 'picked', index);
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
      message({
        t: 'knob',
        node,
        index: visible.findIndex((p) => p.id === param),
        value: doc.modules[node]!.params[param]!,
      });
    },
    /** the master fader (MIX): one undo step per drag; a master message, no new plan */
    setMaster(v: number, merge: Merge): void {
      const doc: Doc = { ...history.current, master: Math.min(1, Math.max(0, v)) };
      history.commit(doc, merge);
      show(doc);
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
      if (at) message({ t: 'att', ...at, value: v ?? def });
    },
    /** a ratio drag: the document and a ratio message */
    ratio(id: string, port: string, r: number, merge: Merge): void {
      const doc = setRatio(history.current, id, port, r);
      history.commit(doc, merge);
      show(doc);
      const at = inputIndex(id, port);
      if (at) message({ t: 'ratio', ...at, value: r });
    },
    /** show a document while a gesture is under way (no undo step, no save, no plan) */
    preview(doc: Doc): void {
      setState('doc', reconcile(structuredClone(doc), { key: 'id', merge: true }));
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
