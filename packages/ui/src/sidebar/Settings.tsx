import { For, onCleanup, type JSX } from 'solid-js';
import type { SredaBridge } from '../library';
import type { SessionApi } from '../store';
import { applySkin, SKIN_NAMES, SKINS, type SkinName, type Token } from '../skins';

/** the colours a row shows: the grounds, the text and the four roles */
const SWATCHES: Token[] = ['ground', 'panel', 'text', 'role-audio', 'role-mod', 'role-pitch', 'role-trigger'];

/**
 * SETTINGS (spec §5a, §1a): the skin list. Hovering a row previews that skin on the whole app, leaving the list
 * restores the chosen one, a click chooses it and remembers it. The swatches come from SKINS, not from CSS
 * variables, so every row shows its own skin.
 */
export function Settings(props: { session: SessionApi; bridge?: SredaBridge | undefined }): JSX.Element {
  const s = props.session;
  const bridge = () => props.bridge ?? window.sreda;
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
    <div class="sr-skins" onMouseLeave={() => applySkin(s.state.skin)}>
      <div class="sr-skins-head">SKIN</div>
      <For each={SKIN_NAMES}>
        {(name) => (
          <button
            class="sr-skin"
            classList={{ on: s.state.skin === name }}
            data-skin={name}
            onMouseEnter={() => applySkin(name)}
            onClick={() => choose(name)}
          >
            <span class="name">{name}</span>
            <For each={SWATCHES}>
              {(t) => <span class="sw" style={{ background: SKINS[name][t] }} />}
            </For>
          </button>
        )}
      </For>
    </div>
  );
}
