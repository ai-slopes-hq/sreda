import type { Specs } from '@sreda/core';
import { Show, type JSX } from 'solid-js';
import type { SessionApi } from '../store';
import { Mix } from './Mix';
import { Settings } from './Settings';
import { Wires } from './Wires';

/** The sidebar (spec §5a): docked right, its left edge dragged (320 px … 70 % of the window); tabs WIRES, MIX and SETTINGS. */
export function Sidebar(props: { session: SessionApi; specs: Specs; focus(id: string): void }): JSX.Element {
  const s = props.session;
  const st = s.state;
  function gripDown(e: PointerEvent): void {
    if (e.button !== 0) return;
    e.preventDefault();
    const move = (ev: PointerEvent) =>
      s.setState(
        'sidebar',
        'width',
        Math.round(Math.min(innerWidth * 0.7, Math.max(320, innerWidth - ev.clientX))),
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
      <aside class="sr-side" style={{ width: st.sidebar.width + 'px' }}>
        <div class="sr-grip" onPointerDown={gripDown} />
        <div class="sr-stabs">
          <button
            class="sr-gbtn"
            classList={{ on: st.sidebar.tab === 'WIRES' }}
            onClick={() => s.setState('sidebar', 'tab', 'WIRES')}
          >
            WIRES
          </button>
          <button
            class="sr-gbtn"
            classList={{ on: st.sidebar.tab === 'MIX' }}
            onClick={() => s.setState('sidebar', 'tab', 'MIX')}
          >
            MIX
          </button>
          <button
            class="sr-gbtn"
            classList={{ on: st.sidebar.tab === 'SETTINGS' }}
            onClick={() => s.setState('sidebar', 'tab', 'SETTINGS')}
          >
            SETTINGS
          </button>
          <Show when={st.sidebar.tab === 'WIRES'}>
            <button
              class="sr-gbtn"
              classList={{ on: st.sidebar.selOnly }}
              onClick={() => s.setState('sidebar', 'selOnly', !st.sidebar.selOnly)}
            >
              SELECTION
            </button>
          </Show>
          <span class="sp" />
          <button
            class="sr-gbtn"
            aria-label="Close sidebar"
            onClick={() => s.setState('sidebar', 'open', false)}
          >
            ✕
          </button>
        </div>
        <Show when={st.sidebar.tab === 'WIRES'}>
          <input
            class="sr-wfilter"
            placeholder="FILTER…"
            value={st.sidebar.q}
            onInput={(e) => s.setState('sidebar', 'q', e.currentTarget.value)}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'Escape') {
                s.setState('sidebar', 'q', '');
                e.currentTarget.blur();
              }
            }}
          />
          <Wires session={s} specs={props.specs} focus={props.focus} />
        </Show>
        <Show when={st.sidebar.tab === 'MIX'}>
          <Mix session={s} specs={props.specs} focus={props.focus} />
        </Show>
        <Show when={st.sidebar.tab === 'SETTINGS'}>
          <Settings session={s} />
        </Show>
      </aside>
    </Show>
  );
}
