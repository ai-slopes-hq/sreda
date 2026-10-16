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
import { Icon } from '../canvas/icons';
import type { SessionApi } from '../store';
import { SearchField, SideFooter } from './SideField';
import { wireSections, type Row, type Section, type WireRow } from './rows';

let strokes = 0;

/** `OSC 1 › OUT` → the module (muted) and the port */
const splitLabel = (label: string): [string, string] => {
  const i = label.lastIndexOf(' › ');
  return i < 0 ? ['', label] : [label.slice(0, i + 2), label.slice(i + 3)];
};

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
      midi: s.midi.status(),
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
          ? 'New wire: from…'
          : 'New wire: to…'
        : ps.end === 'to'
          ? 'Move to…'
          : 'Move from…';
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

  const isWireSection = (sec: Section) => sec.key !== 'normals' && sec.key !== 'problems';

  const wireRow = (w: () => WireRow, sec: Section): JSX.Element => (
    <>
      <div
        class="sr-wrow"
        classList={{
          on: st.sidebar.picked === w().index,
          dim: !!w().collapsed,
          sel: selected().has(w().cable.from[0]) || selected().has(w().cable.to[0]),
        }}
        style={{ 'padding-left': 12 + sec.depth * 14 + 'px' }}
        data-wire={w().index}
        onMouseEnter={() => s.setState('sidebar', 'hover', w().index)}
        onMouseLeave={() => st.sidebar.hover === w().index && s.setState('sidebar', 'hover', null)}
        onClick={() => s.pickWire(w().index)}
      >
        <For each={['from', 'to'] as const}>
          {(end) => {
            const label = () => splitLabel(end === 'from' ? w().fromLabel : w().toLabel);
            return (
              <>
                <Show when={end === 'to'}>
                  <span class="arr">→</span>
                </Show>
                <span
                  class="port"
                  data-end={end}
                  onClick={(e) => {
                    e.stopPropagation();
                    openPorts({
                      index: w().index,
                      end,
                      fixed: end === 'from' ? w().cable.to : w().cable.from,
                    });
                  }}
                >
                  <span class="dot" style={{ background: ROLE[w()[end]] }} />
                  <span class="m">{label()[0]}</span> {label()[1]}
                </span>
              </>
            );
          }}
        </For>
        <Show when={w().value}>
          {(v) => (
            <span
              class="value"
              classList={{ off: v().v === v().def }}
              onPointerDown={(e) => valueDown(w(), e)}
              onWheel={(e) => valueWheel(w(), e)}
              onDblClick={() => setValue(w(), null, undefined)}
            >
              {v().kind === 'att' ? fmtAtt(v().v) : fmtRat(v().v)}
            </span>
          )}
        </Show>
        <Show when={w().collapsed}>
          <span class="collapsed">(collapsed)</span>
        </Show>
        <button
          class="x"
          aria-label="Remove wire"
          onClick={(e) => {
            e.stopPropagation();
            s.edit((d) => ({ ...d, cables: d.cables.filter((_, i) => i !== w().index) }));
          }}
        >
          <Icon name="close" size={12} />
        </button>
      </div>
      <Show when={st.sidebar.ports?.index === w().index && st.sidebar.ports} keyed>
        {(_ps) => portList()}
      </Show>
    </>
  );

  const plainRow = (row: Exclude<Row, WireRow>): JSX.Element =>
    row.kind === 'normal' ? (
      <div class="sr-nrow">
        <span class="dot" style={{ 'border-color': ROLE[row.role] }} />
        <div>
          {row.text}
          <div class="nd">{row.note}</div>
        </div>
      </div>
    ) : (
      <div
        class="sr-prow"
        classList={{ problem: !row.problem.info }}
        onClick={() => props.focus(row.problem.id)}
      >
        {row.text}
      </div>
    );

  const section = (sec: Section): JSX.Element => {
    const closed = () => !!st.sidebar.closed[sec.key];
    return (
      <div class="sr-wsec" data-section={sec.key}>
        <button
          class="sr-wsec-head"
          style={{ 'padding-left': 8 + sec.depth * 14 + 'px' }}
          onClick={() => s.setState('sidebar', 'closed', sec.key, !closed())}
        >
          <Icon name={closed() ? 'chevron-right' : 'chevron-down'} size={10} />
          <span class="title">{sec.title}</span>
          <span class="count">{sec.count}</span>
        </button>
        <Show when={!closed()}>
          <For each={sec.rows}>
            {(row) => (
              <Show
                when={row.kind === 'wire' && row}
                fallback={plainRow(row as Exclude<Row, WireRow>)}
              >
                {(w) => wireRow(w, sec)}
              </Show>
            )}
          </For>
        </Show>
      </div>
    );
  };

  const wires = () => st.doc.cables.length;
  const modules = () => st.doc.modules.length;
  return (
    <>
      <SearchField
        value={st.sidebar.q}
        set={(v) => s.setState('sidebar', 'q', v)}
        placeholder="Filter by module or port"
        label="Filter wires"
      />
      <div class="sr-chips">
        <button
          class="sr-chip"
          classList={{ on: !st.sidebar.selOnly }}
          aria-pressed={!st.sidebar.selOnly}
          onClick={() => s.setState('sidebar', 'selOnly', false)}
        >
          All <span class="n">{wires()}</span>
        </button>
        <button
          class="sr-chip"
          classList={{ on: st.sidebar.selOnly }}
          aria-pressed={st.sidebar.selOnly}
          onClick={() => s.setState('sidebar', 'selOnly', true)}
        >
          Selection
        </button>
      </div>
      <div class="sr-wires" ref={(el) => (box = el)}>
        <For each={sections().filter(isWireSection)}>{section}</For>
        <button class="sr-newwire" onClick={() => openPorts({ index: 'new', end: 'from', fixed: null })}>
          <Icon name="plus" size={12} />
          New wire
        </button>
        <Show when={st.sidebar.ports?.index === 'new' && st.sidebar.ports} keyed>
          {(_ps) => portList()}
        </Show>
        <For each={sections().filter((x) => !isWireSection(x))}>{section}</For>
        <Show when={!sections().some((x) => x.key === 'problems') && !st.sidebar.q.trim()}>
          <div class="sr-ok">
            <Icon name="check" size={14} />
            No problems
          </div>
        </Show>
      </div>
      <SideFooter>
        <span>
          {wires()} {wires() === 1 ? 'wire' : 'wires'} · {modules()} {modules() === 1 ? 'module' : 'modules'}
        </span>
      </SideFooter>
    </>
  );
}
