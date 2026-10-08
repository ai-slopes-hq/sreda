import { jackAt, type Doc, type Role, type Specs } from '@sreda/core';
import { For, Show, type JSX } from 'solid-js';
import { bez, ROLE } from './glyphs';

/** The role of one end of a cable; a frame's CLK jacks are triggers. */
function roleAt(doc: Doc, specs: Specs, id: string, port: string, dir: 'in' | 'out'): Role | null {
  if (doc.groups.some((g) => g.id === id)) return 'trigger';
  const m = doc.modules.find((x) => x.id === id);
  const spec = m && specs[m.type];
  if (!spec) return null;
  if (dir === 'out') return spec.outputs.find((p) => p.id === port)?.role ?? null;
  return port.startsWith('@') ? 'mod' : (spec.inputs.find((p) => p.id === port)?.role ?? null);
}

/**
 * Every cable as one SVG layer under the canvas transform; a cable between two roles fades from one colour to the
 * other. A nested frame whose CLK IN reads its parent's clock shows that normal as a faint dashed line.
 */
export function Cables(props: { doc: Doc; specs: Specs }): JSX.Element {
  const ends = () =>
    props.doc.cables.flatMap((c) => {
      const from = roleAt(props.doc, props.specs, c.from[0], c.from[1], 'out');
      const to = roleAt(props.doc, props.specs, c.to[0], c.to[1], 'in');
      if (!from || !to) return [];
      return [
        {
          p: jackAt(props.doc, props.specs, c.from[0], c.from[1]),
          q: jackAt(props.doc, props.specs, c.to[0], c.to[1]),
          from,
          to,
        },
      ];
    });
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
      <For each={ends()}>
        {(e, i) => (
          <>
            <Show when={e.from !== e.to}>
              <defs>
                <linearGradient
                  id={`cg${i()}`}
                  gradientUnits="userSpaceOnUse"
                  x1={e.p.x}
                  y1={e.p.y}
                  x2={e.q.x}
                  y2={e.q.y}
                >
                  <stop offset="0" stop-color={ROLE[e.from]} />
                  <stop offset="1" stop-color={ROLE[e.to]} />
                </linearGradient>
              </defs>
            </Show>
            <path
              class="cable"
              d={bez(e.p, e.q)}
              stroke={e.from === e.to ? ROLE[e.from] : `url(#cg${i()})`}
            />
          </>
        )}
      </For>
    </svg>
  );
}
