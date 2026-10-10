import type { Specs } from '@sreda/core';
import { createEffect, createMemo, createSignal, For, onMount, type JSX } from 'solid-js';
import { fitInside, pickerItems, TABS, type End, type LibEntry, type PickerItem, type PickerTab } from './patching';

export interface PickerProps {
  specs: Specs;
  /** screen position */
  x: number;
  y: number;
  /** the area it must stay inside (the canvas) */
  bounds(): { w: number; h: number };
  /** a drag from a jack: only modules it can connect to (the same role first) and groups */
  from: End | null;
  /** the groups and projects on offer (factory and library) */
  library: LibEntry[];
  /** the tab it opens on */
  tab: PickerTab;
  /** REPLACE mode: the replaced module's name (modules only) */
  replace?: string | null;
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
    }),
  );
  /** the tabs on offer: modules only when replacing */
  const tabs = (): PickerTab[] => (props.replace ? ['MODULES'] : TABS);
  let input: HTMLInputElement | undefined;
  let list: HTMLDivElement | undefined;
  let box: HTMLDivElement | undefined;
  /** where it is: opened at the pointer, pushed back inside when its real size runs off the canvas */
  const [at, setAt] = createSignal({ x: props.x, y: props.y });
  const fit = () => box && setAt(fitInside(at(), { w: box.offsetWidth, h: box.offsetHeight }, props.bounds()));
  onMount(() => input?.focus());
  createEffect(() => {
    items();
    tab();
    // after the list has rendered: a longer list may need room; a shorter one leaves it where it is
    queueMicrotask(fit);
  });
  createEffect(() => {
    q();
    tab();
    setIdx(0);
  });
  createEffect(() => list?.children[idx()]?.scrollIntoView({ block: 'nearest' }));

  function key(e: KeyboardEvent): void {
    e.stopPropagation();
    const n = items().length;
    if (e.key === 'ArrowDown') {
      setIdx((idx() + 1) % Math.max(1, n));
    } else if (e.key === 'ArrowUp') {
      setIdx((idx() + n - 1) % Math.max(1, n));
    } else if (e.key === 'Tab' && !props.replace) {
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
      ref={(el) => (box = el)}
      class="sr-picker"
      style={{ left: at().x + 'px', top: at().y + 'px' }}
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
              onMouseEnter={() => {
                setIdx(i());
              }}
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
