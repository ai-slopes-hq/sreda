import {
  fromKnob,
  layoutPanel,
  type KnobParam,
  type Merge,
  type ModuleDoc,
  type ModuleSpec,
  type NodeReadouts,
  type OptionParam,
  type Role,
} from '@sreda/core';
import { createMemo, For, Show, type JSX } from 'solid-js';
import { track } from '../live';
import { fmtAtt, fmtRat, ROLE } from './glyphs';
import { Jack } from './Jack';
import { Knob } from './Knob';
import { Option } from './Option';
import { Contour } from './displays/Contour';
import { Pads } from './displays/Pads';
import { Scope } from './displays/Scope';

export type FieldKind = 'att' | 'ratio';

export interface PanelActions {
  knob(param: string, knob: number, merge: Merge): void;
  option(param: string, value: number, merge?: Merge): void;
  hover(on: boolean): void;
  edit(on: boolean): void;
  /** the attenuverter of a knob's mod jack (Alt-drag on the knob) */
  depth?(param: string, value: number, merge: Merge): void;
  jackDown?(port: string, dir: 'in' | 'out', role: Role, e: PointerEvent): void;
  fieldDown?(port: string, kind: FieldKind, e: PointerEvent): void;
  fieldReset?(port: string, kind: FieldKind): void;
  moduleDown?(e: PointerEvent): void;
  /** double-click on the name: the picker as REPLACE <MODULE> */
  replace?(e: MouseEvent): void;
  /** an action button (DICE) */
  action?(param: string): void;
  /** a display edit: several params in one undo step */
  editParams?(changes: Record<string, number>, merge?: Merge): void;
  /** the module's DICE input fired (the patch changes, no undo step) */
  diceInput?(): void;
}

export interface PanelProps {
  mod: ModuleDoc;
  spec: ModuleSpec;
  name: string;
  /** hovered, selected alone or being edited: values show */
  loud: boolean;
  selected?: boolean;
  cabledIn(port: string): boolean;
  cabledOut(port: string): boolean;
  /** the output being listened to */
  listening?: string | null;
  act: PanelActions;
  /** where this module's readouts are, once audio runs */
  readouts?: NodeReadouts | undefined;
  /** bumps on pan / zoom (open lists close) */
  closeEpoch?: number;
  /** inside a muted frame: drawn at 40 % */
  dim?: boolean;
  /** at one end of the hovered wire: outlined in amber */
  end?: boolean;
  /** a WIRES port list points at this port: an amber ring */
  candidate?: string | null;
}

