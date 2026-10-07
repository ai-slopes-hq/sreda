// Everything that moves every frame bypasses Solid: one requestAnimationFrame loop reads the readout buffer and
// writes registered elements directly.
import { createEffect, onCleanup } from 'solid-js';

type Kind = 'level' | 'meter' | 'modDot' | 'flash';
interface Entry {
  el: Element;
  kind: Kind;
  offset: number;
  last: number;
  until: number;
}

const entries = new Set<Entry>();
let source: Float32Array | null = null;
let seq = -1;
let running = false;

/** The readout buffer and the seq of the plan whose layout the registered offsets follow. */
export function setSource(buf: Float32Array | null): void {
  source = buf;
}
export function setSeq(n: number): void {
  seq = n;
}

/** level: a bar's width (22 px at full); meter: width in %; modDot: rotation of a knob's dot; flash: a trigger count changed. */
export function register(el: Element, kind: Kind, offset: number): () => void {
  const e: Entry = { el, kind, offset, last: NaN, until: 0 };
  entries.add(e);
  if (!running && typeof requestAnimationFrame === 'function') {
    running = true;
    requestAnimationFrame(tick);
  }
  return () => entries.delete(e);
}

/** Register while `offset()` is defined, re-registering when it changes (a new plan, audio starting). */
export function track(el: Element, kind: Kind, offset: () => number | undefined): void {
  createEffect(() => {
    const off = offset();
    if (off !== undefined) onCleanup(register(el, kind, off));
  });
}

function tick(now: number): void {
  requestAnimationFrame(tick);
  const buf = source;
  if (!buf || buf[0] !== seq) return; // the engine is still on an older plan's layout
  for (const e of entries) {
    const v = buf[e.offset] ?? 0;
    const style = (e.el as HTMLElement).style;
    switch (e.kind) {
      case 'level':
        style.width = Math.round(Math.min(1, v) * 22) + 'px';
        break;
      case 'meter':
        style.width = Math.min(1, v) * 100 + '%';
        break;
      case 'modDot':
        e.el.setAttribute('transform', `rotate(${(-135 + 270 * v).toFixed(1)} 24 17)`);
        break;
      case 'flash':
        if (v !== e.last && !Number.isNaN(e.last)) e.until = now + 80;
        e.el.classList.toggle('flash', now < e.until);
        break;
    }
    e.last = v;
  }
}
