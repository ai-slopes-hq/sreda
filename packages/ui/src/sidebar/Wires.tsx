import { RATIOS, type Specs } from '@sreda/core';
import { createMemo, For, Show, type JSX } from 'solid-js';
import { fmtAtt, fmtRat, ROLE } from '../canvas/glyphs';
import type { SessionApi } from '../store';
import { wireSections, type WireRow } from './rows';

let strokes = 0;

/** WIRES (spec §5a): the patch seen through its wires, in sections; values, ✕, normals, problems. */
export function Wires(props: { session: SessionApi; specs: Specs; focus(id: string): void }): JSX.Element {
  const s = props.session;
  const st = s.state;
  const sections = createMemo(() =>
    wireSections(st.doc, props.specs, { q: st.sidebar.q, selOnly: st.sidebar.selOnly, sel: st.sel }),
  );

  /** set a row's value: an attenuverter (null resets), or a ratio (a frame's CLK IN too) */
  function setValue(
    row: WireRow,
    v: number | null,
    merge: { key: string; stroke?: boolean } | undefined,
  ): void {
    const [id, port] = row.cable.to;
    if (row.value?.kind === 'att') s.att(id, port, v, merge);
    else if (st.doc.groups.some((g) => g.id === id)) s.frame(id, { ratio: v ?? 1 }, merge);
    else s.ratio(id, port, v ?? 1, merge);
  }
  function step(row: WireRow, v0: number, n: number): number {
    if (row.value!.kind === 'att') return Math.round(Math.min(1, Math.max(-1, v0 + n * 0.01)) * 100) / 100;
    return RATIOS[Math.min(RATIOS.length - 1, Math.max(0, RATIOS.indexOf(v0) + n))]!;
  }
  function valueDown(row: WireRow, e: PointerEvent): void {
    if (e.button !== 0 || !row.value) return;
    e.stopPropagation();
    const y0 = e.clientY;
    const v0 = row.value.v;
    const key = `wires:${row.index}:${++strokes}`;
    const move = (ev: PointerEvent) => {
      const dy = y0 - ev.clientY;
      setValue(row, step(row, v0, row.value!.kind === 'att' ? dy : Math.round(dy / 8)), {
        key,
        stroke: true,
      });
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }
  function valueWheel(row: WireRow, e: WheelEvent): void {
    if (!row.value) return;
    e.preventDefault();
    e.stopPropagation();
    setValue(row, step(row, row.value.v, e.deltaY < 0 ? 1 : -1), { key: `wires-wheel:${row.index}` });
  }

  return (
    <div class="sr-wires">
      <For each={sections()}>
        {(sec) => {
          const closed = () => !!st.sidebar.closed[sec.key];
          return (
            <div class="sr-wsec" data-section={sec.key}>
              <button
                class="sr-wsec-head"
                style={{ 'padding-left': 10 + sec.depth * 14 + 'px' }}
                onClick={() => s.setState('sidebar', 'closed', sec.key, !closed())}
              >
                <span class="caret">{closed() ? '▸' : '▾'}</span>
                <span class="title">{sec.title}</span>
                <span class="count">{sec.count}</span>
              </button>
              <Show when={!closed()}>
                <For each={sec.rows}>
                  {(row) => (
                    <Show
                      when={row.kind === 'wire' && row}
                      fallback={
                        <div
                          class="sr-wrow dim"
                          classList={{
                            problem: row.kind === 'problem' && !row.problem.info,
                            clickable: row.kind === 'problem',
                          }}
                          style={{ 'padding-left': 24 + sec.depth * 14 + 'px' }}
                          onClick={() => row.kind === 'problem' && props.focus(row.problem.id)}
                        >
                          <Show when={row.kind === 'normal' && row}>
                            {(n) => <span class="dot" style={{ background: ROLE[n().role] }} />}
                          </Show>
                          <span class="text">{row.text}</span>
                        </div>
                      }
                    >
                      {(w) => (
                        <div
                          class="sr-wrow"
                          style={{ 'padding-left': 10 + sec.depth * 14 + 'px' }}
                          data-wire={w().index}
                        >
                          <span class="dot" style={{ background: ROLE[w().from] }} />
                          <span class="dot" style={{ background: ROLE[w().to] }} />
                          <span class="text">{w().text}</span>
                          <span
                            class="value"
                            classList={{ off: !w().value || w().value!.v === w().value!.def }}
                            onPointerDown={(e) => valueDown(w(), e)}
                            onWheel={(e) => valueWheel(w(), e)}
                            onDblClick={() => w().value && setValue(w(), null, undefined)}
                          >
                            {w().value
                              ? w().value!.kind === 'att'
                                ? fmtAtt(w().value!.v)
                                : fmtRat(w().value!.v)
                              : ''}
                          </span>
                          <button
                            class="x"
                            aria-label="Remove wire"
                            onClick={() =>
                              s.edit((d) => ({ ...d, cables: d.cables.filter((_, i) => i !== w().index) }))
                            }
                          >
                            ✕
                          </button>
                        </div>
                      )}
                    </Show>
                  )}
                </For>
              </Show>
            </div>
          );
        }}
      </For>
    </div>
  );
}
