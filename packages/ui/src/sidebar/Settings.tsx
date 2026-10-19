import { createSignal, For, onCleanup, Show, type JSX } from 'solid-js';
import { Icon } from '../canvas/icons';
import type { SredaBridge } from '../library';
import type { SessionApi } from '../store';
import { applySkin, SKIN_NAMES, SKINS, type SkinName, type Token } from '../skins';
import { SideFooter } from './SideField';

/** each skin's line under its name (spec §1b) */
export const SKIN_LINE: Record<SkinName, string> = {
  DEFAULT: 'Warm graphite',
  ANNABIOSIS: 'Deep green, neon roles',
  KANAGAWA: 'Ink-blue night',
  TOUCH: 'Neutral grey',
  NORD: 'Cool slate',
  'TOKYO NIGHT': 'Indigo night',
  ORCA: 'Monochrome',
};

/** the four role dots on a tile */
const ROLES: Token[] = ['role-audio', 'role-mod', 'role-pitch', 'role-trigger'];

/**
 * SETTINGS (spec §5a, §1a, §1b): the skin list. Hovering a row previews that skin on the whole app, leaving the list
 * restores the chosen one, a click chooses it and remembers it. The tiles come from SKINS, not from CSS variables, so
 * every row shows its own skin.
 */
export function Settings(props: { session: SessionApi; bridge?: SredaBridge | undefined }): JSX.Element {
  const s = props.session;
  const bridge = () => props.bridge ?? window.sreda;
  const [hover, setHover] = createSignal<SkinName | null>(null);
  function choose(name: SkinName): void {
    s.setState('skin', name);
    applySkin(name);
    void bridge()
      ?.settings.setSkin(name)
      .catch(() => {});
  }
  // the list unmounting (Esc, W, M) while a row is hovered: no mouseleave comes, so restore the chosen skin here
  onCleanup(() => applySkin(s.state.skin));
  return (
    <>
      <div
        class="sr-skins"
        onMouseLeave={() => {
          setHover(null);
          applySkin(s.state.skin);
        }}
      >
        <div class="sr-skins-head">
          <span>SKIN</span>
          <span class="n">{SKIN_NAMES.length}</span>
        </div>
        <For each={SKIN_NAMES}>
          {(name) => {
            const t = SKINS[name];
            const previewing = () => hover() === name && s.state.skin !== name;
            return (
              <button
                class="sr-skin"
                classList={{ on: s.state.skin === name, hl: previewing() }}
                data-skin={name}
                onMouseEnter={() => {
                  setHover(name);
                  applySkin(name);
                }}
                onClick={() => choose(name)}
              >
                <span class="tile" style={{ background: t.ground }}>
                  <span class="p" style={{ background: t.panel }} />
                  <span class="t" style={{ background: t.text }} />
                  <For each={ROLES}>
                    {(r, i) => <span class="rd" style={{ left: 15 + i() * 8 + 'px', background: t[r] }} />}
                  </For>
                </span>
                <span class="sk-txt">
                  <span class="name">{name}</span>
                  <span class="line">{previewing() ? 'Previewing — click to keep' : SKIN_LINE[name]}</span>
                </span>
                <Show when={s.state.skin === name}>
                  <span class="sk-r">
                    <Icon name="check" size={16} />
                  </span>
                </Show>
              </button>
            );
          }}
        </For>
      </div>
      <SideFooter>
        <span>Skins change colour only</span>
      </SideFooter>
    </>
  );
}
