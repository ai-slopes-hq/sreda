import { createSignal, type JSX } from 'solid-js';
import { AudioHost } from './audio/host';

// For now the window is the empty canvas with one line about audio: the first click starts the engine and a
// 220 Hz test tone, later clicks toggle the tone. (The tone goes away in Task 6.)
export function App(): JSX.Element {
  const [line, setLine] = createSignal('CLICK TO START AUDIO');
  let host: AudioHost | null = null;
  let starting = false;
  let toneOn = false;

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
    toneOn = !toneOn;
    host.post({ t: 'tone', hz: toneOn ? 220 : 0 });
    setLine(toneOn ? 'TEST TONE 220 HZ · CLICK TO STOP' : 'TEST TONE OFF · CLICK TO PLAY');
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
