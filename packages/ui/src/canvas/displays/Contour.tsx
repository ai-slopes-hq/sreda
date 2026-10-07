import { fromKnob, SCALES, toKnob, type KnobParam, type Merge, type ModuleSpec } from '@sreda/core';
import { createMemo, For, type JSX } from 'solid-js';
import { track } from '../../live';

const NOTES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
/** the note a voltage plays: 0 V = C of octave 3 (semitones 0…24 over −1…+1) */
export function noteName(v: number): string {
  const st = Math.round(v * 12 + 12);
  return NOTES[((st % 12) + 12) % 12]! + (2 + Math.floor(st / 12));
}

let strokes = 0;

export interface ContourProps {
  x: number;
  y: number;
  w: number;
  h: number;
  spec: ModuleSpec;
  params: Record<string, number>;
  /** ADV patched: every stage the same width; else widths follow stage times */
  advPatched: boolean;
  /** the readout offset of the current stage */
  state: number | undefined;
  edit(changes: Record<string, number>, merge?: Merge): void;
}

/** STAGES' contour (spec §7): the LEN stages as one line; draw notes, toggle slides and pulses, move stage times. */
export function Contour(props: ContourProps): JSX.Element {
  const knob = (id: string) => props.spec.params.find((p) => p.id === id) as KnobParam;
  const value = (id: string) => fromKnob(knob(id), props.params[id] ?? 0);
  const len = () => Math.max(1, Math.min(16, Math.round(value('length'))));
  const geom = createMemo(() => {
    const n = len();
    const times = Array.from({ length: n }, (_, i) => (props.advPatched ? 1 : value('t' + (i + 1))));
    const tot = times.reduce((a, b) => a + b, 0);
    const ws = times.map((t) => (t / tot) * props.w);
    const xs: number[] = [];
    ws.reduce((x, w) => (xs.push(x), x + w), 0);
    return { n, xs, ws, tot };
  });
  const amp = () => props.h / 2 - 22;
  const mid = () => props.h / 2 - 4;
  const y = (v: number) => mid() - v * amp();
  const vAt = (py: number) => Math.max(-1, Math.min(1, (mid() - py) / amp()));
  const stageAt = (px: number) => {
    const g = geom();
    let s = 0;
    for (let i = 0; i < g.n; i++) if (px >= g.xs[i]!) s = i;
    return s;
  };
  /** a voltage snapped to the nearest degree of SCALE from ROOT (ties down) */
  const snap = (v: number) => {
    const scale = SCALES[props.params['scale'] ?? 2]!;
    const root = Math.round(value('root'));
    const st = v * 12 + 12;
    let best = 0;
    let dist = Infinity;
    for (let s = 0; s <= 24; s++)
      if (scale.includes((((s - root) % 12) + 12) % 12) && Math.abs(s - st) < dist - 1e-9) {
        dist = Math.abs(s - st);
        best = s;
      }
    return (best - 12) / 12;
  };
  const line = () => {
    const g = geom();
    let d = '';
    for (let i = 0; i < g.n; i++) {
      const yy = y(value('v' + (i + 1))).toFixed(1);
      const x = g.xs[i]!;
      const slide = (props.params['g' + (i + 1)] ?? 0) === 1 && i > 0;
      d += `${i ? 'L' : 'M'}${(slide ? x + Math.min(14, g.ws[i]! / 2) : x).toFixed(1)} ${yy} L${(x + g.ws[i]!).toFixed(1)} ${yy} `;
    }
    return d;
  };

  function down(e: PointerEvent): void {
    if (e.button !== 0) return;
    e.stopPropagation();
    const r = (e.currentTarget as Element).getBoundingClientRect();
    // the canvas is scaled (zoom): screen pixels back to the display's own
    const sx = r.width > 0 ? props.w / r.width : 1;
    const sy = r.height > 0 ? props.h / r.height : 1;
    const at = (ev: PointerEvent) => ({ x: (ev.clientX - r.left) * sx, y: (ev.clientY - r.top) * sy });
    const p0 = at(e);
    const g = geom();
    const key = `contour:${++strokes}`;
    let moved = false;
    let mode: 'dot' | 'joint' | 'draw' = 'draw';
    let joint = -1;
    if (p0.y > props.h - 20) mode = 'dot';
    else
      for (let q = 1; q < g.n; q++)
        if (Math.abs(p0.x - g.xs[q]!) < 5) {
          mode = 'joint';
          joint = q;
        }
    const draw = (p: { x: number; y: number }) => {
      const s = stageAt(p.x);
      props.edit({ ['v' + (s + 1)]: toKnob(knob('v1'), snap(vAt(p.y))) }, { key, stroke: true });
    };
    if (mode === 'draw') draw(p0);
    const move = (ev: PointerEvent) => {
      const p = at(ev);
      if (Math.abs(p.x - p0.x) > 3 || Math.abs(p.y - p0.y) > 3) moved = true;
      if (mode === 'draw') draw(p);
      else if (mode === 'joint' && moved && !props.advPatched) {
        // move the boundary: the two stages around it share their total time
        const a = joint - 1;
        const sum = value('t' + (a + 1)) + value('t' + (joint + 1));
        const left = Math.max(0.01, Math.min(sum - 0.01, ((p.x - g.xs[a]!) / props.w) * g.tot));
        props.edit(
          { ['t' + (a + 1)]: toKnob(knob('t1'), left), ['t' + (joint + 1)]: toKnob(knob('t1'), sum - left) },
          { key, stroke: true },
        );
      }
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      if (moved) return;
      if (mode === 'dot') {
        const s = stageAt(p0.x) + 1;
        props.edit({ ['p' + s]: 1 - (props.params['p' + s] ?? 0) }, undefined);
      } else if (mode === 'joint') {
        props.edit({ ['g' + (joint + 1)]: 1 - (props.params['g' + (joint + 1)] ?? 0) }, undefined);
      }
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  return (
    <div
      class="sr-disp sr-contour"
      style={{ left: props.x + 'px', top: props.y + 'px', width: props.w + 'px', height: props.h + 'px' }}
      ref={(el) => track(el, 'step', () => props.state)}
      onPointerDown={down}
    >
      <For each={Array.from({ length: geom().n }, (_, i) => i)}>
        {(i) => {
          const x = () => geom().xs[i] ?? 0;
          const w = () => geom().ws[i] ?? 0;
          const v = () => value('v' + (i + 1));
          const rest = () => (props.params['p' + (i + 1)] ?? 0) === 1;
          return (
            <>
              <div
                class="sr-cstep"
                data-step={i}
                style={{ left: x() + 'px', width: w() + 'px', height: props.h + 'px' }}
              />
              <div
                class="sr-crest"
                classList={{ on: rest() }}
                style={{ left: x() + 'px', width: w() + 'px', height: props.h - 16 + 'px' }}
              />
              <div
                class="sr-cnote"
                data-step={i}
                style={{
                  left: x() + 'px',
                  width: w() + 'px',
                  top: y(v()) - 15 + 'px',
                  display: w() < 22 ? 'none' : undefined,
                }}
              >
                {noteName(v())}
              </div>
              <div
                class="sr-cdot"
                classList={{ on: !rest() }}
                data-step={i}
                style={{ left: x() + w() / 2 - 3.5 + 'px', top: props.h - 12 + 'px' }}
              />
            </>
          );
        }}
      </For>
      <svg
        width={props.w}
        height={props.h}
        style={{ position: 'absolute', left: '0', top: '0', 'pointer-events': 'none' }}
      >
        <path class="c-fill" d={line() + `L${props.w} ${props.h} L0 ${props.h} Z`} />
        <path class="c-line" d={line()} />
      </svg>
    </div>
  );
}
