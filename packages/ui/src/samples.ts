// Samples as a system (spec §7a): every sample a document names is read from the library's samples/ once per
// session, decoded at the engine's rate, given a stable id and sent to the engine's pool. A sample that cannot be
// read is MISSING (the module plays nothing; WIRES lists it); one that cannot be used is refused with a notice.
import type { Doc } from '@sreda/core';
import type { ToEngine } from '@sreda/protocol';
import { analyseChannels, parseAiffOff } from './samples/analysis';
import { COLUMNS } from './samples/peaks';

export { peaksOf } from './samples/peaks';

/** A sample refused: the reason, shown as `<NAME> — <reason>`. */
export class SampleError extends Error {}

export interface DecodedSample {
  /** one or two channels at the engine's rate */
  channels: Float32Array[];
  frames: number;
  rate: number;
  hits: { at: number; strength: number }[];
  /** 512 column peaks (0…1) for the displays */
  peaks: Float32Array;
}

const MAX_S = 600;
/** the engine's pool slot the audition uses (replaced each time, so browsing keeps one sample in memory) */
const AUDITION_ID = 0;
/** a loaded sample no shown document names for this long is dropped (its bytes, floats and the engine's copy) */
export const UNLOAD_MS = 30_000;

async function resample(src: AudioBuffer, rate: number): Promise<Float32Array[]> {
  const n = Math.min(2, src.numberOfChannels);
  if (src.sampleRate === rate) return Array.from({ length: n }, (_, c) => src.getChannelData(c).slice());
  const ctx = new OfflineAudioContext(n, Math.max(1, Math.ceil((src.length * rate) / src.sampleRate)), rate);
  const node = ctx.createBufferSource();
  node.buffer = src;
  node.connect(ctx.destination);
  node.start();
  const out = await ctx.startRendering();
  return Array.from({ length: n }, (_, c) => out.getChannelData(c).slice());
}

/**
 * A file's bytes as one or two channels at `rate`: `decodeAudioData` (WAV, FLAC, MP3, OGG; it resamples), AIFF
 * through `parseAiff` and an offline render. Throws `SampleError` when it cannot be decoded.
 */
export async function decodeSample(bytes: ArrayBuffer, name: string, rate: number): Promise<DecodedSample> {
  let channels: Float32Array[];
  try {
    if (/\.aiff?$/i.test(name)) {
      const a = await parseAiffOff(bytes);
      const frames = a.channels[0]?.length ?? 0;
      if (frames === 0)
        return check({
          channels: [new Float32Array(0)],
          frames: 0,
          rate,
          hits: [],
          peaks: new Float32Array(COLUMNS),
        });
      if (frames / a.rate > MAX_S) throw new SampleError('LONGER THAN 10 MINUTES');
      const src = new AudioBuffer({
        numberOfChannels: Math.min(2, a.channels.length),
        length: frames,
        sampleRate: a.rate,
      });
      for (let c = 0; c < src.numberOfChannels; c++)
        src.copyToChannel(a.channels[c]! as Float32Array<ArrayBuffer>, c);
      channels = await resample(src, rate);
    } else {
      const buf = await new OfflineAudioContext(2, 1, rate).decodeAudioData(bytes);
      if (buf.duration > MAX_S) throw new SampleError('LONGER THAN 10 MINUTES');
      channels = Array.from({ length: Math.min(2, buf.numberOfChannels) }, (_, c) =>
        buf.getChannelData(c).slice(),
      );
    }
  } catch (e) {
    if (e instanceof SampleError) throw e;
    throw new SampleError('CANNOT BE DECODED');
  }
  const frames = channels[0]?.length ?? 0;
  const a = await analyseChannels(channels, rate);
  return check({ channels: a.channels, frames, rate, hits: a.hits, peaks: a.peaks });
}

/** Refuses a sample with no frames or longer than 10 minutes. */
function check(s: DecodedSample): DecodedSample {
  if (s.frames === 0) throw new SampleError('NO AUDIO IN IT');
  if (s.frames / s.rate > MAX_S) throw new SampleError('LONGER THAN 10 MINUTES');
  return s;
}

export type SampleStatus = 'loading' | 'ready' | 'missing';

export interface SampleRegistry {
  /** the id a path is known by in the engine's pool (stable for the session) */
  id(path: string): number;
  status(path: string): SampleStatus | undefined;
  peaks(path: string): Float32Array | null;
  /** reads, decodes and sends a path (once per session; a missing or refused one is tried again) */
  load(path: string): Promise<void>;
  /** loads every path a document names; a loaded path it does not name starts its 30 s to unloading */
  loadDoc(doc: Doc): void;
  /** the engine is there: everything ready goes to it, decoded again if its rate differs */
  attach(post: (msg: ToEngine) => void, rate: number): void;
  /** plays a sample in place of the mix (null stops); decoded on the side, never kept */
  audition(path: string | null): Promise<void>;
  /** the frames and rate of a ready sample */
  info(path: string): { frames: number; rate: number; hits: { at: number; strength: number }[] } | null;
}

