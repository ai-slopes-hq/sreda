import { nameOf, setParam, type Specs } from '@sreda/core';
import { createSignal, For, onCleanup, Show, type JSX } from 'solid-js';
import type { SessionApi } from '../store';
import { Cables } from './Cables';
import { Panel } from './Panel';
import './canvas.css';

const ZOOM = { min: 0.25, max: 2 };

/** The canvas: modules and cables on a layer panned (wheel, Space-drag) and zoomed (⌘-wheel / pinch). */
export function Canvas(props: { session: SessionApi; specs: Specs }): JSX.Element {
  const s = props.session;
  const st = s.state;
  const [closeEpoch, setCloseEpoch] = createSignal(0);
  let space = false;
  let pan: { x: number; y: number; vx: number; vy: number } | null = null;

  const cabledIn = (id: string, port: string) =>
    st.doc.cables.some((c) => c.to[0] === id && c.to[1] === port);
  const cabledOut = (id: string, port: string) =>
    st.doc.cables.some((c) => c.from[0] === id && c.from[1] === port);
  const loud = (id: string) =>
    st.hover === id || st.editing === id || (st.sel.length === 1 && st.sel[0] === id);

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
    } else s.setState('view', { x: v.x - e.deltaX, y: v.y - e.deltaY, z: v.z });
    setCloseEpoch(closeEpoch() + 1);
  }
  function down(e: PointerEvent): void {
    if (space || e.button === 1) {
      pan = { x: e.clientX, y: e.clientY, vx: st.view.x, vy: st.view.y };
      (e.currentTarget as Element).setPointerCapture(e.pointerId);
    }
  }
  function move(e: PointerEvent): void {
    if (!pan) return;
    s.setState('view', { x: pan.vx + e.clientX - pan.x, y: pan.vy + e.clientY - pan.y, z: st.view.z });
    setCloseEpoch(closeEpoch() + 1);
  }
  function key(e: KeyboardEvent): void {
    if (e.target instanceof HTMLInputElement) return;
    if (e.code === 'Space') space = e.type === 'keydown';
    if (e.type !== 'keydown') return;
    const meta = e.metaKey || e.ctrlKey;
    if (meta && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      if (e.shiftKey) s.redo();
      else s.undo();
    }
  }
  window.addEventListener('keydown', key);
  window.addEventListener('keyup', key);
  onCleanup(() => {
    window.removeEventListener('keydown', key);
    window.removeEventListener('keyup', key);
  });

  return (
    <div
      class="sr-canvas"
      style={{
        'background-size': `${16 * st.view.z}px ${16 * st.view.z}px`,
        'background-position': `${st.view.x}px ${st.view.y}px`,
      }}
      onWheel={wheel}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={() => (pan = null)}
    >
      <div
        class="sr-layer"
        style={{ transform: `translate(${st.view.x}px, ${st.view.y}px) scale(${st.view.z})` }}
      >
        <For each={st.doc.modules}>
          {(m) => {
            const spec = props.specs[m.type]!;
            const node = () => s.nodeOf(m.id);
            return (
              <Panel
                mod={m}
                spec={spec}
                name={nameOf(st.doc, props.specs, m.id)}
                loud={loud(m.id)}
                cabledIn={(p) => cabledIn(m.id, p)}
                cabledOut={(p) => cabledOut(m.id, p)}
                readouts={st.audio && node() !== null ? s.layout().nodes[node()!] : undefined}
                closeEpoch={closeEpoch()}
                act={{
                  knob: (param, k, merge) => s.knob(m.id, param, k, merge),
                  option: (param, v) => s.edit((d) => setParam(d, props.specs, m.id, param, v)),
                  hover: (on) => s.setState('hover', on ? m.id : st.hover === m.id ? null : st.hover),
                  edit: (on) => s.setState('editing', on ? m.id : null),
                }}
              />
            );
          }}
        </For>
        <Cables doc={st.doc} specs={props.specs} />
      </div>
      <Show when={!st.audio}>
        <div class="sr-line">CLICK TO START AUDIO</div>
      </Show>
      <Show when={st.notice}>
        <div class="sr-line notice">{st.notice}</div>
      </Show>
    </div>
  );
}
