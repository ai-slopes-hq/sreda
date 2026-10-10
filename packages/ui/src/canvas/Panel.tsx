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
import { readoutBuffer, track } from '../live';
import { fmtAtt, fmtRat, ROLE } from './glyphs';
import { Jack } from './Jack';
import { Knob } from './Knob';
import { Option } from './Option';
import { Contour } from './displays/Contour';
import { Pads } from './displays/Pads';
import { Room } from './displays/Room';
import { Grains } from './displays/Grains';
import { Wave } from './displays/Wave';
import type { Cursor } from './displays/gesture';
import { Scope } from './displays/Scope';
import { SeqView } from './displays/SeqView';

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
  /** a hidden knob a display drives by message only (SAMPLER's `scrub` and `play`): the engine, not the document */
  fixed?(param: string, value: number): void;
  /** an action button (DICE) */
  action?(param: string): void;
  /** a display edit: several params in one undo step */
  editParams?(changes: Record<string, number>, merge?: Merge): void;
  /** the module's DICE input fired (the patch changes, no undo step) */
  diceInput?(): void;
  /** LOAD, or a click on a sample display: choose this module's sample */
  load?(): void;
  /** META-SEQ: a click on its display opens the editor drawer */
  openSeq?(): void;
  /** META-SEQ: every frame, the readout buffer and the trace's offset (MUTATE's write-back) */
  seqFrame?(buf: Float32Array, at: number): void;
}

/** What a sample display shows of the module's sample. */
export interface SampleView {
  path: string;
  missing: boolean;
  peaks: Float32Array | null;
  /** hits as 0…1 of the file, with their strength */
  hits: { at: number; strength: number }[];
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
  /** SAMPLER / GRAINS: the module's sample (undefined: none chosen) */
  sample?: SampleView | undefined;
}

