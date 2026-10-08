import {
  allPorts,
  connect,
  RATIOS,
  removeCable,
  RuleError,
  withDescendants,
  type Specs,
  type WirePort,
} from '@sreda/core';
import { createEffect, createMemo, For, on, Show, type JSX } from 'solid-js';
import type { PortsState } from '../store';
import { PortList } from './PortList';
import { fmtAtt, fmtRat, ROLE } from '../canvas/glyphs';
import type { SessionApi } from '../store';
import { wireSections, type WireRow } from './rows';

let strokes = 0;

/** WIRES (spec §5a): the patch seen through its wires, in sections; values, ✕, normals, problems. */
export function Wires(props: { session: SessionApi; specs: Specs; focus(id: string): void }): JSX.Element {
  const s = props.session;
  const st = s.state;
  const sections = createMemo(() =>
    wireSections(st.doc, props.specs, {
      q: st.sidebar.q,
      selOnly: st.sidebar.selOnly,
      sel: st.sel,
      missing: st.missing,
    }),
  );

  let box: HTMLDivElement | undefined;
  const selected = createMemo(() => new Set(withDescendants(st.doc, st.sel)));
  // selecting on the canvas scrolls the first of its wires into view
  createEffect(
    on(
      () => st.sel,
      () => queueMicrotask(() => box?.querySelector('.sr-wrow.sel')?.scrollIntoView({ block: 'nearest' })),
      { defer: true },
    ),
  );

  /** replace (a store set would merge into the open list's state, and the list would not re-render) */
  function openPorts(p: PortsState): void {
    s.setState('sidebar', 'ports', null);
    s.setState('sidebar', 'ports', p);
  }
  function closePorts(): void {
    s.setState('sidebar', 'ports', null);
    s.setState('candidate', null);
  }
  /** the port list's choice: move that end of the wire, or build a new wire (an output, then an input) */
  function pick(p: WirePort): void {
    const ps = st.sidebar.ports;
    if (!ps) return;
    const end: [string, string] = [p.id, p.port];
    if (ps.index === 'new' && ps.end === 'from') {
      openPorts({ index: 'new', end: 'to', fixed: end });
      return;
    }
    const fixed = ps.fixed ? ([...ps.fixed] as [string, string]) : null;
    const index = ps.index;
    const which = ps.end;
    closePorts();
    try {
      if (index === 'new') s.edit((d) => connect(d, props.specs, fixed!, end));
      else {
        const cable = st.doc.cables[index];
        if (!cable) return;
        const c = { from: [...cable.from] as [string, string], to: [...cable.to] as [string, string] };
        s.edit((d) => {
          const rest = removeCable(d, c);
          return which === 'to'
            ? connect(rest, props.specs, c.from, end)
            : connect(rest, props.specs, end, c.to);
        });
      }
    } catch (err) {
      if (!(err instanceof RuleError)) throw err;
    }
  }
  /** the port list for the open end: inputs when choosing a destination, outputs for a source */
  function portList(): JSX.Element {
    const ps = st.sidebar.ports!;
    const dir = ps.end === 'to' ? 'in' : 'out';
    const fixed = ps.fixed;
    const otherRole = fixed
      ? allPorts(st.doc, props.specs, dir === 'in' ? 'out' : 'in').find(
          (x) => x.id === fixed[0] && x.port === fixed[1],
        )?.role
      : undefined;
    const title =
      ps.index === 'new'
        ? ps.end === 'from'
          ? 'NEW WIRE: FROM…'
          : 'NEW WIRE: TO…'
        : ps.end === 'to'
          ? 'MOVE TO…'
          : 'MOVE FROM…';
    return (
      <PortList
        ports={allPorts(st.doc, props.specs, dir)}
        otherRole={otherRole ?? null}
        title={title}
        pick={pick}
        candidate={(p) => s.setState('candidate', p ? { id: p.id, port: p.port } : null)}
        close={closePorts}
      />
    );
  }

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
    <div class="sr-wires" ref={(el) => (box = el)}>
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
                        <>
                          <div
                            class="sr-wrow"
                            classList={{
                              on: st.sidebar.picked === w().index,
                              sel: selected().has(w().cable.from[0]) || selected().has(w().cable.to[0]),
                            }}
                            style={{ 'padding-left': 10 + sec.depth * 14 + 'px' }}
                            data-wire={w().index}
                            onMouseEnter={() => s.setState('sidebar', 'hover', w().index)}
                            onMouseLeave={() =>
                              st.sidebar.hover === w().index && s.setState('sidebar', 'hover', null)
                            }
                            onClick={() => s.setState('sidebar', 'picked', w().index)}
                          >
                            <span class="dot" style={{ background: ROLE[w().from] }} />
                            <span class="dot" style={{ background: ROLE[w().to] }} />
                            <span class="text">
                              <span
                                class="port"
                                data-end="from"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  openPorts({ index: w().index, end: 'from', fixed: w().cable.to });
                                }}
                              >
                                {w().fromLabel}
                              </span>
                              {'  →  '}
                              <span
                                class="port"
                                data-end="to"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  openPorts({ index: w().index, end: 'to', fixed: w().cable.from });
                                }}
                              >
                                {w().toLabel}
                              </span>
                            </span>
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
                          <Show when={st.sidebar.ports?.index === w().index && st.sidebar.ports} keyed>
                            {(_ps) => portList()}
                          </Show>
                        </>
                      )}
                    </Show>
                  )}
                </For>
                <Show when={sec.key === 'between'}>
                  <button
                    class="sr-newwire"
                    onClick={() => openPorts({ index: 'new', end: 'from', fixed: null })}
                  >
                    + new wire
                  </button>
                  <Show when={st.sidebar.ports?.index === 'new' && st.sidebar.ports} keyed>
                    {(_ps) => portList()}
                  </Show>
                </Show>
              </Show>
            </div>
          );
        }}
      </For>
    </div>
  );
}
