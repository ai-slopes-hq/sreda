import type { JSX } from 'solid-js';
import { track } from '../../live';

/** SCOPE's display: A light, B mod-blue, each a min…max band and a centre line, on a quarter grid. */
export function Scope(props: {
  x: number;
  y: number;
  w: number;
  h: number;
  mode: number;
  trace: number | undefined;
}): JSX.Element {
  const grid = () => {
    let d = `M0 ${props.h / 2} H${props.w}`;
    for (let i = 1; i < 4; i++) d += ` M${((props.w * i) / 4).toFixed(1)} 0 V${props.h}`;
    return d;
  };
  return (
    <div
      class="sr-disp"
      style={{ left: props.x + 'px', top: props.y + 'px', width: props.w + 'px', height: props.h + 'px' }}
    >
      <svg
        class="sr-scope"
        width={props.w}
        height={props.h}
        data-mode={props.mode}
        ref={(el) => track(el, 'trace', () => props.trace)}
        style={{ display: 'block' }}
      >
        <path class="d-grid" d={grid()} />
        <path class="band-a" />
        <path class="band-b" />
        <path class="line-a" />
        <path class="line-b" />
      </svg>
    </div>
  );
}
