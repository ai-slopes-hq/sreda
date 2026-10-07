import { SPECS } from '@sreda/core';
import { createResource, Show, type JSX } from 'solid-js';
import { unwrap } from 'solid-js/store';
import { AudioHost } from './audio/host';
import { loadSaved } from './autosave';
import { Canvas } from './canvas/Canvas';
import { createSession, type SessionApi } from './store';

declare global {
  interface Window {
    /** for e2e tests: the current document and the readout buffer */
    __sreda?: { doc(): unknown; readout(i: number): number };
  }
}

/** Resumes the autosaved canvas (or opens the starter patch); the first click anywhere starts audio. */
export function App(): JSX.Element {
  const [session] = createResource(async () => {
    const { doc, notice } = await loadSaved(SPECS);
    const s = createSession(SPECS, doc, notice);
    window.__sreda = { doc: () => structuredClone(unwrap(s.state.doc)), readout: (i) => s.readout(i) };
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
