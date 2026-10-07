import type { Specs } from '@sreda/core';
import { createEffect, createMemo, createSignal, For, onMount, type JSX } from 'solid-js';
import { pickerItems, type End } from './patching';

export interface PickerProps {
  specs: Specs;
  /** screen position */
  x: number;
  y: number;
  /** a drag from a jack: only modules it can connect to, the same role first */
  from: End | null;
  pick(type: string): void;
  close(): void;
}

/** Type-ahead module search: ↑ / ↓, Enter places, Esc closes; the list scrolls. */
export function Picker(props: PickerProps): JSX.Element {
  const [q, setQ] = createSignal('');
  const [idx, setIdx] = createSignal(0);
  const items = createMemo(() => pickerItems(props.specs, q(), props.from));
  let input: HTMLInputElement | undefined;
  let list: HTMLDivElement | undefined;
  onMount(() => input?.focus());
  createEffect(() => {
    q();
    setIdx(0);
  });
  createEffect(() => list?.children[idx()]?.scrollIntoView({ block: 'nearest' }));

  function key(e: KeyboardEvent): void {
    e.stopPropagation();
    const n = items().length;
    if (e.key === 'ArrowDown') setIdx((idx() + 1) % Math.max(1, n));
    else if (e.key === 'ArrowUp') setIdx((idx() + n - 1) % Math.max(1, n));
    else if (e.key === 'Enter') {
      const it = items()[idx()];
      if (it) props.pick(it.type);
    } else if (e.key === 'Escape') props.close();
    else return;
    e.preventDefault();
  }

  return (
    <div
      class="sr-picker"
      style={{ left: props.x + 'px', top: props.y + 'px' }}
      onPointerDown={(e) => e.stopPropagation()}
      onWheel={(e) => e.stopPropagation()}
    >
      <input
        ref={(el) => (input = el)}
        class="sr-search"
        placeholder={props.from ? 'ADD AND WIRE…' : 'ADD MODULE…'}
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
              onMouseEnter={() => setIdx(i())}
              onPointerDown={(e) => e.preventDefault()}
              onClick={() => props.pick(it.type)}
            >
              <span class="sr-pname">{it.label}</span>
              <span class="sr-pdesc">{it.desc}</span>
            </button>
          )}
        </For>
      </div>
    </div>
  );
}
