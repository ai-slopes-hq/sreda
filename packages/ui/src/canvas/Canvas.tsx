import {
  addModule,
  blockOf,
  type Block,
  blockOwner,
  chainOf,
  canInsert,
  connect,
  FACTORY,
  insertIntoCable,
  replaceModule,
  portLabel,
  withDescendants,
  isGroupId,
  jackAt,
  landingFrame,
  moveObjects,
  setLayout,
  settle,
  shownRect,
  mulberry32,
  nameOf,
  rectOf,
  removeCable,
  resizeFrame,
  RATIOS,
  RuleError,
  TINTS,
  type Cable,
  type Doc,
  type Rect,
  type Role,
  type Specs,
} from '@sreda/core';
import { createEffect, createMemo, createSignal, For, on, onCleanup, Show, type JSX } from 'solid-js';
import type { SessionApi } from '../store';
import { diceChanges } from '../dice';
import { libraryActions } from '../library';
import { Cables } from './Cables';
import { focusSetOf, wholeNormal } from './focus';
import { cableAt, cableGeoms, stubAt } from './cablegeom';
import { magnet, type Snap } from './magnets';
import { animateView, glideTo } from './glide';
import { Chrome } from './Chrome';
import { DRAG_GROUP, DRAG_SAMPLE } from '../sidebar/Library';
import { Sidebar } from '../sidebar/Sidebar';
import { Frame, type BlockView, type Edge } from './Frame';
import { bez, ROLE } from './glyphs';
import { handleKey } from './keys';
import { Panel, type FieldKind, type SampleView } from './Panel';
import { placeFor, type End, type LibEntry, type PickerItem, type PickerTab } from './patching';
import { Icon } from './icons';
import { Picker } from './Picker';
import { Drawer } from '../seq/Drawer';
import { writeBack } from '../seq/mutate';
import { panned } from './wheel';
import './canvas.css';
import '../fonts';

const ZOOM = { min: 0.25, max: 2 };
/** pixels a pointer moves before a press becomes a drag */
const SLOP = 4;

interface JackEnd extends End {
  id: string;
  port: string;
}
type Pt = { x: number; y: number };
type Drag =
  | { kind: 'pan'; at: Pt; vx: number; vy: number }
  | { kind: 'wire'; from: JackEnd; picked: Cable | null; at: Pt; moved: boolean }
  | {
      kind: 'move';
      ids: string[];
      at: Pt;
      base: Doc;
      moved: boolean;
      insert: Cable | null;
      /** the move so far, magnets included */
      dx: number;
      dy: number;
      /** a META-SEQ the drawer switches to if the press ends without moving */
      seq?: string | undefined;
    }
  | { kind: 'resize'; id: string; edge: Edge; at: Pt; base: Doc; r0: Rect; moved: boolean }
  | { kind: 'box'; at: Pt; add: string[] }
  | { kind: 'field'; id: string; port: string; field: FieldKind; at: Pt; v0: number; key: string };

let strokes = 0;

