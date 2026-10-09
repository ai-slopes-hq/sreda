import { jackAt, type Cable, type Doc, type Specs } from '@sreda/core';
import { For, Show, type JSX } from 'solid-js';
import { stubPts, stubs, type CableGeom } from './cablegeom';
import { bez, ROLE } from './glyphs';

/**
 * Every cable as one SVG layer under the canvas transform: curves, drawn behind (spec §4). A cable always shows its two
 * stubs, the first and last 14 px fading out from the jack; the whole path only when `whole(c)`. A cable between two
 * roles changes colour along its length (40 % source, a blend, 40 % input). A nested frame whose CLK IN reads its
 * parent's clock shows that normal as a faint dashed line.
 */
export function Cables(props: {
  doc: Doc;
  specs: Specs;
  geoms: CableGeom[];
  /** the wire lit and thicker: the one under the pointer, or a WIRES row */
  hover: Cable | null;
  /** is the whole cable drawn (otherwise only its stubs) */
  whole: (c: Cable) => boolean;
  /** the cable a dragged module would go into */
  insert: Cable | null;
}): JSX.Element {
  const same = (a: Cable, b: Cable | null) =>
    !!b && a.from[0] === b.from[0] && a.from[1] === b.from[1] && a.to[0] === b.to[0] && a.to[1] === b.to[1];
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
      <For each={props.geoms}>
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
              <defs>
                <For each={[0, 1]}>
                  {(end) => {
                    // from the jack (the cable's colour) to the stub's far end (transparent)
                    const pts = () => (end ? stubPts(g).b : stubPts(g).a);
                    const e = () => pts()[pts().length - 1]!;
                    const color = () => ROLE[end ? g.to : g.from];
                    return (
                      <linearGradient
                        id={`sg${i()}${end}`}
                        gradientUnits="userSpaceOnUse"
                        x1={pts()[0]!.x}
                        y1={pts()[0]!.y}
                        x2={e().x}
                        y2={e().y}
                      >
                        <stop offset="0" stop-color={color()} />
                        <stop offset="1" stop-color={color()} stop-opacity="0" />
                      </linearGradient>
                    );
                  }}
                </For>
              </defs>
              <path class="stub" d={stubs(g).a} stroke={`url(#sg${i()}0)`} />
              <path class="stub" d={stubs(g).b} stroke={`url(#sg${i()}1)`} />
              <Show when={props.whole(g.cable) || same(g.cable, props.insert)}>
                <path
                  class="cable"
                  classList={{
                    lit: same(g.cable, props.hover),
                    insert: same(g.cable, props.insert),
                  }}
                  d={g.d}
                  stroke={g.from === g.to ? ROLE[g.from] : `url(#cg${i()})`}
                />
              </Show>
            </>
          );
        }}
      </For>
    </svg>
  );
}
