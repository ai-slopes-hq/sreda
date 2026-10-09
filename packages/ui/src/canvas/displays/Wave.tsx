import { Show, type JSX } from 'solid-js';
import { track } from '../../live';

const MODES = ['ONE', 'LOOP', 'SLICE'];

export interface WaveShape {
  /** 512 column peaks, or null (no sample, loading, missing) */
  peaks: Float32Array | null;
  /** MODE: 0 ONE, 1 LOOP, 2 SLICE */
  mode: number;
  /** START and LEN as on the knobs (LEN is a share of the rest) */
  start: number;
  len: number;
  slices: number;
  auto?: boolean;
  /** AUTO: the hits that cut, 0…1 of the file */
  hits: number[];
}

/**
 * SAMPLER's wave (spec §7a, prototype `sampleDisplay`): the peaks mirrored about the middle, the outside of the region
 * shaded, START / LEN markers (ONE, LOOP) or slice markers (SLICE: equal parts, or the hits with AUTO).
 */
export function wavePaths(w: number, h: number, o: WaveShape) {
  const mid = h / 2;
  let top = `M0 ${mid}`;
  let bottom = '';
  if (o.peaks) {
    const n = o.peaks.length;
    for (let x = 0; x <= w; x++) {
      const p = o.peaks[Math.min(n - 1, Math.floor((x / w) * n))]! * (mid - 2);
      top += ` L${x} ${(mid - p).toFixed(1)}`;
      bottom = ` L${x} ${(mid + p).toFixed(1)}` + bottom;
    }
  }
  const fill = o.peaks ? `${top}${bottom} Z` : `M0 ${mid} H${w}`;
  const a = Math.min(1, Math.max(0, o.start));
  const b = Math.min(1, a + o.len * (1 - a));
  const X = (v: number) => (v * w).toFixed(1);
  const shade = `M0 0 H${X(a)} V${h} H0 Z M${X(b)} 0 H${w} V${h} H${X(b)} Z`;
  let cuts: number[];
  if (o.mode !== 2) cuts = [a, b];
  else if (o.auto) cuts = o.hits.filter((t) => t > a && t < b);
  else
    cuts = Array.from(
      { length: Math.max(1, Math.round(o.slices)) - 1 },
      (_, k) => a + ((b - a) * (k + 1)) / o.slices,
    );
  const marks = cuts.map((t) => `M${X(t)} 0 V${h}`).join(' ');
  return { fill, shade, marks };
}

export function Wave(
  props: WaveShape & {
    x: number;
    y: number;
    w: number;
    h: number;
    /** the sample's path under samples/ (none: no sample yet) */
    path?: string | undefined;
    missing: boolean;
    rev?: boolean;
    /** the readout offset of the playhead (0…1, −1 silent) */
    state: number | undefined;
    /** a click on the waveform: choose a sample */
    onLoad?: (() => void) | undefined;
  },
): JSX.Element {
  const paths = () => wavePaths(props.w, props.h, props);
  const file = () => props.path?.split('/').pop() ?? '';
  /** AUTO's slices: the hits inside the region, as the engine counts them */
  const autoSlices = () => {
    const a = Math.min(1, Math.max(0, props.start));
    const b = Math.min(1, a + props.len * (1 - a));
    return props.hits.filter((t) => t > a && t < b).length + 1;
  };
  const tag = () => {
    if (!props.path) return 'NO SAMPLE · CLICK TO LOAD';
    if (props.missing) return `MISSING · ${file()}`;
    const mode =
      props.mode === 2
        ? `${props.auto ? autoSlices() : Math.round(props.slices)} SLICES`
        : (MODES[props.mode] ?? 'ONE');
    return [file(), mode, props.mode === 2 && props.auto ? 'AUTO' : '', props.rev ? 'REV' : '']
      .filter(Boolean)
      .join(' · ');
  };
  let head: SVGPathElement | undefined;
  const move = (v: number) => {
    if (!head) return;
    head.setAttribute('d', v < 0 ? '' : `M${(v * props.w).toFixed(1)} 0 V${props.h}`);
  };
  return (
    <div
      class="sr-disp sr-wave-box"
      classList={{ missing: props.missing }}
      style={{ left: props.x + 'px', top: props.y + 'px', width: props.w + 'px', height: props.h + 'px' }}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={() => props.onLoad?.()}
    >
      <svg class="sr-wave" width={props.w} height={props.h} style={{ display: 'block' }}>
        <Show when={props.peaks}>
          <path class="d-fill" d={paths().fill} />
          <path class="d-shade" d={paths().shade} />
          <path class="d-mark" d={paths().marks} />
        </Show>
        <path class="d-ring" ref={(el) => (head = el)} d="" />
        <g ref={(el) => track(el, 'playhead', () => props.state, move)} />
      </svg>
      <div class="sr-dtag left">{tag()}</div>
    </div>
  );
}
