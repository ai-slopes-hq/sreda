import type { Specs } from '@sreda/core';
import { Show, type JSX } from 'solid-js';
import { Icon } from '../canvas/icons';
import type { LibEntry } from '../canvas/patching';
import { Segmented } from '../canvas/Segmented';
import type { LibraryApi } from '../library';
import type { SessionApi, SidebarState } from '../store';
import { Library } from './Library';
import { Mix } from './Mix';
import { Settings } from './Settings';
import { Wires } from './Wires';

/** the gap between the sidebar and the window's edges (spec §1b); the canvas ends this far past the sidebar's left edge */
export const SIDEBAR_GAP = 16;

const TABS: { id: SidebarState['tab']; label: string }[] = [
  { id: 'WIRES', label: 'Wires' },
  { id: 'MIX', label: 'Mix' },
  { id: 'LIBRARY', label: 'Library' },
  { id: 'SETTINGS', label: 'Settings' },
];

/**
 * The sidebar (spec §5a, §1b): a panel floating 16 px from the window's edges (above META-SEQ's drawer when it is open),
 * its left edge dragged (320 px … 70 % of the window); tabs Wires, Mix, Library and Settings, ✕ on the right.
 */
export function Sidebar(props: {
  session: SessionApi;
  specs: Specs;
  focus(id: string): void;
  lib: LibraryApi;
  entries: LibEntry[];
  fit(): void;
  middle(): { x: number; y: number };
}): JSX.Element {
  const s = props.session;
  const st = s.state;
  function gripDown(e: PointerEvent): void {
    if (e.button !== 0) return;
    e.preventDefault();
    const move = (ev: PointerEvent) =>
      s.setState(
        'sidebar',
        'width',
        Math.round(Math.min(innerWidth * 0.7, Math.max(320, innerWidth - SIDEBAR_GAP - ev.clientX))),
      );
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }
  return (
    <Show when={st.sidebar.open}>
      <aside
        class="sr-side"
        // it floats above META-SEQ's editor drawer, which takes the window's full width
        style={{ width: st.sidebar.width + 'px', bottom: SIDEBAR_GAP + (st.seq.id ? st.seq.h : 0) + 'px' }}
      >
        <div class="sr-grip" onPointerDown={gripDown} />
        <div class="sr-sd-h">
          <Segmented
            items={TABS}
            value={st.sidebar.tab}
            set={(tab) => s.setState('sidebar', 'tab', tab)}
            label="Sidebar tabs"
          />
          <button class="sr-ib" aria-label="Close sidebar" onClick={() => s.setState('sidebar', 'open', false)}>
            <Icon name="close" size={14} />
          </button>
        </div>
        <Show when={st.sidebar.tab === 'WIRES'}>
          <Wires session={s} specs={props.specs} focus={props.focus} />
        </Show>
        <Show when={st.sidebar.tab === 'MIX'}>
          <Mix session={s} specs={props.specs} focus={props.focus} />
        </Show>
        <Show when={st.sidebar.tab === 'LIBRARY'}>
          <Library
            session={s}
            lib={props.lib}
            entries={props.entries}
            fit={props.fit}
            middle={props.middle}
          />
        </Show>
        <Show when={st.sidebar.tab === 'SETTINGS'}>
          <Settings session={s} />
        </Show>
      </aside>
    </Show>
  );
}
