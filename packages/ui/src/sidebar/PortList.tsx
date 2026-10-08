import type { Role, WirePort } from '@sreda/core';
import { createEffect, createMemo, createSignal, For, onCleanup, onMount, type JSX } from 'solid-js';
import { ROLE } from '../canvas/glyphs';

/** A list of ports to move a wire end to (spec §5a): the other end's role first, a filter, ↑ / ↓ / Enter / Esc. */
export function PortList(props: {
  ports: WirePort[];
  otherRole: Role | null;
  title: string;
  pick(p: WirePort): void;
  candidate(p: WirePort | null): void;
  close(): void;
}): JSX.Element {
  const [q, setQ] = createSignal('');
  const [idx, setIdx] = createSignal(0);
  const items = createMemo(() => {
    const s = q().trim().toLowerCase();
    return props.ports
      .filter((p) => !s || p.label.toLowerCase().includes(s))
      .sort((a, b) => Number(b.role === props.otherRole) - Number(a.role === props.otherRole));
  });
  let input: HTMLInputElement | undefined;
  let list: HTMLDivElement | undefined;
  onMount(() => input?.focus());
  // a list replaced by the next one (a new wire's second end) blurs as it goes: that is not a click away
  let alive = true;
  onCleanup(() => (alive = false));
  createEffect(() => {
    q();
    setIdx(0);
  });
  // the port under the pointer or picked with ↑ / ↓ is ringed on the canvas
  createEffect(() => props.candidate(items()[idx()] ?? null));
  createEffect(() => list?.children[idx()]?.scrollIntoView({ block: 'nearest' }));

  function key(e: KeyboardEvent): void {
    e.stopPropagation();
    const n = items().length;
    if (e.key === 'ArrowDown') setIdx((idx() + 1) % Math.max(1, n));
    else if (e.key === 'ArrowUp') setIdx((idx() + n - 1) % Math.max(1, n));
    else if (e.key === 'Enter') {
      const p = items()[idx()];
      if (p) props.pick(p);
    } else if (e.key === 'Escape') props.close();
    else return;
    e.preventDefault();
  }

  return (
    <div class="sr-ports" onPointerDown={(e) => e.stopPropagation()}>
      <div class="sr-ports-title">{props.title}</div>
      <input
        ref={(el) => (input = el)}
        class="sr-wfilter"
        placeholder="PORT…"
        value={q()}
        onInput={(e) => setQ(e.currentTarget.value)}
        onKeyDown={key}
        onBlur={() => queueMicrotask(() => alive && document.activeElement !== input && props.close())}
      />
      <div class="sr-ports-list" ref={(el) => (list = el)}>
        <For each={items()}>
          {(p, i) => (
            <button
              class="sr-port"
              classList={{ on: i() === idx() }}
              onMouseEnter={() => setIdx(i())}
              onPointerDown={(e) => e.preventDefault()}
              onClick={() => props.pick(p)}
            >
              <span class="dot" style={{ background: ROLE[p.role] }} />
              {p.label}
            </button>
          )}
        </For>
      </div>
    </div>
  );
}