/** A module drawn by the panel grammar from its spec: jacks in the side columns, knobs, the mode strip. */
export function Panel(props: PanelProps): JSX.Element {
  const L = createMemo(() => layoutPanel(props.spec));
  const knobs = () => props.spec.params.filter((p): p is KnobParam => p.kind === 'knob' && !p.hidden);
  const options = () => props.spec.params.filter((p): p is OptionParam => p.kind === 'option' && !p.hidden);
  const actions = () => props.spec.params.filter((p) => p.kind === 'action');
  /** SAMPLER's SLICES reads SENS (0…1, the same knob position) while AUTO is on */
  const shown = (p: KnobParam): KnobParam => {
    if (p.id !== 'slices' || props.spec.type !== 'sampler' || props.mod.params['auto'] !== 1) return p;
    const { step: _step, ...rest } = p;
    return { ...rest, label: 'SENS', min: 0, max: 1 };
  };
  /** one gesture on a display = one undo step: its knob changes share a merge key until it ends */
  let strokes = 0;
  let stroke = '';
  const merge = (): Merge => {
    if (!stroke) stroke = `display:${props.mod.id}:${++strokes}`;
    return { key: stroke, stroke: true };
  };
  /** one-shot requests to SAMPLER's `play`: a counter + the position, so every click is a new value */
  let plays = 0;
  /** SAMPLER's display (spec §7a): ONE / LOOP click = START, drag = scrub + START; SLICE click = play that slice */
  const waveCursor = (c: Cursor) => {
    const slice = (props.mod.params['mode'] ?? 0) === 2;
    if (c.phase === 'click') {
      if (slice) props.act.fixed?.('play', ++plays + Math.min(c.t, 0.999999));
      else props.act.knob('start', c.t, undefined);
    } else if (c.phase === 'drag') {
      props.act.fixed?.('scrub', c.t);
      if (!slice) props.act.knob('start', c.t, merge());
    } else {
      props.act.fixed?.('scrub', -1);
      stroke = '';
    }
  };
  /** GRAINS' display: POS follows the pointer, one undo step per gesture */
  const grainsCursor = (pos: number, phase: Cursor['phase']) => {
    if (phase === 'click') props.act.knob('pos', pos, undefined);
    else if (phase === 'drag') props.act.knob('pos', pos, merge());
    else stroke = '';
  };
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
          <For each={ghosts()}>
            {(g) => <path class="ghost-normal" d={g.d} style={{ stroke: ROLE[g.role] }} />}
          </For>
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
              onClick={() => (p.id === 'load' ? props.act.load?.() : props.act.action?.(p.id))}
            >
              {p.label}
            </button>
          );
        }}
      </For>
      <Show when={props.spec.display?.kind === 'wave' && L().display}>
        {(d) => {
          const opt = (id: string) => props.mod.params[id] ?? 0;
          // AUTO cuts at the hits at least 1 − SENS strong (SENS reads SLICES' knob position)
          const sens = () => props.mod.params['slices'] ?? 0;
          return (
            <Wave
              x={d().x}
              y={d().y}
              w={d().w}
              h={d().h}
              peaks={props.sample?.peaks ?? null}
              path={props.sample?.path}
              missing={props.sample?.missing ?? false}
              mode={opt('mode')}
              rev={opt('rev') === 1}
              auto={opt('auto') === 1}
              start={knobValue('start')}
              len={knobValue('len')}
              slices={knobValue('slices')}
              hits={(props.sample?.hits ?? []).filter((h) => h.strength >= 1 - sens()).map((h) => h.at)}
              state={props.readouts?.state}
              onLoad={() => props.act.load?.()}
              onCursor={waveCursor}
            />
          );
        }}
      </Show>
      <Show when={props.spec.display?.kind === 'grains' && L().display}>
        {(d) => (
          <Grains
            x={d().x}
            y={d().y}
            w={d().w}
            h={d().h}
            pos={knobValue('pos')}
            live={(props.mod.params['source'] ?? 0) === 1}
            frozen={(props.mod.params['freeze'] ?? 0) === 1}
            path={props.sample?.path}
            missing={props.sample?.missing ?? false}
            peaks={props.sample?.peaks ?? null}
            trace={props.readouts?.trace ?? undefined}
            onLoad={() => props.act.load?.()}
            onPos={grainsCursor}
          />
        )}
      </Show>
      <Show when={props.spec.display?.kind === 'room' && L().display}>
        {(d) => (
          <Room
            x={d().x}
            y={d().y}
            w={d().w}
            h={d().h}
            type={(['ROOM', 'PLATE', 'HALL'] as const)[props.mod.params['type'] ?? 0] ?? 'ROOM'}
            size={knobValue('size')}
            decay={knobValue('decay')}
            damp={knobValue('damp')}
            pre={knobValue('pre') / 0.25}
            freeze={(props.mod.params['freeze'] ?? 0) === 1}
            state={props.readouts?.state}
          />
        )}
      </Show>
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
      <Show when={props.spec.display?.kind === 'metaseq' && L().display}>
        {(d) => (
          <SeqView
            x={d().x}
            y={d().y}
            w={d().w}
            h={d().h}
            params={props.mod.params}
            trace={undefined}
            traceAt={props.readouts?.trace ?? undefined}
            onOpen={() => props.act.openSeq?.()}
          />
        )}
      </Show>
      <Show when={props.spec.display?.kind === 'metaseq'}>
        <span
          hidden
          ref={(el) =>
            track(
              el,
              'tick',
              () => props.readouts?.trace ?? undefined,
              (at) => {
                const buf = readoutBuffer();
                if (buf) props.act.seqFrame?.(buf, at);
              },
            )
          }
        />
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
                      color: value() === 1 ? 'var(--faint)' : undefined,
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
                param={shown(p)}
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
              live={
                p.glyph === 'response'
                  ? {
                      cut: props.mod.params['cutoff'] ?? 0.5,
                      res: props.mod.params['res'] ?? 0,
                      state: props.readouts?.state,
                      res_knob: props.readouts
                        ? props.readouts.knobs + knobs().findIndex((k) => k.id === 'res')
                        : undefined,
                    }
                  : undefined
              }
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
