import { For, Show, type JSX } from 'solid-js';

export interface SegmentedProps<T extends string> {
  items: { id: T; label: string; count?: number }[];
  value: T;
  set(v: T): void;
  /** an accent ring on this item (the drawer's playing pattern) */
  ring?: T | null;
  label?: string;
}

/** A row of tabs in one raised track; the selected one is lifted (spec §1b). */
export function Segmented<T extends string>(props: SegmentedProps<T>): JSX.Element {
  return (
    <div class="sr-seg" role="tablist" aria-label={props.label}>
      <For each={props.items}>
        {(it) => (
          <button
            type="button"
            role="tab"
            class="sr-seg-item"
            classList={{ on: props.value === it.id, ring: props.ring === it.id }}
            aria-selected={props.value === it.id}
            onPointerDown={(e) => e.preventDefault()}
            onClick={() => props.set(it.id)}
          >
            {it.label}
            <Show when={it.count !== undefined}>
              <span class="count">{it.count}</span>
            </Show>
          </button>
        )}
      </For>
    </div>
  );
}
