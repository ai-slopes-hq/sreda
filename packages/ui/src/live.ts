// Everything that moves every frame bypasses Solid: one requestAnimationFrame loop reads the readout buffer and
// writes registered elements directly.
import { createEffect, onCleanup } from 'solid-js';
import { tracePaths } from './canvas/displays/trace';

type Kind =
  'level' | 'meter' | 'meterDb' | 'modDot' | 'flash' | 'trace' | 'step' | 'watch' | 'draw' | 'playhead' | 'tick';
interface Entry {
  el: Element;
  kind: Kind;
  offset: number;
  last: number;
  until: number;
  /** a level bar's held peak */
  hold: number;
  /** 'watch': called when the readout rises (a trigger count going up); 'draw': called every frame with the value
   * (held, falling over 0.6 s) */
  onChange: ((v: number) => void) | undefined;
  /** the plan whose layout `offset` belongs to: values are read only while the engine plays that plan */
  seq: number;
}

const entries = new Set<Entry>();
let source: Float32Array | null = null;
let layoutSeq = -1;
let running = false;

/** The readout buffer, for displays that draw from it directly ('tick'). */
export function readoutBuffer(): Float32Array | null {
  return source;
}

/** The readout buffer the worklet fills. */
export function setSource(buf: Float32Array | null): void {
  source = buf;
}
/** The plan whose layout the next registrations follow (set before the panels re-register). */
export function setLayoutSeq(n: number): void {
  layoutSeq = n;
}

/** level: a bar's width (22 px at full); meter: width in %; meterDb: width in % of a −48 … 0 dB scale; modDot: rotation of a knob's dot; flash: a trigger count changed. */
export function register(
  el: Element,
  kind: Kind,
  offset: number,
  onChange?: (v: number) => void,
): () => void {
  const e: Entry = { el, kind, offset, last: NaN, until: 0, hold: 0, onChange, seq: layoutSeq };
  entries.add(e);
  if (!running && typeof requestAnimationFrame === 'function') {
    running = true;
    requestAnimationFrame(tick);
  }
  return () => entries.delete(e);
}

/** Register while `offset()` is defined, re-registering when it changes (a new plan, audio starting). */
export function track(
  el: Element,
  kind: Kind,
  offset: () => number | undefined,
  onChange?: (v: number) => void,
): void {
  createEffect(() => {
    const off = offset();
    if (off !== undefined) onCleanup(register(el, kind, off, onChange));
  });
}

let lastTick = 0;

function tick(now: number): void {
  requestAnimationFrame(tick);
  frame(now);
}

/** One frame of readouts (exported for tests). */
export function frame(now: number): void {
  const dt = lastTick ? Math.min(0.1, (now - lastTick) / 1000) : 0;
  lastTick = now;
  const buf = source;
  if (!buf) return;
  for (const e of entries) {
    if (buf[0] !== e.seq) continue; // the engine is on another plan: this offset means something else there
    const v = buf[e.offset] ?? 0;
    const style = (e.el as HTMLElement).style;
    switch (e.kind) {
      case 'level':
        // hold the peak, fall at full scale per 0.3 s
        e.hold = Math.max(Math.min(1, v), e.hold - dt / 0.3);
        style.width = Math.round(e.hold * 22) + 'px';
        break;
      case 'meter':
        // hold the peak, fall at full scale per 0.3 s
        e.hold = Math.max(Math.min(1, v), e.hold - dt / 0.3);
        style.width = e.hold * 100 + '%';
        break;
      case 'meterDb': {
        // the same 300 ms hold; the bar is the peak in dB over 48 dB (−48 … 0), nothing for 0 or a non-finite reading
        const peak = v > 0 && v < Infinity ? Math.min(1, v) : 0;
        e.hold = Math.max(peak, e.hold - dt / 0.3);
        const bar = e.hold > 0 ? (20 * Math.log10(e.hold) + 48) / 48 : 0;
        style.width = Math.min(1, Math.max(0, bar)) * 100 + '%';
        break;
      }
      case 'modDot':
        e.el.setAttribute('transform', `rotate(${(-135 + 270 * v).toFixed(1)} 24 17)`);
        break;
      case 'flash':
        if (v !== e.last && !Number.isNaN(e.last)) e.until = now + 120;
        e.el.classList.toggle('flash', now < e.until);
        break;
      case 'trace': {
        const svg = e.el as SVGSVGElement;
        const p = tracePaths(
          buf,
          e.offset,
          +svg.getAttribute('width')!,
          +svg.getAttribute('height')!,
          svg.getAttribute('data-mode') === '1',
        );
        svg.querySelector('.band-a')?.setAttribute('d', p.bandA);
        svg.querySelector('.band-b')?.setAttribute('d', p.bandB);
        svg.querySelector('.line-a')?.setAttribute('d', p.lineA);
        svg.querySelector('.line-b')?.setAttribute('d', p.lineB);
        break;
      }
      case 'step':
        e.el.setAttribute('data-cur', String(Math.round(v)));
        break;
      case 'draw':
        // hold the peak, fall at full scale per 0.6 s
        e.hold = Math.max(Math.min(1, v), e.hold - dt / 0.6);
        e.onChange?.(e.hold);
        break;
      case 'tick':
        // every frame: the callback reads what it needs from the buffer at its offset
        e.onChange?.(e.offset);
        break;
      case 'playhead':
        // a position 0…1 (−1: nothing playing), handed on when it moves
        if (v !== e.last) e.onChange?.(v);
        break;
      case 'watch':
        // a rise of the count is an event; the first reading is a baseline and a reset to 0 is not one
        if (!Number.isNaN(e.last) && v > e.last) e.onChange?.(v);
        break;
    }
    e.last = v;
  }
}
