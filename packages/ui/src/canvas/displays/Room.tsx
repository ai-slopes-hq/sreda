import type { JSX } from 'solid-js';
import { track } from '../../live';

export type RoomType = 'ROOM' | 'PLATE' | 'HALL';
export interface RoomShape {
  type: RoomType;
  /** SIZE 0…1 */
  size: number;
  /** the tail's level 0…1: how full the room is */
  fill: number;
  /** DAMP 0…1: the darkened top of the fill */
  damp: number;
  /** PRE 0…1 of its range: the line from the input dot to the wall */
  pre: number;
}

/**
 * REVERB's room (spec §7a, prototype `roomPaths`): a wireframe box for TYPE — ROOM a cube, HALL a wide deep box,
 * PLATE a flat slab — sized by SIZE, filled to the tail's level, the top of the fill darkened by DAMP; PRE is the line
 * from the input dot to the wall.
 */
export function roomPaths(dw: number, dh: number, o: RoomShape) {
  const cx = dw / 2 + 10;
  const cy = dh / 2 + 3;
  const sc = 0.55 + 0.45 * o.size;
  const [w, h, d] =
    o.type === 'PLATE'
      ? [70 * sc, 6, 16 * sc]
      : o.type === 'HALL'
        ? [64 * sc, 30 * sc, 18 * sc]
        : [34 * sc, 34 * sc, 12 * sc];
  const x0 = cx - w / 2 - d / 2;
  const y0 = cy - h / 2 + d / 2;
  const P = (x: number, y: number) => `${x.toFixed(1)} ${y.toFixed(1)}`;
  const edges =
    `M${P(x0, y0)} h${w.toFixed(1)} v${h.toFixed(1)} h${(-w).toFixed(1)} Z ` +
    `M${P(x0 + d, y0 - d)} h${w.toFixed(1)} v${h.toFixed(1)} ` +
    `M${P(x0, y0)} L${P(x0 + d, y0 - d)} M${P(x0 + w, y0)} L${P(x0 + w + d, y0 - d)} M${P(x0 + w, y0 + h)} L${P(x0 + w + d, y0 + h - d)}`;
  const back = `M${P(x0 + d, y0 - d + h)} L${P(x0, y0 + h)} M${P(x0 + d, y0 - d)} V${(y0 - d + h).toFixed(1)} H${(x0 + d + w).toFixed(1)}`;
  const f = Math.max(0, Math.min(1, o.fill));
  const yl = y0 + h * (1 - f);
  const fill = `M${P(x0, yl)} L${P(x0 + d, yl - d)} L${P(x0 + w + d, yl - d)} L${P(x0 + w + d, y0 + h - d)} L${P(x0 + w, y0 + h)} L${P(x0, y0 + h)} Z`;
  const dampH = Math.min(h * f, 3 + 10 * o.damp);
  const damp = `M${P(x0, yl)} L${P(x0 + d, yl - d)} L${P(x0 + w + d, yl - d)} L${P(x0 + w + d, yl - d + dampH)} L${P(x0 + w, yl + dampH)} L${P(x0, yl + dampH)} Z`;
  const preLen = 4 + o.pre * (x0 - 16);
  return {
    edges,
    back,
    fill,
    damp,
    pre: `M8 ${cy.toFixed(1)} H${(8 + preLen).toFixed(1)}`,
    dot: `M5 ${cy.toFixed(1)} a3 3 0 1 0 6 0 a3 3 0 1 0 -6 0`,
    box: { w, h, d },
  };
}

export function Room(props: {
  x: number;
  y: number;
  w: number;
  h: number;
  type: RoomType;
  size: number;
  /** DECAY in seconds (the tag) */
  decay: number;
  damp: number;
  pre: number;
  freeze: boolean;
  /** the readout offset of the tail's level */
  state: number | undefined;
}): JSX.Element {
  const shape = (fill: number) =>
    roomPaths(props.w, props.h, {
      type: props.type,
      size: props.size,
      fill,
      damp: props.damp,
      pre: props.pre,
    });
  let fillEl: SVGPathElement | undefined;
  let dampEl: SVGPathElement | undefined;
  /** the live loop: the room fills with the tail's level (held while frozen) */
  const draw = (level: number) => {
    const p = shape(level);
    fillEl?.setAttribute('d', p.fill);
    dampEl?.setAttribute('d', p.damp);
  };
  const decayText = () =>
    (props.decay < 10 ? props.decay.toFixed(1) : Math.round(props.decay).toString()) + ' s';
  return (
    <div
      class="sr-disp"
      style={{ left: props.x + 'px', top: props.y + 'px', width: props.w + 'px', height: props.h + 'px' }}
    >
      <svg
        class="sr-room"
        classList={{ frozen: props.freeze }}
        width={props.w}
        height={props.h}
        style={{ display: 'block' }}
        ref={(el) => track(el, 'draw', () => props.state, draw)}
      >
        <path class="d-mark" d={shape(0).back} />
        <path class="d-fill" ref={(el) => (fillEl = el)} d={shape(0).fill} />
        <path class="d-shade" ref={(el) => (dampEl = el)} d={shape(0).damp} />
        <path class="d-line" d={shape(0).edges} />
        <path class="d-ring" d={shape(0).pre} />
        <path class="d-dot" d={shape(0).dot} />
      </svg>
      <div class="sr-dtag">
        {props.type} · {decayText()}
      </div>
    </div>
  );
}
