import { createEffect, createSignal, For, type JSX } from 'solid-js';
import { laneLen, laneSteps, LANES, seqTrace } from '@sreda/core';
import { readoutBuffer, track } from '../../live';

export interface SeqViewProps {
  x: number;
  y: number;
  w: number;
  h: number;
  params: Record<string, number>;
  /** a buffer holding the trace (drawn at once); the live frames read the readout buffer at `traceAt` */
  trace: Float32Array | undefined;
  /** the readout offset of the trace */
  traceAt: number | undefined;
  onOpen(): void;
}

const STRIP = 6;

/** META-SEQ's overview (spec §7b): the playing pattern's NOTE contour, the GATE steps (the current one ringed), thin
 * ACC and VEL strips and the lane lengths. Read-only; a click opens the editor. */
export function SeqView(props: SeqViewProps): JSX.Element {
  const cellW = () => props.w / 16;
  const gateY = () => props.h - 12 - STRIP * 2 - 4 - 14;
  const noteH = () => Math.max(8, gateY() - 8);
  let note: SVGPathElement | undefined;
  let acc: SVGPathElement | undefined;
  let vel: SVGPathElement | undefined;
  const cells: SVGRectElement[] = [];

  const knobPattern = () => Math.max(0, Math.min(7, Math.round((props.params['pat'] ?? 0) * 7)));
  /** the pattern the engine plays now (a signal written only when it changes); the PAT knob until a trace is read */
  const [playing, setPlaying] = createSignal<number | undefined>(undefined);
  const patternOf = () => playing() ?? knobPattern();
  const lens = () => LANES.map((l) => laneLen(props.params, patternOf(), l));

  /** paint steps (lane-major in param units) and the GATE cursor */
  function paint(live: number[][], cursor: number): void {
    const w = cellW();
    const n = live[0]!;
    const g = live[1]!;
    const a = live[3]!;
    const v = live[4]!;
    const gl = lens()[1]!;
    let d = '';
    for (let k = 0; k < 16; k++) {
      const y = (4 + (1 - Math.min(24, Math.max(0, n[k]!)) / 24) * (noteH() - 4)).toFixed(1);
      d += `${k ? 'L' : 'M'}${(k * w).toFixed(1)} ${y} L${((k + 1) * w).toFixed(1)} ${y} `;
    }
    note?.setAttribute('d', d.trim());
    let ad = '';
    let vd = '';
    for (let k = 0; k < 16; k++) {
      if (a[k]! >= 0.5) ad += `M${(k * w + 1).toFixed(1)} 0 h${(w - 2).toFixed(1)} v${STRIP} h${(2 - w).toFixed(1)} Z `;
      const vh = Math.max(1, v[k]! * STRIP);
      vd += `M${(k * w + 1).toFixed(1)} ${(STRIP - vh).toFixed(1)} h${(w - 2).toFixed(1)} v${vh.toFixed(1)} h${(2 - w).toFixed(1)} Z `;
    }
    acc?.setAttribute('d', ad.trim());
    vel?.setAttribute('d', vd.trim());
    cells.forEach((c, k) => {
      c.classList.toggle('on', g[k]! >= 0.5);
      c.classList.toggle('past', k >= gl);
      c.classList.toggle('cur', k === cursor);
    });
  }

  function fromParams(): number[][] {
    const p = patternOf();
    return LANES.map((l) => laneSteps(props.params, p, l));
  }

  // not live (no audio, or the plan is another): the playing pattern as the document holds it
  createEffect(() => {
    const t = props.trace;
    if (t && props.traceAt !== undefined) {
      const s = seqTrace(t, props.traceAt);
      setPlaying(Math.max(0, Math.min(7, Math.round(s.pattern))));
      paint(s.live, Math.round(s.cursors[1]!));
    } else paint(fromParams(), -1);
  });

  const frame = (off: number): void => {
    const buf = readoutBuffer();
    if (!buf) return;
    const s = seqTrace(buf, off);
    const pat = Math.max(0, Math.min(7, Math.round(s.pattern)));
    if (pat !== playing()) setPlaying(pat);
    paint(s.live, Math.round(s.cursors[1]!));
  };

  return (
    <div
      class="sr-disp sr-seq"
      style={{ left: props.x + 'px', top: props.y + 'px', width: props.w + 'px', height: props.h + 'px' }}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={() => props.onOpen()}
    >
      <svg width={props.w} height={props.h} style={{ display: 'block' }}>
        <path class="d-note" ref={(el) => (note = el)} />
        <g transform={`translate(0 ${gateY()})`}>
          <For each={Array.from({ length: 16 }, (_, k) => k)}>
            {(k) => (
              <rect
                class="sr-seq-cell"
                x={k * cellW() + 1}
                y={0}
                width={Math.max(1, cellW() - 2)}
                height={14}
                ref={(el) => (cells[k] = el)}
              />
            )}
          </For>
        </g>
        <g transform={`translate(0 ${gateY() + 18})`}>
          <path class="d-acc" ref={(el) => (acc = el)} />
        </g>
        <g transform={`translate(0 ${gateY() + 18 + STRIP + 2})`}>
          <path class="d-vel" ref={(el) => (vel = el)} />
        </g>
        <text class="sr-seq-lens" x={3} y={props.h - 3}>
          {lens().join(' · ')}
        </text>
        <g ref={(el) => track(el, 'tick', () => props.traceAt, frame)} />
      </svg>
    </div>
  );
}
