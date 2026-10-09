import type { JSX } from 'solid-js';
import { readoutBuffer, track } from '../../live';
import { cursorHandlers, type Cursor } from './gesture';
import { wavePaths } from './Wave';

const GRAINS = 64;
const PEAKS = 512;

/**
 * GRAINS' display (spec §7a, prototype `sampleDisplay` 'grains'): an amber dot per playing grain, POS as a line, and
 * while LIVE the region being written (just behind the head) shaded.
 */
export function grainsPaths(
  w: number,
  h: number,
  o: { grains: ArrayLike<number>; head: number; live: boolean; frozen?: boolean; pos: number },
) {
  let dots = '';
  let k = 0;
  for (let i = 0; i < o.grains.length; i++) {
    const g = o.grains[i]!;
    if (g < 0) continue;
    // spread vertically by slot so overlapping grains stay visible
    const y = 10 + ((k++ * 37) % Math.max(1, h - 20));
    dots += `M${(g * w - 2.5).toFixed(1)} ${y} a2.5 2.5 0 1 0 5 0 a2.5 2.5 0 1 0 -5 0 `;
  }
  const X = (v: number) => (v * w).toFixed(1);
  // the region being written: just behind the head, wrapping round the ring; none while frozen
  const rect = (a: number, b: number) => `M${X(a)} 0 H${X(b)} V${h} H${X(a)} Z`;
  const from = o.head - 0.07;
  const shade =
    !o.live || o.frozen || o.head < 0
      ? ''
      : from >= 0
        ? rect(from, o.head)
        : `${rect(0, o.head)} ${rect(1 + from, 1)}`;
  // LIVE reads relative to the head: POS 1 is the newest audio, POS 0 eight seconds before it
  const p = Math.min(1, Math.max(0, o.pos));
  const at = o.live && o.head >= 0 ? (((o.head - (1 - p)) % 1) + 1) % 1 : p;
  return { dots: dots.trim(), ring: `M${X(at)} 0 V${h}`, shade };
}

export function Grains(props: {
  x: number;
  y: number;
  w: number;
  h: number;
  /** POS as on the knob */
  pos: number;
  live: boolean;
  frozen: boolean;
  path?: string | undefined;
  missing: boolean;
  /** FILE: the sample's peaks */
  peaks: Float32Array | null;
  /** the readout offset of the trace (head, grains, live peaks) */
  trace: number | undefined;
  /** a click while FILE has no sample (or it is missing): choose one */
  onLoad?: (() => void) | undefined;
  /** POS from a click or a drag, as the knob's position 0…1 (LIVE: relative to the head, as the display draws it) */
  onPos?: ((pos: number, phase: Cursor['phase']) => void) | undefined;
}): JSX.Element {
  const file = () => props.path?.split('/').pop() ?? '';
  const tag = () => {
    if (props.live) return `LIVE · 8 s BUFFER${props.frozen ? ' · FROZEN' : ''}`;
    if (!props.path) return 'NO SAMPLE · CLICK TO LOAD';
    return props.missing ? `MISSING · ${file()}` : file();
  };
  const fileWave = () =>
    props.peaks
      ? wavePaths(props.w, props.h, { peaks: props.peaks, mode: 0, start: 0, len: 1, slices: 1, hits: [] })
          .fill
      : '';
  /** the write head last drawn (LIVE), −1 unknown */
  let head = -1;
  const playable = () => props.live || (!!props.peaks && !!props.path && !props.missing);
  const handlers = cursorHandlers({
    drag: playable,
    on: (c) => {
      if (!playable()) {
        if (c.phase === 'click') props.onLoad?.();
        return;
      }
      // LIVE draws POS 1 at the head and POS 0 eight seconds before it: the inverse of `grainsPaths`
      const pos = props.live && head >= 0 ? 1 - (((head - c.t) % 1) + 1) % 1 : c.t;
      props.onPos?.(pos, c.phase);
    },
  });
  let wave: SVGPathElement | undefined;
  let dots: SVGPathElement | undefined;
  let shade: SVGPathElement | undefined;
  let ring: SVGPathElement | undefined;
  const live = new Float32Array(PEAKS);
  /** every frame: the grains, the head and (LIVE) the buffer's peaks from the trace */
  const draw = (off: number) => {
    const buf = readoutBuffer();
    if (!buf) return;
    head = buf[off] ?? -1;
    const p = grainsPaths(props.w, props.h, {
      grains: buf.subarray(off + 1, off + 1 + GRAINS),
      head: buf[off] ?? -1,
      live: props.live,
      frozen: props.frozen,
      pos: props.pos,
    });
    dots?.setAttribute('d', p.dots);
    shade?.setAttribute('d', p.shade);
    ring?.setAttribute('d', p.ring);
    if (props.live) {
      live.set(buf.subarray(off + 1 + GRAINS, off + 1 + GRAINS + PEAKS));
      wave?.setAttribute(
        'd',
        wavePaths(props.w, props.h, { peaks: live, mode: 0, start: 0, len: 1, slices: 1, hits: [] }).fill,
      );
    }
  };
  const still = () =>
    grainsPaths(props.w, props.h, { grains: [], head: -1, live: props.live, pos: props.pos });
  return (
    <div
      class="sr-disp sr-wave-box"
      classList={{ missing: props.missing && !props.live }}
      style={{ left: props.x + 'px', top: props.y + 'px', width: props.w + 'px', height: props.h + 'px' }}
      {...handlers}
    >
      <svg class="sr-wave sr-grains" width={props.w} height={props.h} style={{ display: 'block' }}>
        <path class="d-fill" ref={(el) => (wave = el)} d={props.live ? '' : fileWave()} />
        <path class="d-shade" ref={(el) => (shade = el)} d={still().shade} />
        <path class="d-ring" ref={(el) => (ring = el)} d={still().ring} />
        <path class="d-acc" ref={(el) => (dots = el)} d="" />
        <g ref={(el) => track(el, 'tick', () => props.trace, draw)} />
      </svg>
      <div class="sr-dtag left" classList={{ amber: props.live }}>
        {tag()}
      </div>
    </div>
  );
}
