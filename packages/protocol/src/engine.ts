// The WASM engine wrapped for TypeScript: instantiated synchronously, so it works in Node and in the AudioWorklet.
// process() and readouts() run on the audio thread: after the first call they allocate nothing (views are cached).
import type { Plan } from '@sreda/core';

const BLOCK = 128;

export interface WasmEngine {
  /** 0 = applied, 1 = not decodable or invalid, 2 = an unknown module type; on non-zero the old plan keeps playing */
  apply(plan: Plan): 0 | 1 | 2;
  applyJson(json: string): 0 | 1 | 2;
  /** a plan as UTF-8 JSON bytes (what the worklet receives) */
  applyBytes(bytes: Uint8Array): 0 | 1 | 2;
  knob(node: number, index: number, value: number): void;
  fixed(node: number, index: number, value: number): void;
  att(node: number, input: number, value: number): void;
  ratio(node: number, input: number, value: number): void;
  listen(target: { node: number; port: number } | null): void;
  /** a frame's gain glides to 0 (muted) or 1 over 50 ms */
  mute(frame: number, on: boolean): void;
  /** the speakers fade in over `ms` (a project just opened) */
  fadeIn(ms: number): void;
  /** the master fader, 0…1 */
  master(v: number): void;
  /** a sample into the pool under `id` (one or two channels at the engine's rate; hits as positions and strengths) */
  sample(id: number, channels: Float32Array[], hits: Uint32Array, strengths: Float32Array): void;
  /** frees a sample's pool slot (a missing id plays silence) */
  unsample(id: number): void;
  /** play a sample in place of the mix, once; null stops */
  audition(id: number | null): void;
  /** Views into WASM memory, valid until the next call. */
  process(): { l: Float32Array; r: Float32Array };
  readouts(): Float32Array;
  /**
   * The engine's event outbox as ONE fixed-capacity view (EVENT_WORDS u32), the same object on every call until
   * WASM memory moves. This block's events are the first `eventsLen()` words, two per event:
   * `node << 16 | offset`, then the bytes little-endian. Words past `eventsLen()` are stale. Valid until the next call
   * to `process()`.
   */
  events(): Uint32Array;
  /** how many u32 words of `events()` this block filled (two per event) */
  eventsLen(): number;
  /** events dropped for want of room, since the engine was made */
  eventsDropped(): number;
}

/** the outbox capacity in u32 words: 1024 events of two words (EventBox::CAPACITY in the engine) */
export const EVENT_WORDS = 2048;

interface Exports {
  memory: WebAssembly.Memory;
  engine_new(sampleRate: number, seed: number): number;
  engine_alloc(len: number): number;
  engine_apply(e: number, ptr: number, len: number): number;
  engine_knob(e: number, node: number, index: number, value: number): void;
  engine_fixed(e: number, node: number, index: number, value: number): void;
  engine_att(e: number, node: number, input: number, value: number): void;
  engine_ratio(e: number, node: number, input: number, value: number): void;
  engine_listen(e: number, node: number, port: number): void;
  engine_mute(e: number, frame: number, on: number): void;
  engine_fade_in(e: number, ms: number): void;
  engine_master(e: number, v: number): void;
  engine_sample_alloc(e: number, id: number, frames: number, channels: number, hits: number): number;
  engine_sample_commit(e: number): void;
  engine_unsample(e: number, id: number): void;
  engine_audition(e: number, id: number): void;
  engine_process(e: number): number;
  engine_readouts(e: number): number;
  engine_readouts_len(e: number): number;
  engine_events(e: number): number;
  engine_events_len(e: number): number;
  engine_events_dropped(e: number): number;
}

class Engine implements WasmEngine {
  private readonly out = { l: new Float32Array(0), r: new Float32Array(0) };
  private outKey: ArrayBuffer | null = null;
  private outPtr = 0;
  private reads = new Float32Array(0);
  private readKey: ArrayBuffer | null = null;
  private readPtr = 0;
  private evs = new Uint32Array(0);
  private evKey: ArrayBuffer | null = null;
  private evPtr = 0;

  constructor(
    private readonly x: Exports,
    private readonly e: number,
  ) {}

  apply(plan: Plan): 0 | 1 | 2 {
    return this.applyJson(JSON.stringify(plan));
  }

