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

/** A worker that never answers is given up on after this long, then the work runs in place. */
export const WORKER_TIMEOUT_MS = 60_000;

/**
 * The worker failed after the channels were transferred to it, so they are gone (detached). The caller decodes
 * again from the bytes it kept; the worker is not used afterwards.
 */
export class WorkerLost extends Error {}
let workerLost = false;

/** One request to a fresh worker (ended after the reply); null when there is no worker or it fails. */
function ask(req: WorkerRequest, transfer: Transferable[]): Promise<WorkerReply & { ok: true }> | null {
  let w: Worker | null;
  if (workerLost) return null;
  try {
    w = makeWorker();
  } catch {
    return null;
  }
  if (!w) return null;
  const worker = w;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => fail(new Error('worker timed out')), WORKER_TIMEOUT_MS);
    const fail = (err: Error) => {
      clearTimeout(timer);
      worker.terminate();
      reject(err);
    };
    worker.onmessage = (e: MessageEvent<WorkerReply>) => {
      clearTimeout(timer);
      worker.terminate();
      if (e.data.ok) resolve(e.data);
      else reject(new Error('worker refused'));
    };
    worker.onerror = () => fail(new Error('worker failed'));
    worker.onmessageerror = () => fail(new Error('worker reply unreadable'));
    try {
      worker.postMessage(req, transfer);
    } catch (err) {
      fail(err instanceof Error ? err : new Error('post failed'));
    }
  });
}

/** The channels with their onsets and column peaks. The buffers go to the worker and come back, so use the returned
 * channels, not the ones passed in. Throws `WorkerLost` when the worker failed after taking them. */
export async function analyseChannels(
  channels: Float32Array[],
  rate: number,
): Promise<Analysis & { channels: Float32Array[] }> {
  const frames = channels[0]?.length ?? 0;
  const p = ask({ id: 0, kind: 'analyse', channels, rate }, channels.map((c) => c.buffer));
  if (p) {
    try {
      const r = await p;
      analysisCounts.worker++;
      return { channels: r.channels, hits: r.hits ?? [], peaks: r.peaks ?? peaksOf(r.channels) };
    } catch {
      // transferring detached the channels: nothing is left to run in place
      if (frames > 0 && (channels[0]?.length ?? 0) === 0) {
        workerLost = true;
        throw new WorkerLost('analysis worker failed');
      }
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
  // the slice is transferred (one copy, not two); `bytes` stays whole for the in-place parse
  const sent = bytes.slice(0);
  const p = ask({ id: 0, kind: 'aiff', bytes: sent }, [sent]);
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

/** Back to using the worker (tests). */
export function resetWorkerLost(): void {
  workerLost = false;
}
