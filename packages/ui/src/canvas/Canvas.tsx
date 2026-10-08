import {
  addModule,
  chainOf,
  connect,
  isGroupId,
  jackAt,
  landingFrame,
  moveObjects,
  packFrame,
  setLayout,
  settle,
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
import { createMemo, createSignal, For, onCleanup, Show, type JSX } from 'solid-js';
import type { SessionApi } from '../store';
import { diceModule } from '../dice';
import { Cables } from './Cables';
import { Frame, type Edge } from './Frame';
import { ROLE } from './glyphs';
import { handleKey } from './keys';
import { Panel, type FieldKind } from './Panel';
import { placeFor, type End } from './patching';
import { Picker } from './Picker';
import { panned } from './wheel';
import './canvas.css';

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
  | { kind: 'move'; ids: string[]; at: Pt; base: Doc; moved: boolean }
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
  const [picker, setPicker] = createSignal<{ screen: Pt; at: Pt; from: JackEnd | null } | null>(null);
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

  const jackPos = (id: string, port: string): Pt => jackAt(st.doc, specs, id, port);
  /** inside a muted frame (a muted frame's own header is not dimmed) */
  const dimmed = (id: string) =>
    chainOf(st.doc, id).some((g) => g !== id && st.doc.groups.find((x) => x.id === g)?.muted);
  /** frames, outer ones first (drawn under what they hold) */
  const frames = createMemo(() =>
    [...st.doc.groups].sort((a, b) => chainOf(st.doc, a.id).length - chainOf(st.doc, b.id).length),
  );
  function roleOf(id: string, port: string, dir: 'in' | 'out'): Role {
    const m = st.doc.modules.find((x) => x.id === id);
    if (!m) return 'trigger'; // a frame's CLK IN / CLK OUT
    const spec = specs[m.type]!;
    if (dir === 'out') return spec.outputs.find((p) => p.id === port)!.role;
    return port.startsWith('@') ? 'mod' : spec.inputs.find((p) => p.id === port)!.role;
  }

  function begin(d: Drag): void {
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
    begin({ kind: 'move', ids: sel, at: client(e), base: s.current(), moved: false });
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
        const [dx, dy] = [(p.x - d.at.x) / st.view.z, (p.y - d.at.y) / st.view.z];
        s.preview(moveObjects(d.base, specs, d.ids, dx, dy));
        setDrop(landingFrame(d.base, specs, d.ids, dx, dy));
        break;
      }
      case 'resize': {
        if (!d.moved && !far(p, d.at)) return;
        d.moved = true;
        s.preview(resizeFrame(d.base, specs, d.id, resized(d, p)));
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
              const r = rectOf(st.doc, specs, m.id);
              return r.x < x1 && r.x + r.w > x0 && r.y < y1 && r.y + r.h > y0;
            })
            .map((m) => m.id),
          ...st.doc.groups
            .filter((g) => g.x >= x0 && g.y >= y0 && g.x + g.w <= x1 && g.y + g.h <= y1)
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
      if (d.moved) {
        const moved = moveObjects(
          d.base,
          specs,
          d.ids,
          (p.x - d.at.x) / st.view.z,
          (p.y - d.at.y) / st.view.z,
        );
        // the WIRE FIX frames a module left, landed in or moved within re-pack
        const parents = (doc: Doc) =>
          d.ids.flatMap((id) => {
            const o = doc.modules.find((m) => m.id === id) ?? doc.groups.find((g) => g.id === id);
            return o?.parent ? [o.parent] : [];
          });
        s.commit(settle(d.base, moved, specs, [...parents(d.base), ...parents(moved)]));
      }
    } else if (d.kind === 'resize') {
      if (d.moved) s.commit(settle(d.base, resizeFrame(d.base, specs, d.id, resized(d, p)), specs));
    } else if (d.kind === 'box') setBox(null);
    else if (d.kind === 'field') s.setState('editing', null);
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
    else setPicker({ screen: p, at: toCanvas(p), from: d.from });
  }

  function place(type: string): void {
    const pk = picker();
    if (!pk) return;
    setPicker(null);
    const where = placeFor(specs, type, pk.from, pk.at);
    const added = addModule(s.current(), specs, type, where.x, where.y);
    let doc = added.doc;
    if (pk.from && where.port) doc = connect(doc, specs, [pk.from.id, pk.from.port], [added.id, where.port]);
    s.commit(doc);
    s.setState('sel', [added.id]);
  }

  /** the params DICE writes into a module, as changes (sent as messages, not a plan) */
  function diced(id: string): Record<string, number> {
    const after = diceModule(s.current(), specs, id, mulberry32((Math.random() * 2 ** 32) >>> 0));
    const before = s.current().modules.find((x) => x.id === id)!.params;
    const now = after.modules.find((x) => x.id === id)!.params;
    return Object.fromEntries(Object.entries(now).filter(([k, v]) => before[k] !== v));
  }

  function fit(selection: boolean): void {
    const ids = [...st.doc.modules.map((m) => m.id), ...st.doc.groups.map((g) => g.id)].filter(
      (id) => !selection || st.sel.includes(id),
    );
    if (!ids.length) return;
    let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
    for (const id of ids) {
      const r = rectOf(st.doc, specs, id);
      [x0, y0, x1, y1] = [
        Math.min(x0, r.x),
        Math.min(y0, r.y),
        Math.max(x1, r.x + r.w),
        Math.max(y1, r.y + r.h),
      ];
    }
    const z = Math.min(
      1.5,
      Math.max(ZOOM.min, Math.min((innerWidth - 120) / (x1 - x0), (innerHeight - 120) / (y1 - y0))),
    );
    s.setState('view', {
      x: (innerWidth - (x1 - x0) * z) / 2 - x0 * z,
      y: (innerHeight - (y1 - y0) * z) / 2 - y0 * z,
      z,
    });
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
      openPicker: (at) => setPicker({ screen: at, at: toCanvas(at), from: null }),
      pointer: () => pointer,
      fit,
      setSpace: (on) => (space = on),
    });
  window.addEventListener('keydown', key);
  window.addEventListener('keyup', key);
  onCleanup(() => {
    window.removeEventListener('keydown', key);
    window.removeEventListener('keyup', key);
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
  });

  const listenText = () => {
    const l = st.listen;
    const g = l && st.doc.groups.find((x) => x.id === l.id);
    if (g) return `LISTENING · ${g.name} › CLK`;
    const m = l && st.doc.modules.find((x) => x.id === l.id);
    if (!l || !m) return null;
    const port = specs[m.type]!.outputs.find((p) => p.id === l.port);
    return `LISTENING · ${nameOf(st.doc, specs, l.id)} › ${port?.label ?? l.port}`;
  };

  return (
    <div
      class="sr-canvas"
      classList={{ 'wiring-out': wiring() === 'out', 'wiring-in': wiring() === 'in' }}
      style={{
        'background-size': `${16 * st.view.z}px ${16 * st.view.z}px`,
        'background-position': `${st.view.x}px ${st.view.y}px`,
      }}
      onWheel={wheel}
      onPointerDown={rootDown}
      onPointerMove={(e) => (pointer = client(e))}
      onDblClick={(e) => {
        if ((e.target as Element).closest('[data-module],[data-ghead]')) return;
        setPicker({ screen: client(e), at: toCanvas(client(e)), from: null });
      }}
    >
      <div
        class="sr-layer"
        style={{ transform: `translate(${st.view.x}px, ${st.view.y}px) scale(${st.view.z})` }}
      >
        <For each={frames()}>
          {(g) => (
            <Frame
              group={g}
              selected={st.sel.includes(g.id)}
              drop={drop() === g.id}
              cabledIn={cabledIn(g.id, 'clkIn')}
              cabledOut={cabledOut(g.id, 'clkOut')}
              normal={(() => {
                const parent = g.parent && st.doc.groups.find((x) => x.id === g.parent);
                return parent && !cabledIn(g.id, 'clkIn') ? `CLK IN ← ${parent.name} (normal)` : undefined;
              })()}
              listening={st.listen?.id === g.id}
              dim={dimmed(g.id)}
              meter={st.audio ? s.layout().frames + st.doc.groups.findIndex((x) => x.id === g.id) : undefined}
              readouts={st.audio && s.nodeOf(g.id) !== null ? s.layout().nodes[s.nodeOf(g.id)!] : undefined}
              act={{
                headDown: (e) => moduleDown(g.id, e),
                rename: (name) => s.frame(g.id, { name }, undefined),
                tint: () => s.frame(g.id, { tint: (g.tint + 1) % TINTS }, undefined),
                resizeDown: (edge, e) => frameResizeDown(g.id, edge, e),
                hover: () => undefined,
                clock: (c, merge) => s.frame(g.id, { clock: c }, merge),
                jackDown: (port, e) => jackDown(g.id, port, port === 'clkIn' ? 'in' : 'out', 'trigger', e),
                fieldDown: (e) => fieldDown(g.id, 'clkIn', 'ratio', e),
                fieldReset: () => s.frame(g.id, { ratio: 1 }, undefined),
                mute: () => s.frame(g.id, { muted: !g.muted }, undefined),
                stack: () => {
                  const d = s.current();
                  s.commit(settle(d, packFrame(d, specs, g.id, 'stack'), specs, g.parent ? [g.parent] : []));
                },
                fix: () => {
                  const d = s.current();
                  const next = setLayout(d, specs, g.id, g.layout === 'route' ? 'free' : 'route');
                  s.commit(settle(d, next, specs, g.parent ? [g.parent] : []));
                },
              }}
            />
          )}
        </For>
        <For each={st.doc.modules}>
          {(m) => {
            const node = () => s.nodeOf(m.id);
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
                dim={dimmed(m.id)}
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
                  action: (param) => {
                    if (param === 'dice') s.params(m.id, diced(m.id), undefined);
                  },
                  editParams: (changes, merge) => s.params(m.id, changes, merge),
                  diceInput: () => s.params(m.id, diced(m.id), undefined, false),
                }}
              />
            );
          }}
        </For>
        <Cables doc={st.doc} specs={specs} />
        <Show when={ghost()}>
          {(g) => (
            <svg class="sr-cables">
              <path
                class="ghost"
                d={`M${g().a.x} ${g().a.y} L${g().b.x} ${g().b.y}`}
                stroke={ROLE[g().role]}
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
      <Show when={picker()}>
        {(pk) => (
          <Picker
            specs={specs}
            x={Math.min(pk().screen.x, innerWidth - 300)}
            y={Math.min(pk().screen.y, innerHeight - 340)}
            from={pk().from}
            pick={place}
            close={() => setPicker(null)}
          />
        )}
      </Show>
      <Show when={listenText()}>
        {(t) => (
          <div class="sr-listen" onPointerDown={(e) => e.stopPropagation()} onClick={() => s.setListen(null)}>
            {t()}
          </div>
        )}
      </Show>
      <Show when={!st.audio}>
        <div class="sr-line">CLICK TO START AUDIO</div>
      </Show>
      <Show when={st.notice}>
        <div class="sr-line notice">{st.notice}</div>
      </Show>
    </div>
  );
}
