// The slow, pure parts of loading a sample (AIFF parsing, onset detection, peaks) off the main thread (spec §7a).
import { parseAiff } from './aiff';
import { onsets } from './onsets';
import { peaksOf } from './peaks';

export type WorkerRequest =
  | { id: number; kind: 'analyse'; channels: Float32Array[]; rate: number }
  | { id: number; kind: 'aiff'; bytes: ArrayBuffer };

export type WorkerReply =
  | {
      id: number;
      ok: true;
      channels: Float32Array[];
      rate: number;
      hits?: { at: number; strength: number }[];
      peaks?: Float32Array;
    }
  | { id: number; ok: false };

const scope = self as unknown as {
  onmessage: ((e: MessageEvent<WorkerRequest>) => void) | null;
  postMessage(msg: WorkerReply, transfer: Transferable[]): void;
};

scope.onmessage = (e) => {
  const m = e.data;
  try {
    if (m.kind === 'analyse') {
      const peaks = peaksOf(m.channels);
      const hits = onsets(m.channels, m.rate);
      scope.postMessage({ id: m.id, ok: true, channels: m.channels, rate: m.rate, hits, peaks }, [
        ...m.channels.map((c) => c.buffer),
        peaks.buffer,
      ]);
    } else {
      const a = parseAiff(m.bytes);
      scope.postMessage(
        { id: m.id, ok: true, channels: a.channels, rate: a.rate },
        a.channels.map((c) => c.buffer),
      );
    }
  } catch {
    scope.postMessage({ id: m.id, ok: false }, []);
  }
};