/** The canvas: modules and cables on a layer panned (wheel, Space-drag) and zoomed (⌘-wheel / pinch); patching. */
export function Canvas(props: { session: SessionApi; specs: Specs }): JSX.Element {
  const s = props.session;
  const st = s.state;
  const specs = props.specs;
  const [closeEpoch, setCloseEpoch] = createSignal(0);
  const [ghost, setGhost] = createSignal<{ a: Pt; b: Pt; role: Role } | null>(null);
  const [box, setBox] = createSignal<{ a: Pt; b: Pt } | null>(null);
  const [wiring, setWiring] = createSignal<'in' | 'out' | null>(null);
  const [picker, setPicker] = createSignal<{
    screen: Pt;
    at: Pt;
    from: JackEnd | null;
    /** `<module> › <port>` of the jack the drag started on */
    fromName?: string;
    tab: PickerTab;
    /** REPLACE mode: the module being replaced */
    replace?: string;
  } | null>(null);
  const lib = libraryActions(s, specs);
  void lib.refresh();
  /** the groups and projects the picker offers: the factory's, then the library folder's */
  const factory: LibEntry[] = FACTORY.map((e) => ({
    kind: e.kind,
    path: `FACTORY/${e.name}`,
    factory: true,
  }));
  const library = () => [...factory, ...st.library];
  // the folder may have changed in the Finder: list it again whenever the picker opens
  createEffect(() => {
    if (picker()) void lib.refresh();
  });
  /** LOAD (a button or a click on the display): the file dialog, then the module has that sample (one undo step) */
  function loadInto(id: string): void {
    const bridge = window.sreda;
    if (!bridge) return;
    void bridge.library
      .pickOne()
      .then((path) => path && s.setSample(id, path))
      .catch(() => s.setState('notice', 'THE SAMPLE COULD NOT BE LOADED'));
  }
  /** a module gets a sample, or a SAMPLER with it lands at `at` */
  function useSample(path: string, target: string | undefined, at: Pt): void {
    if (target) {
      s.setSample(target, path);
      return;
    }
    const added = addModule(s.current(), specs, 'sampler', at.x, at.y);
    s.commit({
      ...added.doc,
      modules: added.doc.modules.map((m) => (m.id === added.id ? { ...m, sample: path } : m)),
    });
    s.setState('sel', [added.id]);
  }
  /** the SAMPLER / GRAINS panel under a drop, if any */
  function sampleTarget(e: DragEvent): string | undefined {
    const el = (e.target as Element).closest('[data-module]');
    const type = el?.getAttribute('data-type');
    return type === 'sampler' || type === 'grains'
      ? (el!.getAttribute('data-module') ?? undefined)
      : undefined;
  }
  /** a LIBRARY row dropped on the canvas: a group lands at the drop point, a sample goes where files would */
  function dropRow(e: DragEvent): boolean {
    const dt = e.dataTransfer;
    const group = dt?.getData(DRAG_GROUP);
    const sample = dt?.getData(DRAG_SAMPLE);
    if (!group && !sample) return false;
    e.preventDefault();
    const at = toCanvas(client(e));
    if (sample) useSample(sample, sampleTarget(e), at);
    else {
      const entry = library().find((x) => x.kind === 'group' && x.path === group);
      if (entry)
        void lib.read(entry).then((doc) => {
          if (doc) s.placeGroup(doc, at, null);
        });
    }
    return true;
  }
  /** files dropped from the Finder: audio is copied into samples/ (spec §7a) */
  function dropFiles(e: DragEvent): void {
    if (dropRow(e)) return;
    const files = [...(e.dataTransfer?.files ?? [])];
    if (!files.length) return;
    e.preventDefault();
    const bridge = window.sreda;
    if (!bridge) return;
    const target = sampleTarget(e);
    const at = toCanvas(client(e));
    const file = files[0]!;
    if (!/\.(wav|aiff?|flac|mp3|ogg)$/i.test(file.name)) {
      s.setState('notice', `NOT A SAMPLE · ${file.name}`);
      return;
    }
    void file
      .arrayBuffer()
      .then((bytes) => bridge.library.importSample(file.name, bytes))
      .then((path) => useSample(path, target, at))
      .catch(() => s.setState('notice', `${file.name.toUpperCase()} COULD NOT BE IMPORTED`));
  }
  /** the frame a dragged selection would land in */
  const [drop, setDrop] = createSignal<string | null>(null);
  let drag: Drag | null = null;
  let space = false;
  let pointer: Pt = { x: 400, y: 300 };

  const toCanvas = (p: Pt): Pt => ({ x: (p.x - st.view.x) / st.view.z, y: (p.y - st.view.y) / st.view.z });
  const client = (e: PointerEvent | MouseEvent): Pt => ({ x: e.clientX, y: e.clientY });
  const far = (a: Pt, b: Pt) => Math.abs(a.x - b.x) > SLOP || Math.abs(a.y - b.y) > SLOP;
  const cabledIn = (id: string, port: string) =>
    st.doc.cables.some((c) => c.to[0] === id && c.to[1] === port);
  const cabledOut = (id: string, port: string) =>
    st.doc.cables.some((c) => c.from[0] === id && c.from[1] === port);
  const loud = (id: string) =>
    st.hover === id || st.editing === id || (st.sel.length === 1 && st.sel[0] === id);
  const viewChanged = () => {
    setCloseEpoch(closeEpoch() + 1);
    setPicker(null);
  };

  /** every collapsed frame's block, once per document (a block scans all cables) */
  const blocks = createMemo(() => {
    const m = new Map<string, Block>();
    for (const g of st.doc.groups) if (g.collapsed) m.set(g.id, blockOf(st.doc, specs, g.id));
    return m;
  });
  const jackPos = (id: string, port: string): Pt => jackAt(st.doc, specs, id, port, blocks());
  /** a module's sample as its display shows it (re-read when the registry changes) */
  const sampleView = (path: string | undefined): SampleView | undefined => {
    if (!path) return undefined;
    void st.samplesVersion;
    const info = s.samples.info(path);
    return {
      path,
      missing: s.samples.status(path) === 'missing',
      peaks: s.samples.peaks(path),
      hits: info ? info.hits.map((h) => ({ at: h.at / info.frames, strength: h.strength })) : [],
    };
  };
  /** inside a muted frame (a muted frame's own header is not dimmed) */
  const dimmed = (id: string) =>
    chainOf(st.doc, id).some((g) => g !== id && st.doc.groups.find((x) => x.id === g)?.muted);
  /** frames, outer ones first (drawn under what they hold) */
  const frames = createMemo(() =>
    st.doc.groups
      .filter((g) => !blockOwner(st.doc, g.id))
      .sort((a, b) => chainOf(st.doc, a.id).length - chainOf(st.doc, b.id).length),
  );
  /** a collapsed frame's block with each jack's role, and whether it is cabled or listened to */
  function blockView(gid: string): BlockView {
    const b = blocks().get(gid) ?? blockOf(st.doc, specs, gid);
    return {
      w: b.w,
      h: b.h,
      jacks: b.jacks.map((j) => ({
        ...j,
        role: roleOf(j.id, j.port, j.dir),
        filled: j.dir === 'in' ? cabledIn(j.id, j.port) : cabledOut(j.id, j.port),
        listening: st.listen?.id === j.id && st.listen.port === j.port,
      })),
    };
  }
  function roleOf(id: string, port: string, dir: 'in' | 'out'): Role {
    const m = st.doc.modules.find((x) => x.id === id);
    if (!m) return 'trigger'; // a frame's CLK IN / CLK OUT
    const spec = specs[m.type]!;
    if (dir === 'out') return spec.outputs.find((p) => p.id === port)!.role;
    return port.startsWith('@') ? 'mod' : spec.inputs.find((p) => p.id === port)!.role;
  }

  const geoms = createMemo(() => cableGeoms(st.doc, specs));
  /** the wire under the pointer (within 6 screen px) and where the pointer is, for the tag */
  const [hovered, setHovered] = createSignal<{ cable: Cable; at: Pt } | null>(null);
  /** the cable a dragged module would go into */
  const [insert, setInsert] = createSignal<Cable | null>(null);
  /** the modules at both ends of the hovered wire (outlined) */
  /** the wire lit on the canvas: the one under the pointer, else the WIRES row hovered or picked */
  const litCable = (): Cable | null => {
    const h = hovered();
    if (h) return h.cable;
    const i = st.sidebar.open ? (st.sidebar.hover ?? st.sidebar.picked) : null;
    return i === null ? null : (st.doc.cables[i] ?? null);
  };
  /** the modules outlined in amber: both ends of the lit wire, and a port list's candidate */
  const wireEnds = () => {
    const c = litCable();
    return [...(c ? [c.from[0], c.to[0]] : []), ...(st.candidate ? [st.candidate.id] : [])];
  };
  /** a port list's dashed preview: from the end that stays to the candidate */
  const preview = () => {
    const f = st.sidebar.ports?.fixed;
    const c = st.candidate;
    if (!f || !c || !st.sidebar.open) return null;
    const a = jackPos(f[0], f[1]);
    const b = jackPos(c.id, c.port);
    // the fixed end is an output when the input is being chosen
    return st.sidebar.ports!.end === 'to' ? bez(a, b) : bez(b, a);
  };
  // a candidate (or a picked row) off-screen for 250 ms: the view glides to centre its module (220 ms, zoom kept)
  let glideTimer: ReturnType<typeof setTimeout> | undefined;
  let stopGlide = () => {};
  createEffect(
    on(
      () => [st.candidate?.id, st.sidebar.picked] as const,
      ([cand, picked]) => {
        clearTimeout(glideTimer);
        const id =
          cand ?? (picked !== null && picked !== undefined ? st.doc.cables[picked]?.to[0] : undefined);
        if (!id || !st.sidebar.open) return;
        glideTimer = setTimeout(() => {
          if (!st.doc.modules.some((m) => m.id === id) && !st.doc.groups.some((g) => g.id === id)) return;
          const to = glideTo(st.view, rectOf(st.doc, specs, id), { x: 0, y: 0, w: W(), h: H() });
          if (!to) return;
          stopGlide();
          stopGlide = animateView({ ...st.view }, to, 220, (v) => s.setState('view', v));
        }, 250);
      },
      { defer: true },
    ),
  );
  onCleanup(() => {
    clearTimeout(glideTimer);
    stopGlide();
  });
  /** the modules and frames whose cables are drawn whole: the hovered and the selected, with what is inside frames */
  const focusSet = createMemo(() => focusSetOf(st.doc, st.hover, st.sel));
  /** is this cable drawn whole (otherwise only its stubs): WIRES open, an end in the focus, or lit / inserting */
  const whole = (c: Cable): boolean => {
    if (st.sidebar.open) return true;
    const set = focusSet();
    if (set.has(c.from[0]) || set.has(c.to[0])) return true;
    const l = litCable();
    return (
      !!l && l.from[0] === c.from[0] && l.from[1] === c.from[1] && l.to[0] === c.to[0] && l.to[1] === c.to[1]
    );
  };
  function hoverWires(e: PointerEvent): void {
    pointer = client(e);
    if (drag || (e.target as Element).closest?.('.sr-picker, .sr-menu, input')) {
      if (hovered()) setHovered(null);
      return;
    }
    // a whole cable by its path, any cable by its stubs
    const gs = geoms();
    const at = toCanvas(pointer);
    const i = cableAt(gs, at, 6 / st.view.z, (g) => whole(g.cable));
    const j = i === null ? stubAt(gs, at, 6 / st.view.z) : null;
    const cable = i !== null ? gs[i]!.cable : j !== null ? gs[j]!.cable : null;
    const h = hovered();
    if (!cable) {
      if (h) setHovered(null);
    } else if (!h || h.cable !== cable || far(h.at, pointer)) setHovered({ cable, at: pointer });
  }
  const wireTag = () => {
    const h = hovered();
    if (!h) return null;
    const c = h.cable;
    return `${portLabel(st.doc, specs, c.from[0], c.from[1])}  →  ${portLabel(st.doc, specs, c.to[0], c.to[1])}`;
  };

  /** magnet guide lines while dragging */
  const [guides, setGuides] = createSignal<Pick<Snap, 'gx' | 'gy'> | null>(null);
  /** the snap for a moved selection: its bounding box against the modules not moving */
  function magnets(base: Doc, ids: string[], dx: number, dy: number): Snap | null {
    const moving = new Set(withDescendants(base, ids));
    const roots = ids.filter((id) => moving.has(id));
    if (!roots.length) return null;
    const rs = roots.map((id) => rectOf(base, specs, id));
    const x0 = Math.min(...rs.map((r) => r.x)) + dx;
    const y0 = Math.min(...rs.map((r) => r.y)) + dy;
    const box = {
      x: x0,
      y: y0,
      w: Math.max(...rs.map((r) => r.x + r.w)) + dx - x0,
      h: Math.max(...rs.map((r) => r.y + r.h)) + dy - y0,
    };
    const others = base.modules
      .filter((m) => !moving.has(m.id) && !blockOwner(base, m.id))
      .map((m) => rectOf(base, specs, m.id));
    return magnet(box, others, 10 / st.view.z);
  }

  const isSeq = (id: string) => st.doc.modules.some((m) => m.id === id && m.type === 'metaseq');
  // the editor drawer opens, switches or changes height: the canvas shrinks above it and scrolls its module into view
  createEffect(
    on(
      () => [st.seq.id, st.seq.h] as const,
      ([id], prev) => {
        if (!id) return;
        // opened or switched: glide; the top edge dragged: follow at once
        const glide = !prev || prev[0] !== id;
        requestAnimationFrame(() => {
          if (st.seq.id !== id || !isSeq(id)) return;
          const to = glideTo(st.view, rectOf(st.doc, specs, id), { x: 0, y: 0, w: W(), h: H() });
          if (!to) return;
          stopGlide();
          if (glide) stopGlide = animateView({ ...st.view }, to, 220, (v) => s.setState('view', v));
          else s.setState('view', to);
        });
      },
    ),
  );

  let root: HTMLDivElement | undefined;
  /** the canvas's own size (it ends at the sidebar's edge and above the editor drawer) */
  const W = () => root?.clientWidth || window.innerWidth;
  const H = () => root?.clientHeight || window.innerHeight;

  function begin(d: Drag): void {
    setHovered(null);
    drag = d;
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  // ── presses ──
  function jackDown(id: string, port: string, dir: 'in' | 'out', role: Role, e: PointerEvent): void {
    if (e.button !== 0) return;
    e.preventDefault();
    let from: JackEnd = { id, port, dir, role };
    let picked: Cable | null = null;
    if (dir === 'in') {
      // pick up the input's most recent cable and carry it from its source
      const cables = s.current().cables.filter((c) => c.to[0] === id && c.to[1] === port);
      picked = cables[cables.length - 1] ?? null;
      if (picked) {
        from = {
          id: picked.from[0],
          port: picked.from[1],
          dir: 'out',
          role: roleOf(picked.from[0], picked.from[1], 'out'),
        };
        s.preview(removeCable(s.current(), picked));
      }
    }
    begin({ kind: 'wire', from, picked, at: client(e), moved: false });
  }

  function frameResizeDown(id: string, edge: Edge, e: PointerEvent): void {
    const base = s.current();
    begin({ kind: 'resize', id, edge, at: client(e), base, r0: rectOf(base, specs, id), moved: false });
  }

  /** a module's face or a frame's header: select (Shift toggles) and start moving the selection */
  function moduleDown(id: string, e: PointerEvent): void {
    if (e.button !== 0 || space) return;
    e.stopPropagation();
    let sel = st.sel;
    if (e.shiftKey) sel = sel.includes(id) ? sel.filter((x) => x !== id) : [...sel, id];
    else if (!sel.includes(id)) sel = [id];
    s.setState('sel', sel);
    begin({
      kind: 'move',
      ids: sel,
      at: client(e),
      base: s.current(),
      moved: false,
      insert: null,
      dx: 0,
      dy: 0,
      // the editor drawer is open: a click (no drag, no Shift) on another META-SEQ switches it
      seq: st.seq.id !== null && st.seq.id !== id && !e.shiftKey && isSeq(id) ? id : undefined,
    });
  }

  function fieldDown(id: string, port: string, field: FieldKind, e: PointerEvent): void {
    if (e.button !== 0) return;
    e.stopPropagation();
    const doc = s.current();
    const m = doc.modules.find((x) => x.id === id);
    const ratio = m ? (m.ratios[port] ?? 1) : (doc.groups.find((g) => g.id === id)?.ratio ?? 1);
    const v0 = field === 'att' ? (m?.atts[port] ?? 1) : RATIOS.indexOf(ratio);
    s.setState('editing', id);
    begin({ kind: 'field', id, port, field, at: client(e), v0, key: `field:${id}:${port}:${++strokes}` });
  }

  function rootDown(e: PointerEvent): void {
    if (space || e.button === 1) {
      begin({ kind: 'pan', at: client(e), vx: st.view.x, vy: st.view.y });
      return;
    }
    if (e.button !== 0) return;
    // a press on empty canvas: a selection box (Shift adds to the selection)
    const add = e.shiftKey ? [...st.sel] : [];
    s.setState('sel', add);
    begin({ kind: 'box', at: client(e), add });
  }

  // ── moves ──
  function move(e: PointerEvent): void {
    const p = client(e);
    const d = drag;
    if (!d) return;
    switch (d.kind) {
      case 'pan':
        s.setState('view', { x: d.vx + p.x - d.at.x, y: d.vy + p.y - d.at.y, z: st.view.z });
        viewChanged();
        break;
      case 'wire':
        if (!d.moved && !far(p, d.at)) return;
        d.moved = true;
        setWiring(d.from.dir);
        setGhost({ a: jackPos(d.from.id, d.from.port), b: toCanvas(p), role: d.from.role });
        break;
      case 'move': {
        if (!d.moved && !far(p, d.at)) return;
        d.moved = true;
        let [dx, dy] = [(p.x - d.at.x) / st.view.z, (p.y - d.at.y) / st.view.z];
        // magnets (⌘ held: off): the moved box snaps to the modules around it
        const snap = e.metaKey ? null : magnets(d.base, d.ids, dx, dy);
        if (snap) [dx, dy] = [dx + snap.dx, dy + snap.dy];
        setGuides(snap && { gx: snap.gx, gy: snap.gy });
        [d.dx, d.dy] = [dx, dy];
        s.preview(moveObjects(d.base, specs, d.ids, dx, dy));
        setDrop(landingFrame(d.base, specs, d.ids, dx, dy));
        // a lone free module over a cable (within 8 screen px of the pointer) would go into it
        const id = d.ids[0]!;
        d.insert = null;
        if (d.ids.length === 1 && canInsert(d.base, specs, id)) {
          const gs = cableGeoms(d.base, specs).filter((g) => g.cable.from[0] !== id && g.cable.to[0] !== id);
          const hit = cableAt(gs, toCanvas(p), 8 / st.view.z);
          d.insert = hit === null ? null : gs[hit]!.cable;
        }
        setInsert(d.insert);
        break;
      }
      case 'resize': {
        if (!d.moved && !far(p, d.at)) return;
        d.moved = true;
        s.preview(resizeSettled(d, p));
        break;
      }
      case 'box': {
        setBox({ a: d.at, b: p });
        const a = toCanvas(d.at);
        const b = toCanvas(p);
        const [x0, x1, y0, y1] = [
          Math.min(a.x, b.x),
          Math.max(a.x, b.x),
          Math.min(a.y, b.y),
          Math.max(a.y, b.y),
        ];
        // modules the box touches, frames it fully encloses
        const hit = [
          ...st.doc.modules
            .filter((m) => {
              if (blockOwner(st.doc, m.id)) return false;
              const r = rectOf(st.doc, specs, m.id);
              return r.x < x1 && r.x + r.w > x0 && r.y < y1 && r.y + r.h > y0;
            })
            .map((m) => m.id),
          ...st.doc.groups
            .filter((g) => {
              if (blockOwner(st.doc, g.id)) return false;
              const r = shownRect(st.doc, specs, g.id, blocks());
              return r.x >= x0 && r.y >= y0 && r.x + r.w <= x1 && r.y + r.h <= y1;
            })
            .map((g) => g.id),
        ];
        s.setState('sel', [...new Set([...d.add, ...hit])]);
        break;
      }
      case 'field': {
        const dy = p.y - d.at.y;
        if (d.field === 'att')
          s.att(d.id, d.port, Math.round(Math.min(1, Math.max(-1, d.v0 - dy * 0.01)) * 100) / 100, {
            key: d.key,
            stroke: true,
          });
        else {
          const i = Math.min(RATIOS.length - 1, Math.max(0, d.v0 - Math.round(dy / 8)));
          if (isGroupId(d.id)) s.frame(d.id, { ratio: RATIOS[i]! }, { key: d.key, stroke: true });
          else s.ratio(d.id, d.port, RATIOS[i]!, { key: d.key, stroke: true });
        }
        break;
      }
    }
  }

  // ── releases ──
  function up(e: PointerEvent): void {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    const d = drag;
    drag = null;
    if (!d) return;
    const p = client(e);
    if (d.kind === 'wire') {
      setGhost(null);
      setWiring(null);
      finishWire(d, p);
    } else if (d.kind === 'move') {
      setDrop(null);
      setInsert(null);
      setGuides(null);
      if (d.moved) {
        const moved = moveObjects(d.base, specs, d.ids, d.dx, d.dy);
        // the STACK frames a module left, landed in or moved within re-pack
        const parents = (doc: Doc) =>
          d.ids.flatMap((id) => {
            const o = doc.modules.find((m) => m.id === id) ?? doc.groups.find((g) => g.id === id);
            return o?.parent ? [o.parent] : [];
          });
        const doc = d.insert ? insertIntoCable(moved, specs, d.ids[0]!, d.insert) : moved;
        s.commit(settle(d.base, doc, specs, [...parents(d.base), ...parents(moved)]));
      } else if (d.seq && st.seq.id !== null) s.openSeq(d.seq);
    } else if (d.kind === 'resize') {
      if (d.moved) {
        s.commit(resizeSettled(d, p));
      }
    } else if (d.kind === 'box') setBox(null);
    else if (d.kind === 'field') s.setState('editing', null);
  }

  /**
   * The document with a frame resized to the drag and settled: a free frame dragged by its left / top edge can land
   * in another parent, so the parent before and after both re-pack.
   */
  function resizeSettled(d: Extract<Drag, { kind: 'resize' }>, p: Pt): Doc {
    const next = resizeFrame(d.base, specs, d.id, resized(d, p));
    const parents = [d.base, next].flatMap((doc) => doc.groups.find((x) => x.id === d.id)?.parent ?? []);
    return settle(d.base, next, specs, parents);
  }

  /** a frame's rectangle while one of its edges is dragged (8 px steps) */
  function resized(d: Extract<Drag, { kind: 'resize' }>, p: Pt): Rect {
    const dx = Math.round((p.x - d.at.x) / st.view.z / 8) * 8;
    const dy = Math.round((p.y - d.at.y) / st.view.z / 8) * 8;
    const r = { ...d.r0 };
    if (d.edge === 'r' || d.edge === 'br') r.w += dx;
    if (d.edge === 'l' || d.edge === 'bl') {
      const w = Math.max(352, r.w - dx);
      r.x += r.w - w;
      r.w = w;
    }
    if (d.edge === 'b' || d.edge === 'br' || d.edge === 'bl') r.h += dy;
    return r;
  }

  function finishWire(d: Extract<Drag, { kind: 'wire' }>, p: Pt): void {
    const base = d.picked ? removeCable(s.current(), d.picked) : s.current();
    if (!d.moved) {
      if (d.picked)
        s.preview(s.current()); // a click on a patched input: nothing changes
      else if (d.from.dir === 'out') {
        const l = st.listen;
        s.setListen(
          l && l.id === d.from.id && l.port === d.from.port ? null : { id: d.from.id, port: d.from.port },
        );
      }
      return;
    }
    const el = document.elementFromPoint(p.x, p.y);
    const jackEl = el?.closest('[data-jack]') as HTMLElement | null;
    const modEl = el?.closest('[data-module],[data-frame]') as HTMLElement | null;
    if (jackEl && modEl) {
      try {
        s.commit(
          connect(
            base,
            specs,
            [d.from.id, d.from.port],
            [modEl.dataset['module'] ?? modEl.dataset['frame']!, jackEl.dataset['jack']!],
          ),
        );
      } catch (err) {
        if (!(err instanceof RuleError)) throw err;
        if (d.picked) s.commit(base);
        else s.preview(s.current());
      }
      return;
    }
    // released on empty canvas: a picked-up cable is gone; a new one asks what to add here
    if (d.picked) s.commit(base);
    else
      setPicker({
        screen: p,
        at: toCanvas(p),
        from: d.from,
        fromName: portLabel(st.doc, specs, d.from.id, d.from.port),
        tab: 'ALL',
      });
  }

  /** the picker's choice: a module (placed, wired from the jack it came from), a group, or a project */
  function place(item: PickerItem): void {
    const pk = picker();
    if (!pk) return;
    setPicker(null);
    if (pk.replace && item.kind === 'module') {
      const before = s.current();
      const { doc, id } = replaceModule(before, specs, pk.replace, item.type);
      s.commit(settle(before, doc, specs));
      s.setState('sel', [id]);
      return;
    }
    if (item.kind !== 'module') {
      void lib.read(item).then((doc) => {
        if (!doc) return;
        s.placeGroup(doc, pk.at, pk.from);
      });
      return;
    }
    const type = item.type;
    const where = placeFor(specs, type, pk.from, pk.at);
    const added = addModule(s.current(), specs, type, where.x, where.y);
    let doc = added.doc;
    if (pk.from && where.port) doc = connect(doc, specs, [pk.from.id, pk.from.port], [added.id, where.port]);
    s.commit(doc);
    s.setState('sel', [added.id]);
  }

  /** the params DICE writes into a module, as changes (sent as messages, not a plan) */
  const diced = (id: string) =>
    diceChanges(s.current(), specs, id, mulberry32((Math.random() * 2 ** 32) >>> 0));

  function fit(selection: boolean): void {
    const ids = [...st.doc.modules.map((m) => m.id), ...st.doc.groups.map((g) => g.id)].filter(
      (id) => (!selection || st.sel.includes(id)) && !blockOwner(st.doc, id),
    );
    if (!ids.length) return;
    let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
    for (const id of ids) {
      const r = shownRect(st.doc, specs, id, blocks());
      [x0, y0, x1, y1] = [
        Math.min(x0, r.x),
        Math.min(y0, r.y),
        Math.max(x1, r.x + r.w),
        Math.max(y1, r.y + r.h),
      ];
    }
    const z = Math.min(1.5, Math.max(ZOOM.min, Math.min((W() - 120) / (x1 - x0), (H() - 120) / (y1 - y0))));
    s.setState('view', {
      x: (W() - (x1 - x0) * z) / 2 - x0 * z,
      y: (H() - (y1 - y0) * z) / 2 - y0 * z,
      z,
    });
    viewChanged();
  }

  /** the zoom control: by a factor around the middle of the canvas, or back to 100 % */
  function zoomBy(f: number | null): void {
    const v = st.view;
    const z = f === null ? 1 : Math.min(ZOOM.max, Math.max(ZOOM.min, v.z * f));
    const [cx, cy] = [W() / 2, H() / 2];
    s.setState('view', { x: cx - ((cx - v.x) * z) / v.z, y: cy - ((cy - v.y) * z) / v.z, z });
    viewChanged();
  }

  function wheel(e: WheelEvent): void {
    e.preventDefault();
    const v = st.view;
    if (e.ctrlKey || e.metaKey) {
      const z = Math.min(ZOOM.max, Math.max(ZOOM.min, v.z * Math.exp(-e.deltaY * 0.01)));
      // keep the point under the pointer still
      s.setState('view', {
        x: e.clientX - ((e.clientX - v.x) * z) / v.z,
        y: e.clientY - ((e.clientY - v.y) * z) / v.z,
        z,
      });
    } else {
      s.setState('view', { x: v.x - e.deltaX, y: v.y - e.deltaY, z: v.z });
      panned();
    }
    viewChanged();
  }

  const key = (e: KeyboardEvent): void =>
    handleKey(e, {
      s,
      specs,
      pickerOpen: () => !!picker(),
      closePicker: () => setPicker(null),
      openPicker: (at, tab = 'ALL') => setPicker({ screen: at, at: toCanvas(at), from: null, tab }),
      middle: () => ({ x: W() / 2 - 150, y: H() / 3 }),
      pointer: () => pointer,
      fit,
      setSpace: (on) => (space = on),
      lib,
    });
  window.addEventListener('keydown', key);
  const offImport = window.sreda?.onImportSamples?.(() => void lib.importSamples());
  onCleanup(() => offImport?.());
  window.addEventListener('keyup', key);
  onCleanup(() => {
    window.removeEventListener('keydown', key);
    window.removeEventListener('keyup', key);
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
  });

  /** what is listened to: `OSC › OUT` */
  const listenText = () => {
    const l = st.listen;
    const g = l && st.doc.groups.find((x) => x.id === l.id);
    if (g) return `${g.name} › CLK`;
    const m = l && st.doc.modules.find((x) => x.id === l.id);
    if (!l || !m) return null;
    const port = specs[m.type]!.outputs.find((p) => p.id === l.port);
    return `${nameOf(st.doc, specs, l.id)} › ${port?.label ?? l.port}`;
  };

  return (
    <>
      <div
        ref={(el) => (root = el)}
        class="sr-canvas"
        classList={{
          'wiring-out': wiring() === 'out',
          'wiring-in': wiring() === 'in',
          'hovering-wire': !!hovered(),
        }}
        style={{
          // the canvas ends at the sidebar's edge
          right: st.sidebar.open ? st.sidebar.width + 'px' : '0',
          // and above META-SEQ's editor drawer
          bottom: st.seq.id ? st.seq.h + 'px' : '0',
          'background-size': `${16 * st.view.z}px ${16 * st.view.z}px`,
          'background-position': `${st.view.x}px ${st.view.y}px`,
        }}
        onWheel={wheel}
        onPointerDown={rootDown}
        onPointerMove={hoverWires}
        onPointerLeave={() => setHovered(null)}
        onDragOver={(e) => {
          const types = e.dataTransfer?.types ?? [];
          if (types.includes('Files') || types.includes(DRAG_GROUP) || types.includes(DRAG_SAMPLE))
            e.preventDefault();
        }}
        onDrop={dropFiles}
        onDblClick={(e) => {
          const target = e.target as Element;
          // a double-click on a control (a knob reset, a field reset, a jack, a button, a list) is that control's own
          if (
            target.closest('.sr-cell, .sr-jack, .sr-plabel, .sr-field, .sr-action, .sr-menu, button, input')
          )
            return;
          const seqMod = target.closest('[data-type=metaseq]');
          if (seqMod) {
            s.openSeq(seqMod.getAttribute('data-module')!);
            return;
          }
          if ((e.target as Element).closest('[data-module],[data-ghead]')) return;
          setPicker({ screen: client(e), at: toCanvas(client(e)), from: null, tab: 'ALL' });
        }}
      >
        <div
          class="sr-layer"
          style={{ transform: `translate(${st.view.x}px, ${st.view.y}px) scale(${st.view.z})` }}
        >
          <For each={frames()}>
            {(g) => {
              const block = createMemo(() => (g.collapsed ? blockView(g.id) : undefined));
              return (
                <Frame
                  group={g}
                  block={block()}
                  selected={st.sel.includes(g.id)}
                  drop={drop() === g.id}
                  cabledIn={cabledIn(g.id, 'clkIn')}
                  cabledOut={cabledOut(g.id, 'clkOut')}
                  normal={(() => {
                    const parent = g.parent && st.doc.groups.find((x) => x.id === g.parent);
                    return parent && !cabledIn(g.id, 'clkIn')
                      ? `CLK IN ← ${parent.name} (normal)`
                      : undefined;
                  })()}
                  listening={st.listen?.id === g.id}
                  dim={dimmed(g.id)}
                  meter={
                    st.audio ? s.layout().frames + st.doc.groups.findIndex((x) => x.id === g.id) : undefined
                  }
                  readouts={
                    st.audio && s.nodeOf(g.id) !== null ? s.layout().nodes[s.nodeOf(g.id)!] : undefined
                  }
                  act={{
                    headDown: (e) => moduleDown(g.id, e),
                    rename: (name) => s.frame(g.id, { name }, undefined),
                    tint: () => s.frame(g.id, { tint: (g.tint + 1) % TINTS }, undefined),
                    resizeDown: (edge, e) => frameResizeDown(g.id, edge, e),
                    hover: (on) => s.setState('hover', on ? g.id : st.hover === g.id ? null : st.hover),
                    clock: (c, merge) => s.frame(g.id, { clock: c }, merge),
                    jackDown: (port, e) =>
                      jackDown(g.id, port, port === 'clkIn' ? 'in' : 'out', 'trigger', e),
                    fieldDown: (e) => fieldDown(g.id, 'clkIn', 'ratio', e),
                    fieldReset: () => s.frame(g.id, { ratio: 1 }, undefined),
                    mute: () => s.frame(g.id, { muted: !g.muted }, undefined),
                    stack: () => {
                      const d = s.current();
                      const next = setLayout(d, specs, g.id, g.layout === 'stack' ? 'free' : 'stack');
                      s.commit(settle(d, next, specs, g.parent ? [g.parent] : []));
                    },
                    save: () => lib.saveGroup(g.id),
                    collapse: (on) => s.collapse([g.id], on),
                    blockJackDown: (j, e) => jackDown(j.id, j.port, j.dir, j.role, e),
                  }}
                />
              );
            }}
          </For>
          <For each={st.doc.modules.filter((m) => !blockOwner(st.doc, m.id))}>
            {(m) => {
              const node = () => s.nodeOf(m.id);
              // META-SEQ's mutated steps reach the document once per GATE cycle, without an undo step
              // (the id can change type when a document replaces this one: the watch follows the type)
              const mutation = writeBack(
                () => m.type,
                () => s.current().modules.find((x) => x.id === m.id)?.params,
                (changes) => s.params(m.id, changes, undefined, false),
              );
              return (
                <Panel
                  mod={m}
                  spec={specs[m.type]!}
                  name={nameOf(st.doc, specs, m.id)}
                  loud={loud(m.id)}
                  selected={st.sel.includes(m.id)}
                  cabledIn={(p) => cabledIn(m.id, p)}
                  cabledOut={(p) => cabledOut(m.id, p)}
                  listening={st.listen?.id === m.id ? st.listen.port : null}
                  readouts={st.audio && node() !== null ? s.layout().nodes[node()!] : undefined}
                  closeEpoch={closeEpoch()}
                  end={wireEnds().includes(m.id)}
                  candidate={st.candidate?.id === m.id ? st.candidate.port : null}
                  dim={dimmed(m.id)}
                  sample={sampleView(m.sample)}
                  device={s.midi.status()}
                  act={{
                    knob: (param, k, merge) => s.knob(m.id, param, k, merge),
                    option: (param, v, merge) => s.params(m.id, { [param]: v }, merge),
                    hover: (on) => s.setState('hover', on ? m.id : st.hover === m.id ? null : st.hover),
                    edit: (on) => s.setState('editing', on ? m.id : null),
                    depth: (param, v, merge) => s.att(m.id, '@' + param, v, merge),
                    jackDown: (port, dir, role, e) => jackDown(m.id, port, dir, role, e),
                    fieldDown: (port, kind, e) => fieldDown(m.id, port, kind, e),
                    fieldReset: (port, kind) =>
                      kind === 'att' ? s.att(m.id, port, null, undefined) : s.ratio(m.id, port, 1, undefined),
                    moduleDown: (e) => moduleDown(m.id, e),
                    replace: (e) =>
                      setPicker({
                        screen: client(e),
                        at: { x: m.x, y: m.y },
                        from: null,
                        tab: 'MODULES',
                        replace: m.id,
                      }),
                    action: (param) => {
                      if (param !== 'dice') return;
                      const changes = diced(m.id);
                      // every lane locked: no empty undo step
                      if (Object.keys(changes).length > 0) s.params(m.id, changes, undefined);
                    },
                    editParams: (changes, merge) => s.params(m.id, changes, merge),
                    load: () => loadInto(m.id),
                    fixed: (param, value) => s.sendFixed(m.id, param, value),
                    diceInput: () => {
                      const changes = diced(m.id);
                      if (Object.keys(changes).length > 0) s.params(m.id, changes, undefined, false);
                    },
                    openSeq: () => s.openSeq(m.id),
                    seqFrame: (buf, at) => mutation(buf, at, performance.now()),
                  }}
                />
              );
            }}
          </For>
          <Show when={guides()}>
            {(g) => (
              <>
                <Show when={g().gx}>
                  {(x) => (
                    <div
                      class="sr-guide"
                      style={{
                        left: x().x + 'px',
                        top: x().y0 + 'px',
                        width: '1px',
                        height: x().y1 - x().y0 + 'px',
                      }}
                    />
                  )}
                </Show>
                <Show when={g().gy}>
                  {(y) => (
                    <div
                      class="sr-guide"
                      style={{
                        left: y().x0 + 'px',
                        top: y().y + 'px',
                        width: y().x1 - y().x0 + 'px',
                        height: '1px',
                      }}
                    />
                  )}
                </Show>
              </>
            )}
          </Show>
          <Cables
            doc={st.doc}
            specs={specs}
            geoms={geoms()}
            hover={litCable()}
            whole={whole}
            wholeNormal={(a, b) => wholeNormal(st.sidebar.open, focusSet(), a, b)}
            insert={insert()}
          />
          <Show when={preview()}>
            {(d) => (
              <svg class="sr-cables">
                <path class="preview" d={d()} />
              </svg>
            )}
          </Show>
          <Show when={ghost()}>
            {(g) => (
              <svg class="sr-cables">
                <path
                  class="ghost"
                  d={`M${g().a.x} ${g().a.y} L${g().b.x} ${g().b.y}`}
                  style={{ stroke: ROLE[g().role] }}
                />
              </svg>
            )}
          </Show>
        </div>
        <Show when={box()}>
          {(b) => (
            <div
              class="sr-box"
              style={{
                left: Math.min(b().a.x, b().b.x) + 'px',
                top: Math.min(b().a.y, b().b.y) + 'px',
                width: Math.abs(b().b.x - b().a.x) + 'px',
                height: Math.abs(b().b.y - b().a.y) + 'px',
              }}
            />
          )}
        </Show>
        {/* keyed: the picker gets the value, so closing it never makes its props read a stale accessor */}
        <Show when={picker()} keyed>
          {(pk) => (
            <Picker
              specs={specs}
              x={pk.screen.x}
              y={pk.screen.y}
              bounds={() => ({ w: W(), h: H() })}
              from={pk.from}
              fromName={pk.fromName ?? null}
              library={library()}
              tab={pk.tab}
              replace={pk.replace ? nameOf(st.doc, specs, pk.replace) : null}
              pick={place}
              close={() => setPicker(null)}
            />
          )}
        </Show>
        <Show when={listenText()}>
          {(t) => (
            <div class="sr-listen" onPointerDown={(e) => e.stopPropagation()}>
              <Icon name="speaker" size={16} />
              <span class="lead">Listening to</span>
              <span class="what">{t()}</span>
              <button class="stop" aria-label="Stop listening" onClick={() => s.setListen(null)}>
                <Icon name="close" size={14} />
              </button>
            </div>
          )}
        </Show>
        <Show when={wireTag()}>
          {(t) => (
            <div
              class="sr-wtag"
              style={{ left: hovered()!.at.x + 14 + 'px', top: hovered()!.at.y + 14 + 'px' }}
            >
              <span class="dot" style={{ background: ROLE[roleOf(hovered()!.cable.from[0], hovered()!.cable.from[1], 'out')] }} />
              {t()}
            </div>
          )}
        </Show>
        <Chrome session={s} lib={lib} zoom={zoomBy} fit={() => requestAnimationFrame(() => fit(false))} />
        <Show when={!st.audio}>
          <div class="sr-line">CLICK TO START AUDIO</div>
        </Show>
        <Show when={st.notice}>
          <div class="sr-line notice">{st.notice}</div>
        </Show>
      </div>
      <Sidebar
        session={s}
        specs={specs}
        focus={(id) => {
          s.setState('sel', [id]);
          fit(true);
        }}
        lib={lib}
        entries={library()}
        fit={() => fit(false)}
        middle={() => toCanvas({ x: W() / 2, y: H() / 2 })}
      />
      <Show when={st.seq.id} keyed>
        {(id) => <Drawer session={s} specs={specs} id={id} />}
      </Show>
    </>
  );
}
