import type { Specs } from '@sreda/core';
import { createEffect, createMemo, createSignal, For, onCleanup, onMount, type JSX } from 'solid-js';
import { pickerItems, TABS, type End, type LibEntry, type PickerItem, type PickerTab } from './patching';

export interface PickerProps {
  specs: Specs;
  /** screen position */
  x: number;
  y: number;
  /** a drag from a jack: only modules it can connect to (the same role first) and groups */
  from: End | null;
  /** the groups and projects on offer (factory and library) */
  library: LibEntry[];
  /** the tab it opens on */
  tab: PickerTab;
  /** REPLACE mode: the replaced module's name (modules only) */
  replace?: string | null;
  /** the library's samples (the SAMPLES tab) */
  samples?: string[];
  /** the highlighted row changed (null: none, or the picker closed): SAMPLES auditions it */
  highlight?(item: PickerItem | null): void;
  pick(item: PickerItem): void;
  close(): void;
}

/** One picker for modules, groups and projects (spec §6): tabs (Tab / ⇧Tab), type-ahead, ↑ / ↓, Enter, Esc. */
export function Picker(props: PickerProps): JSX.Element {
  const [q, setQ] = createSignal('');
  const [idx, setIdx] = createSignal(0);
  const [tab, setTab] = createSignal<PickerTab>(props.tab);
  const items = createMemo(() =>
    pickerItems(props.specs, q(), props.from, {
      tab: tab(),
      replace: !!props.replace,
      library: props.library,
      samples: props.samples ?? [],
    }),
  );
  /** the tabs on offer: modules only when replacing, no SAMPLES from a jack */
  const tabs = (): PickerTab[] =>
    props.replace ? ['MODULES'] : props.from ? TABS.filter((t) => t !== 'SAMPLES') : TABS;
  createEffect(() => props.highlight?.(items()[idx()] ?? null));
  onCleanup(() => props.highlight?.(null));
  let input: HTMLInputElement | undefined;
  let list: HTMLDivElement | undefined;
  onMount(() => input?.focus());
  createEffect(() => {
    q();
    tab();
    setIdx(0);
  });
  createEffect(() => list?.children[idx()]?.scrollIntoView({ block: 'nearest' }));

  function key(e: KeyboardEvent): void {
    e.stopPropagation();
    const n = items().length;
    if (e.key === 'ArrowDown') setIdx((idx() + 1) % Math.max(1, n));
    else if (e.key === 'ArrowUp') setIdx((idx() + n - 1) % Math.max(1, n));
    else if (e.key === 'Tab' && !props.replace) {
      const t = tabs();
      const i = t.indexOf(tab());
      setTab(t[(i + (e.shiftKey ? t.length - 1 : 1)) % t.length]!);
    } else if (e.key === 'Enter') {
      const it = items()[idx()];
      if (it) props.pick(it);
    } else if (e.key === 'Escape') props.close();
    else return;
    e.preventDefault();
  }

  const placeholder = () =>
    props.replace ? `REPLACE ${props.replace}` : props.from ? 'ADD AND WIRE…' : 'SEARCH…';

  return (
    <div
      class="sr-picker"
      style={{ left: props.x + 'px', top: props.y + 'px' }}
      onPointerDown={(e) => e.stopPropagation()}
      onWheel={(e) => e.stopPropagation()}
    >
      <div class="sr-ptabs">
        <For each={tabs()}>
          {(t) => (
            <button
              class="sr-ptab"
              classList={{ on: tab() === t || !!props.replace }}
              onPointerDown={(e) => e.preventDefault()}
              onClick={() => setTab(t)}
            >
              {t}
            </button>
          )}
        </For>
      </div>
      <input
        ref={(el) => (input = el)}
        class="sr-search"
        placeholder={placeholder()}
        value={q()}
        onInput={(e) => setQ(e.currentTarget.value)}
        onKeyDown={key}
        onBlur={() => queueMicrotask(() => document.activeElement !== input && props.close())}
      />
      <div class="sr-plist" ref={(el) => (list = el)}>
        <For each={items()}>
          {(it, i) => (
            <button
              class="sr-pitem"
              classList={{ on: i() === idx() }}
              data-kind={it.kind}
              onMouseEnter={() => setIdx(i())}
              onPointerDown={(e) => e.preventDefault()}
              onClick={() => props.pick(it)}
            >
              <span class="sr-pname">{it.label}</span>
              <span class="sr-pdesc">
                {it.kind === 'module'
                  ? it.desc
                  : `${it.folder ? it.folder + ' · ' : ''}${it.kind.toUpperCase()}`}
              </span>
            </button>
          )}
        </For>
      </div>
    </div>
  );
}
