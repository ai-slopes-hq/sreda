import type { JSX } from 'solid-js';
import { track } from '../../live';
import type { MidiStatus } from '../../midi/devices';

/**
 * The A4 and A4 CLK display (spec §6): the label with a status dot and one lamp, lit while the note sounds or the
 * clock runs (the DSP's state, 1 or 0). Without the device it is dimmed and says why, like a missing sample.
 */
export function Device(props: {
  x: number;
  y: number;
  w: number;
  h: number;
  /** `A4 · T2` or `A4 CLK` */
  label: string;
  status: MidiStatus;
  /** the readout offset of the module's state */
  state: number | undefined;
}): JSX.Element {
  const up = () => props.status === 'connected';
  return (
    <div
      class="sr-disp sr-device"
      classList={{ missing: !up() }}
      style={{ left: props.x + 'px', top: props.y + 'px', width: props.w + 'px', height: props.h + 'px' }}
    >
      <span class="sr-dev-dot" classList={{ up: up() }} />
      <span class="sr-dev-label">
        {up() ? props.label : `${props.label} · ${props.status === 'missing' ? 'NOT CONNECTED' : 'NO MIDI'}`}
      </span>
      <span class="sr-lamp" ref={(el) => track(el, 'step', () => props.state)} />
    </div>
  );
}