  applyJson(json: string): 0 | 1 | 2 {
    return this.applyBytes(new TextEncoder().encode(json));
  }

  applyBytes(bytes: Uint8Array): 0 | 1 | 2 {
    const ptr = this.x.engine_alloc(bytes.length);
    new Uint8Array(this.x.memory.buffer, ptr, bytes.length).set(bytes);
    return this.x.engine_apply(this.e, ptr, bytes.length) as 0 | 1 | 2;
  }

  knob(node: number, index: number, value: number): void {
    this.x.engine_knob(this.e, node, index, value);
  }

  fixed(node: number, index: number, value: number): void {
    this.x.engine_fixed(this.e, node, index, value);
  }

  att(node: number, input: number, value: number): void {
    this.x.engine_att(this.e, node, input, value);
  }

  ratio(node: number, input: number, value: number): void {
    this.x.engine_ratio(this.e, node, input, value);
  }

  listen(target: { node: number; port: number } | null): void {
    this.x.engine_listen(this.e, target ? target.node : -1, target ? target.port : -1);
  }

  mute(frame: number, on: boolean): void {
    this.x.engine_mute(this.e, frame, on ? 1 : 0);
  }

  fadeIn(ms: number): void {
    this.x.engine_fade_in(this.e, ms);
  }

  master(v: number): void {
    this.x.engine_master(this.e, v);
  }

  sample(id: number, channels: Float32Array[], hits: Uint32Array, strengths: Float32Array): void {
    const frames = channels[0]?.length ?? 0;
    const n = Math.min(2, channels.length);
    const ptr = this.x.engine_sample_alloc(this.e, id, frames, n, hits.length);
    // views after the allocation (memory may have grown)
    const mem = new Float32Array(this.x.memory.buffer, ptr, n * frames + 2 * hits.length);
    for (let c = 0; c < n; c++) mem.set(channels[c]!, c * frames);
    for (let k = 0; k < hits.length; k++) {
      mem[n * frames + 2 * k] = hits[k]!;
      mem[n * frames + 2 * k + 1] = strengths[k]!;
    }
    this.x.engine_sample_commit(this.e);
  }

  unsample(id: number): void {
    this.x.engine_unsample(this.e, id);
  }

  audition(id: number | null): void {
    this.x.engine_audition(this.e, id ?? -1);
  }

  process(): { l: Float32Array; r: Float32Array } {
    const ptr = this.x.engine_process(this.e);
    const buffer = this.x.memory.buffer;
    if (buffer !== this.outKey || ptr !== this.outPtr) {
      // the first block, or WASM memory grew: re-make the views
      this.outKey = buffer;
      this.outPtr = ptr;
      this.out.l = new Float32Array(buffer, ptr, BLOCK);
      this.out.r = new Float32Array(buffer, ptr + BLOCK * 4, BLOCK);
    }
    return this.out;
  }

  readouts(): Float32Array {
    const ptr = this.x.engine_readouts(this.e);
    const len = this.x.engine_readouts_len(this.e);
    const buffer = this.x.memory.buffer;
    if (buffer !== this.readKey || ptr !== this.readPtr || len !== this.reads.length) {
      this.readKey = buffer;
      this.readPtr = ptr;
      this.reads = new Float32Array(buffer, ptr, len);
    }
    return this.reads;
  }

  events(): Uint32Array {
    const ptr = this.x.engine_events(this.e);
    const buffer = this.x.memory.buffer;
    if (buffer !== this.evKey || ptr !== this.evPtr) {
      // the first call, or WASM memory grew: re-make the one view
      this.evKey = buffer;
      this.evPtr = ptr;
      this.evs = new Uint32Array(buffer, ptr, EVENT_WORDS);
    }
    return this.evs;
  }

  eventsLen(): number {
    return this.x.engine_events_len(this.e);
  }

  eventsDropped(): number {
    return this.x.engine_events_dropped(this.e);
  }
}

export function loadEngine(module: WebAssembly.Module, sampleRate: number, seed: number): WasmEngine {
  const x = new WebAssembly.Instance(module, {}).exports as unknown as Exports;
  return new Engine(x, x.engine_new(sampleRate, seed));
}