/** A module drawn by the panel grammar from its spec: jacks in the side columns, knobs, the mode strip. */
export function Panel(props: PanelProps): JSX.Element {
  const L = createMemo(() => layoutPanel(props.spec));
  const knobs = () => props.spec.params.filter((p): p is KnobParam => p.kind === 'knob' && !p.hidden);
  const options = () => props.spec.params.filter((p): p is OptionParam => p.kind === 'option' && !p.hidden);
  const actions = () => props.spec.params.filter((p) => p.kind === 'action');
  const knobValue = (id: string) => {
    const p = props.spec.params.find((x) => x.id === id);
    return p?.kind === 'knob' ? fromKnob(p, props.mod.params[id] ?? 0) : 0;
  };
  /** the normal an unpatched input reads now (an own normal only while its option condition holds) */
  const activeNormal = (port: string) =>
    props.cabledIn(port)
      ? undefined
      : props.spec.normals.find(
          (n) =>
            n.input === port &&
            (n.kind !== 'own' || !n.when || props.mod.params[n.when.param] === n.when.value),
        );
  const normalled = (port: string) => activeNormal(port) !== undefined;
  const normalTitle = (port: string, label: string): string | undefined => {
    const n = activeNormal(port);
    if (!n) return undefined;
    const source =
      n.kind === 'own'
        ? (props.spec.outputs.find((o) => o.id === n.own)?.label ?? n.own)
        : n.kind === 'internal'
          ? n.internal.toUpperCase()
          : (n.value >= 0 ? '+' : '') + n.value;
    return `${label} ← ${source} (normal)`;
  };
  /** own normals drawn as faint dashed loops under the panel, output → input */
  const ghosts = () =>
    props.spec.inputs.flatMap((port) => {
      const n = activeNormal(port.id);
      if (n?.kind !== 'own') return [];
      const o = L().jacks[n.own];
      const i = L().jacks[port.id];
      if (!o || !i) return [];
      const y = L().h + 14;
      return [
        {
          role: port.role,
          d: `M${o.x} ${o.y} C${o.x + 36} ${o.y} ${o.x + 36} ${y} ${o.x} ${y} L${i.x} ${y} C${i.x - 36} ${y} ${i.x - 36} ${i.y} ${i.x} ${i.y}`,
        },
      ];
    });
  const trigIndex = (port: string) =>
    props.spec.inputs.filter((p) => p.role === 'trigger').findIndex((p) => p.id === port);

  return (
    <div
      class="sr-mod"
      classList={{ sel: !!props.selected, muted: !!props.dim, 'wire-end': !!props.end }}
      data-module={props.mod.id}
      data-type={props.mod.type}
      ref={(el) => track(el, 'step', () => props.readouts?.state)}
      style={{ left: props.mod.x + 'px', top: props.mod.y + 'px', width: L().w + 'px', height: L().h + 'px' }}
      onMouseEnter={() => props.act.hover(true)}
      onMouseLeave={() => props.act.hover(false)}
      onPointerDown={(e) => props.act.moduleDown?.(e)}
    >
      <Show when={props.spec.inputs.length}>
        <div class="sr-col" style={{ left: '0' }} />
      </Show>
      <Show when={props.spec.outputs.length}>
        <div class="sr-col" style={{ right: '0' }} />
      </Show>
      <div
        class="sr-head"
        onDblClick={(e) => {
          e.stopPropagation();
          props.act.replace?.(e);
        }}
      >
        {props.name}
      </div>
      <Show when={ghosts().length}>
        <svg class="sr-ghosts" width={L().w} height={L().h}>
          <For each={ghosts()}>{(g) => <path class="ghost-normal" d={g.d} stroke={ROLE[g.role]} />}</For>
        </svg>
      </Show>
      <Show when={props.spec.display?.kind === 'contour' && L().display}>
        {(d) => (
          <Contour
            x={d().x}
            y={d().y}
            w={d().w}
            h={d().h}
            spec={props.spec}
            params={props.mod.params}
            advPatched={props.cabledIn('adv')}
            state={props.readouts?.state}
            edit={(c, merge) => props.act.editParams?.(c, merge)}
          />
        )}
      </Show>
      <Show when={props.spec.display?.kind === 'pads' && L().display}>
        {(d) => (
          <Pads
            x={d().x}
            y={d().y}
            w={d().w}
            h={d().h}
            params={props.mod.params}
            len={Math.round(knobValue('length'))}
            hits={Math.round(knobValue('hits'))}
            rot={Math.round(knobValue('rot'))}
            state={props.readouts?.state}
            edit={(c) => props.act.editParams?.(c)}
          />
        )}
      </Show>
      <For each={actions()}>
        {(p) => {
          const c = () => L().cells[p.id]!;
          return (
            <button
              class="sr-action"
              data-action={p.id}
              style={{ left: c().x + 4 + 'px', top: c().y + 6 + 'px', width: c().w - 8 + 'px' }}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => props.act.action?.(p.id)}
            >
              {p.label}
            </button>
          );
        }}
      </For>
      <Show when={props.spec.display?.kind === 'scope' && L().display}>
        {(d) => (
          <Scope
            x={d().x}
            y={d().y}
            w={d().w}
            h={d().h}
            mode={props.mod.params['mode'] ?? 0}
            trace={props.readouts?.trace ?? undefined}
          />
        )}
      </Show>

      <For each={props.spec.inputs}>
        {(port) => {
          const j = () => L().jacks[port.id]!;
          const field: FieldKind | null =
            port.role === 'trigger' ? 'ratio' : port.role === 'audio' ? null : 'att';
          const value = () =>
            field === 'ratio' ? (props.mod.ratios[port.id] ?? 1) : (props.mod.atts[port.id] ?? 1);
          const text = () => (field === 'ratio' ? fmtRat(value()) : fmtAtt(value()));
          const show = () => field !== null && (value() !== 1 || props.loud);
          return (
            <>
              <Jack
                port={port.id}
                dir="in"
                role={port.role}
                x={j().x}
                y={j().y}
                filled={props.cabledIn(port.id)}
                normalled={normalled(port.id)}
                ring={props.candidate === port.id}
                title={normalTitle(port.id, port.label)}
                onPointerDown={(e) => props.act.jackDown?.(port.id, 'in', port.role, e)}
                ref={(el) => {
                  if (port.role === 'trigger')
                    track(el, 'flash', () => props.readouts && props.readouts.trigs + trigIndex(port.id));
                  if (port.id === 'dice')
                    track(
                      el,
                      'watch',
                      () => props.readouts && props.readouts.trigs + trigIndex(port.id),
                      () => props.act.diceInput?.(),
                    );
                }}
              />
              <div
                class="sr-plabel"
                data-port={port.id}
                style={{ left: j().x + 11 + 'px', top: j().y - 10 + 'px' }}
              >
                {port.label}
              </div>
              <Show when={field}>
                {(kind) => (
                  <div
                    class="sr-field"
                    data-field={port.id}
                    style={{
                      left: j().x + 11 + 'px',
                      top: j().y + 1 + 'px',
                      color: value() === 1 ? '#5d594f' : undefined,
                    }}
                    onPointerDown={(e) => props.act.fieldDown?.(port.id, kind(), e)}
                    onDblClick={() => props.act.fieldReset?.(port.id, kind())}
                  >
                    {show() ? text() : ''}
                  </div>
                )}
              </Show>
            </>
          );
        }}
      </For>

      <For each={props.spec.outputs}>
        {(port, i) => {
          const j = () => L().jacks[port.id]!;
          return (
            <>
              <Jack
                port={port.id}
                dir="out"
                role={port.role}
                x={j().x}
                y={j().y}
                filled={props.cabledOut(port.id)}
                listening={props.listening === port.id}
                ring={props.candidate === port.id}
                onPointerDown={(e) => props.act.jackDown?.(port.id, 'out', port.role, e)}
              />
              <div
                class="sr-plabel"
                data-port={port.id}
                style={{ right: L().w - j().x + 11 + 'px', top: j().y - 10 + 'px', 'text-align': 'right' }}
              >
                {port.label}
              </div>
              <div
                class="sr-lvl"
                style={{
                  right: L().w - j().x + 11 + 'px',
                  top: j().y + 5 + 'px',
                  background: `var(--role-${port.role})`,
                }}
                ref={(el) => track(el, 'level', () => props.readouts && props.readouts.outs + i())}
              />
            </>
          );
        }}
      </For>

      <For each={knobs()}>
        {(p, i) => {
          const c = () => L().cells[p.id]!;
          const mj = () => L().jacks['@' + p.id]!;
          return (
            <>
              <Knob
                param={p}
                value={props.mod.params[p.id] ?? 0}
                x={c().x}
                y={c().y}
                modulated={props.cabledIn('@' + p.id)}
                depth={props.mod.atts['@' + p.id] ?? p.modDepth ?? 1}
                loud={props.loud}
                readout={props.readouts ? props.readouts.knobs + i() : undefined}
                scope={props.mod.id}
                set={(k, merge) => props.act.knob(p.id, k, merge)}
                setDepth={(v, merge) => props.act.depth?.(p.id, v, merge)}
                edit={(on) => props.act.edit(on)}
              />
              <Jack
                port={'@' + p.id}
                dir="in"
                role="mod"
                x={mj().x}
                y={mj().y}
                filled={props.cabledIn('@' + p.id)}
                ring={props.candidate === '@' + p.id}
                mod
                onPointerDown={(e) => props.act.jackDown?.('@' + p.id, 'in', 'mod', e)}
              />
            </>
          );
        }}
      </For>

      <For each={options()}>
        {(p) => {
          const c = () => L().cells[p.id]!;
          return (
            <Option
              param={p}
              value={props.mod.params[p.id] ?? 0}
              x={c().x}
              y={c().y}
              w={c().w}
              closeEpoch={props.closeEpoch ?? 0}
              scope={props.mod.id}
              set={(v, merge) => props.act.option(p.id, v, merge)}
            />
          );
        }}
      </For>

      <Show when={props.spec.type === 'out'}>
        <div class="sr-meter">
          <div ref={(el) => track(el, 'meter', () => (props.readouts ? 1 : undefined))} />
        </div>
      </Show>
    </div>
  );
}
