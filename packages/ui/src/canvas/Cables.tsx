import { blockOwner, jackAt, type Cable, type Doc, type Specs } from '@sreda/core';
import { createMemo, For, Show, type JSX } from 'solid-js';
import { bezPts, makeStubs, type CableGeom, type Pt, type StubSet } from './cablegeom';
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
  /** is a ghost cable (a frame's clock normal, parent frame then this one) drawn whole */
  wholeNormal: (parent: string, id: string) => boolean;
  /** the cable a dragged module would go into */
  insert: Cable | null;
}): JSX.Element {
  const same = (a: Cable, b: Cable | null) =>
    !!b && a.from[0] === b.from[0] && a.from[1] === b.from[1] && a.to[0] === b.to[0] && a.to[1] === b.to[1];
  // the two jacks of every ghost normal; equal while no jack moved, so a document change that moves none rebuilds nothing
  const ends = createMemo(
    () =>
      props.doc.groups.flatMap((g) => {
        if (
          !g.parent ||
          blockOwner(props.doc, g.id) ||
          !props.doc.groups.some((x) => x.id === g.parent) ||
          props.doc.cables.some((c) => c.to[0] === g.id && c.to[1] === 'clkIn')
        )
          return [];
        return [
          {
            parent: g.parent,
            id: g.id,
            a: jackAt(props.doc, props.specs, g.parent, 'clkOut'),
            b: jackAt(props.doc, props.specs, g.id, 'clkIn'),
          },
        ];
      }),
    [],
    {
      equals: (p, n) =>
        p.length === n.length &&
        p.every((x, i) => {
          const y = n[i]!;
          return (
            x.parent === y.parent &&
            x.id === y.id &&
            x.a.x === y.a.x &&
            x.a.y === y.a.y &&
            x.b.x === y.b.x &&
            x.b.y === y.b.y
          );
        }),
    },
  );
  const normals = createMemo(() =>
    ends().map((e) => ({ parent: e.parent, id: e.id, d: bez(e.a, e.b), stub: makeStubs(bezPts(e.a, e.b)) })),
  );
  // from the jack (the colour) to the stub's far end (transparent)
  const fade = (id: string, pts: Pt[], color: string) => (
    <linearGradient
      id={id}
      gradientUnits="userSpaceOnUse"
      x1={pts[0]!.x}
      y1={pts[0]!.y}
      x2={pts[pts.length - 1]!.x}
      y2={pts[pts.length - 1]!.y}
    >
      <stop offset="0" stop-color={color} />
      <stop offset="1" stop-color={color} stop-opacity="0" />
    </linearGradient>
  );
  const stubPair = (id: string, s: StubSet, ca: string, cb: string, cls: string) => (
    <>
      <defs>
        {fade(`${id}0`, s.a, ca)}
        {fade(`${id}1`, s.b, cb)}
      </defs>
      <path class={cls} d={s.da} stroke={`url(#${id}0)`} />
      <path class={cls} d={s.db} stroke={`url(#${id}1)`} />
    </>
  );
  return (
    <svg class="sr-cables">
      <For each={normals()}>
        {(n, i) => (
          <>
            {stubPair(`ng${i()}`, n.stub, ROLE.trigger, ROLE.trigger, 'ghost-normal')}
            <Show when={props.wholeNormal(n.parent, n.id)}>
              <path class="ghost-normal" d={n.d} stroke={ROLE.trigger} />
            </Show>
          </>
        )}
      </For>
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
              {stubPair(`sg${i()}`, g.stub, ROLE[g.from], ROLE[g.to], 'stub')}
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