export function createSampleRegistry(o: {
  read: (path: string) => Promise<ArrayBuffer>;
  decode?: (bytes: ArrayBuffer, name: string, rate: number) => Promise<DecodedSample>;
  notice: (text: string) => void;
  /** a status changed (the plan and WIRES follow) */
  changed: () => void;
  /** the clock (tests) */
  now?: () => number;
}): SampleRegistry {
  const decode = o.decode ?? decodeSample;
  const now = o.now ?? Date.now;
  const ids = new Map<string, number>();
  const status = new Map<string, SampleStatus>();
  const bytes = new Map<string, ArrayBuffer>();
  const ready = new Map<string, DecodedSample>();
  const pending = new Map<string, Promise<void>>();
  /** loaded paths the last shown document did not name: since when */
  const unnamed = new Map<string, number>();
  /** bumped when a path is dropped: a decode started before it gives up */
  const generation = new Map<string, number>();
  let timer: ReturnType<typeof setTimeout> | null = null;
  let post: ((msg: ToEngine) => void) | null = null;
  let rate = 48_000;
  /** the audition's turn: a newer audition (or a stop) makes an older decode give up */
  let turn = 0;

  const name = (path: string) => (path.split('/').pop() ?? path).toUpperCase();
  const id = (path: string) => {
    // id 0 is the audition's slot
    if (!ids.has(path)) ids.set(path, ids.size + 1);
    return ids.get(path)!;
  };
  const send = (path: string | null, s: DecodedSample) => {
    if (!post) return;
    const channels = s.channels.slice(0, 2).map((c) => c.slice());
    post({
      t: 'sample',
      id: path === null ? AUDITION_ID : id(path),
      channels,
      hits: Uint32Array.from(s.hits, (h) => h.at),
      strengths: Float32Array.from(s.hits, (h) => h.strength),
    });
  };
  const decodeAt = async (path: string, b: ArrayBuffer): Promise<void> => {
    const gen = generation.get(path) ?? 0;
    try {
      const at = rate;
      const s = check(await decode(b.slice(0), path, at));
      if ((generation.get(path) ?? 0) !== gen) return;
      // the engine attached at another rate while this decoded: again, at its rate
      if (rate !== at) return decodeAt(path, b);
      ready.set(path, s);
      status.set(path, 'ready');
      send(path, s);
    } catch (e) {
      if ((generation.get(path) ?? 0) !== gen) return;
      status.delete(path);
      bytes.delete(path);
      ready.delete(path);
      o.notice(`${name(path)} — ${e instanceof SampleError ? e.message : 'CANNOT BE DECODED'}`);
    }
    o.changed();
  };

  const load = (path: string): Promise<void> => {
    const known = pending.get(path);
    // a missing or refused sample is tried again (the file may be back, or replaced)
    if (known && (status.get(path) === 'loading' || status.get(path) === 'ready')) return known;
    status.set(path, 'loading');
    id(path);
    const p = (async () => {
      let b: ArrayBuffer;
      try {
        b = await o.read(path);
      } catch {
        status.set(path, 'missing');
        o.changed();
        return;
      }
      bytes.set(path, b);
      await decodeAt(path, b);
    })();
    pending.set(path, p);
    return p;
  };

  const sweep = () => {
    timer = null;
    const t = now();
    let dropped = false;
    for (const [path, since] of [...unnamed]) {
      if (!status.has(path)) {
        unnamed.delete(path);
        continue;
      }
      if (t - since < UNLOAD_MS || status.get(path) === 'loading') continue;
      unnamed.delete(path);
      const sent = ready.has(path);
      generation.set(path, (generation.get(path) ?? 0) + 1);
      bytes.delete(path);
      ready.delete(path);
      status.delete(path);
      pending.delete(path);
      if (sent) post?.({ t: 'unsample', id: id(path) });
      dropped = true;
    }
    if (dropped) o.changed();
    arm();
  };
  /** one timer: it fires when the earliest unnamed path is due (a loading one is looked at again in a second) */
  const arm = () => {
    if (timer !== null || unnamed.size === 0) return;
    let due = Infinity;
    for (const since of unnamed.values()) due = Math.min(due, since + UNLOAD_MS);
    timer = setTimeout(sweep, Math.max(1_000, due - now() + 1));
  };

  return {
    id,
    status: (path) => status.get(path),
    peaks: (path) => ready.get(path)?.peaks ?? null,
    info: (path) => {
      const s = ready.get(path);
      return s ? { frames: s.frames, rate: s.rate, hits: s.hits } : null;
    },
    load,
    loadDoc(doc) {
      const named = new Set<string>();
      for (const m of doc.modules) if (m.sample) named.add(m.sample);
      for (const path of named) {
        unnamed.delete(path);
        void load(path);
      }
      const t = now();
      for (const path of status.keys()) if (!named.has(path) && !unnamed.has(path)) unnamed.set(path, t);
      arm();
    },
    attach(p, r) {
      post = p;
      const again = r !== rate;
      rate = r;
      for (const [path, s] of ready) {
        if (!again) send(path, s);
        else void decodeAt(path, bytes.get(path)!);
      }
    },
    async audition(path) {
      const mine = ++turn;
      if (!path) {
        post?.({ t: 'audition', id: null });
        return;
      }
      try {
        const b = bytes.get(path) ?? (await o.read(path));
        if (mine !== turn) return;
        const s = check(await decode(b.slice(0), path, rate));
        if (mine !== turn || !post) return;
        send(null, s);
        post({ t: 'audition', id: AUDITION_ID });
      } catch {
        // a file that will not play is simply not heard
      }
    },
  };
}
