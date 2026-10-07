import { createSignal, type JSX } from 'solid-js';
import { compile, emptyDoc, SPECS, starterDoc } from '@sreda/core';
import { AudioHost } from './audio/host';

// For now the window is the empty canvas with one line about audio: the first click starts the engine playing
// the starter patch (OSC → OUT), later clicks toggle it. (The canvas replaces this in Task 6.)
export function App(): JSX.Element {
  const [line, setLine] = createSignal('CLICK TO START AUDIO');
  let host: AudioHost | null = null;
  let starting = false;
  let playing = false;
  let seq = 0;

  async function click(): Promise<void> {
    if (starting) return;
    if (!host) {
      starting = true;
      try {
        host = await AudioHost.start();
      } catch (err) {
        setLine(`AUDIO FAILED · ${err instanceof Error ? err.message : String(err)}`);
        return;
      } finally {
        starting = false;
      }
    }
    playing = !playing;
    host.post({ t: 'plan', plan: compile(playing ? starterDoc(SPECS) : emptyDoc, SPECS, ++seq) });
    setLine(playing ? 'OSC → OUT · 110 HZ SAW · CLICK TO STOP' : 'STOPPED · CLICK TO PLAY');
  }

  return (
    <div
      onClick={() => void click()}
      style={{
        position: 'fixed',
        inset: '0',
        background: '#121210',
        display: 'flex',
        'align-items': 'center',
        'justify-content': 'center',
        color: '#8f897c',
        font: "500 11px 'IBM Plex Mono', ui-monospace, monospace",
        'letter-spacing': '0.12em',
        'user-select': 'none',
      }}
    >
      {line()}
    </div>
  );
}
