import { layoutPanel, type Doc, type Role, type Specs } from '@sreda/core';
import { For, Show, type JSX } from 'solid-js';
import { bez, ROLE } from './glyphs';

/** Every cable as one SVG layer under the canvas transform; a cable between two roles fades from one colour to the other. */
export function Cables(props: { doc: Doc; specs: Specs }): JSX.Element {
  const ends = () =>
    props.doc.cables.flatMap((c) => {
      const a = props.doc.modules.find((m) => m.id === c.from[0]);
      const b = props.doc.modules.find((m) => m.id === c.to[0]);
      if (!a || !b) return [];
      const sa = props.specs[a.type]!;
      const sb = props.specs[b.type]!;
      const ja = layoutPanel(sa).jacks[c.from[1]];
      const jb = layoutPanel(sb).jacks[c.to[1]];
      if (!ja || !jb) return [];
      const from: Role = sa.outputs.find((p) => p.id === c.from[1])?.role ?? 'audio';
      const to: Role = c.to[1].startsWith('@')
        ? 'mod'
        : (sb.inputs.find((p) => p.id === c.to[1])?.role ?? 'audio');
      return [{ p: { x: a.x + ja.x, y: a.y + ja.y }, q: { x: b.x + jb.x, y: b.y + jb.y }, from, to }];
    });
  return (
    <svg class="sr-cables">
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
