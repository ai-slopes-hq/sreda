import { jackAt, type Doc, type Specs } from '@sreda/core';
import { createMemo, For, Show, type JSX } from 'solid-js';
import { cableGeoms } from './cablegeom';
import { bez, ROLE } from './glyphs';

/**
 * Every cable as one SVG layer under the canvas transform: curves, or orthogonal routes inside a WIRE FIX frame. A
 * cable between two roles changes colour along its length (40 % source, a blend, 40 % input). A nested frame whose
 * CLK IN reads its parent's clock shows that normal as a faint dashed line.
 */
export function Cables(props: { doc: Doc; specs: Specs }): JSX.Element {
  const geoms = createMemo(() => cableGeoms(props.doc, props.specs));
  const normals = () =>
    props.doc.groups.flatMap((g) =>
      g.parent &&
      props.doc.groups.some((x) => x.id === g.parent) &&
      !props.doc.cables.some((c) => c.to[0] === g.id && c.to[1] === 'clkIn')
        ? [
            bez(
              jackAt(props.doc, props.specs, g.parent, 'clkOut'),
              jackAt(props.doc, props.specs, g.id, 'clkIn'),
            ),
          ]
        : [],
    );
  return (
    <svg class="sr-cables">
      <For each={normals()}>{(d) => <path class="ghost-normal" d={d} stroke={ROLE.trigger} />}</For>
      <For each={geoms()}>
        {(g, i) => {
          const p = () => g.pts[0]!;
          const q = () => g.pts[g.pts.length - 1]!;
          return (
            <>
              <Show when={g.from !== g.to}>
                <defs>
                  <linearGradient
                    id={`cg${i()}`}
                    gradientUnits="userSpaceOnUse"
                    x1={p().x}
                    y1={p().y}
                    x2={q().x}
                    y2={q().y}
                  >
                    <stop offset="0.4" stop-color={ROLE[g.from]} />
                    <stop offset="0.6" stop-color={ROLE[g.to]} />
                  </linearGradient>
                </defs>
              </Show>
              <path
                class="cable"
                classList={{ routed: !!g.routed }}
                d={g.d}
                stroke={g.from === g.to ? ROLE[g.from] : `url(#cg${i()})`}
              />
            </>
          );
        }}
      </For>
    </svg>
  );
}
