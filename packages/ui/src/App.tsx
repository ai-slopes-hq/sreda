import { bigPatch, FACTORY, SPECS, starterDoc } from '@sreda/core';
import { createResource, Show, type JSX } from 'solid-js';
import { unwrap } from 'solid-js/store';
import { AudioHost } from './audio/host';
import { loadSaved } from './autosave';
import { Canvas } from './canvas/Canvas';
import './library';
import { applySkin, SKIN_NAMES, type SkinName } from './skins';
import { createSession, type SessionApi } from './store';

declare global {
  interface Window {
    /** for e2e tests: the current document and the readout buffer */
    __sreda?: { doc(): unknown; readout(i: number): number; big?(): void };
  }
}

/**
 * Resumes the autosaved canvas; a first launch opens the factory project Pulse (e2e runs: the starter patch). The
 * first click anywhere starts audio.
 */
export function App(): JSX.Element {
  const [session] = createResource(async () => {
    const starter = (await window.sreda?.first().catch(() => null)) === 'starter';
    const pulse = FACTORY.find((e) => e.name === 'pulse')!;
    const first = starter ? starterDoc(SPECS) : pulse.build(SPECS);
    const saved = await loadSaved(SPECS, first);
    const { doc, notice } = saved;
    const project = !saved.fresh ? saved.project : starter ? null : { path: 'FACTORY/pulse', factory: true };
    const s = createSession(SPECS, doc, notice, project);
    window.__sreda = { doc: () => structuredClone(unwrap(s.state.doc)), readout: (i) => s.readout(i) };
    // dev builds: `__sreda.big()` in the console opens the 200-module patch (the smoothness check)
    if (import.meta.env.DEV)
      window.__sreda.big = () =>
        s.openProject(bigPatch(SPECS), { path: 'FACTORY/200 modules', factory: true });
    const skin = await window.sreda?.settings.skin().catch(() => null);
    if (skin && (SKIN_NAMES as readonly string[]).includes(skin)) {
      s.setState('skin', skin as SkinName);
      applySkin(skin as SkinName);
    }
    listenForFirstClick(s);
    return s;
  });
  return <Show when={session()}>{(s) => <Canvas session={s()} specs={SPECS} />}</Show>;
}

function listenForFirstClick(s: SessionApi): void {
  let starting = false;
  const first = (): void => {
    if (s.state.notice) s.setState('notice', null);
    if (starting || s.state.audio) return;
    starting = true;
    AudioHost.start()
      .then((host) => s.attach(host))
      .catch((err: unknown) =>
        s.setState('notice', `AUDIO FAILED · ${err instanceof Error ? err.message : String(err)}`),
      )
      .finally(() => (starting = false));
  };
  window.addEventListener('pointerdown', first, true);
}
