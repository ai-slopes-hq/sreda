// Sample analysis off the main thread: a minute of stereo audio is a long synchronous loop in the renderer. The
// buffers travel to a worker and back (transferred, not copied); with no `Worker`, or when it fails, the same
// functions run in place.
import { parseAiff } from './aiff';
import { onsets } from './onsets';
import { peaksOf } from './peaks';
import type { WorkerReply, WorkerRequest } from './analysis.worker';

export interface Analysis {
  hits: { at: number; strength: number }[];
  peaks: Float32Array;
}

/** How often the work ran in the worker and how often in place (e2e reads it through `__sreda.analysis`). */
export const analysisCounts = { worker: 0, fallback: 0 };

/** Creates the worker; replaced in tests. Null when there is none. */
export let makeWorker: () => Worker | null = () =>
  typeof Worker === 'undefined'
    ? null
    : new Worker(new URL('./analysis.worker.ts', import.meta.url), { type: 'module' });

export function setWorkerFactory(f: () => Worker | null): void {
  makeWorker = f;
}

/** One request to a fresh worker (ended after the reply); null when there is no worker or it fails. */
function ask(req: WorkerRequest, transfer: Transferable[]): Promise<WorkerReply & { ok: true }> | null {
  let w: Worker | null;
  try {
    w = makeWorker();
  } catch {
    return null;
  }
  if (!w) return null;
  const worker = w;
  return new Promise((resolve, reject) => {
    worker.onmessage = (e: MessageEvent<WorkerReply>) => {
      worker.terminate();
      if (e.data.ok) resolve(e.data);
      else reject(new Error('worker refused'));
    };
    worker.onerror = () => {
      worker.terminate();
      reject(new Error('worker failed'));
    };
    try {
      worker.postMessage(req, transfer);
    } catch (err) {
      worker.terminate();
      reject(err instanceof Error ? err : new Error('post failed'));
    }
  });
}

/** The channels with their onsets and column peaks. The buffers go to the worker and come back, so use the returned
 * channels, not the ones passed in. */
export async function analyseChannels(
  channels: Float32Array[],
  rate: number,
): Promise<Analysis & { channels: Float32Array[] }> {
  // a copy stays here for the fallback: transferring detaches the originals
  const sent = channels.map((c) => c.slice());
  const p = ask({ id: 0, kind: 'analyse', channels: sent, rate }, [...sent.map((c) => c.buffer)]);
  if (p) {
    try {
      const r = await p;
      analysisCounts.worker++;
      return { channels: r.channels, hits: r.hits ?? [], peaks: r.peaks ?? peaksOf(r.channels) };
    } catch {
      // fall through to the in-place run
    }
  }
  analysisCounts.fallback++;
  return { channels, hits: onsets(channels, rate), peaks: peaksOf(channels) };
}

/** `{ hits, peaks }` of the channels, computed in a worker when there is one. */
export async function analyse(channels: Float32Array[], rate: number): Promise<Analysis> {
  const { hits, peaks } = await analyseChannels(channels, rate);
  return { hits, peaks };
}

/** An AIFF file as float channels and its rate, parsed in a worker when there is one. Throws on a bad file. */
export async function parseAiffOff(bytes: ArrayBuffer): Promise<{ channels: Float32Array[]; rate: number }> {
  const p = ask({ id: 0, kind: 'aiff', bytes: bytes.slice(0) }, []);
  if (p) {
    try {
      const r = await p;
      analysisCounts.worker++;
      return { channels: r.channels, rate: r.rate };
    } catch {
      // fall through: a bad file throws from the in-place parse below
    }
  }
  analysisCounts.fallback++;
  return parseAiff(bytes);
}
