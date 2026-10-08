// The WASM engine wrapped for TypeScript: instantiated synchronously, so it works in Node and in the AudioWorklet.
// process() and readouts() run on the audio thread: after the first call they allocate nothing (views are cached).
import type { Plan } from '@sreda/core';

const BLOCK = 128;

export interface WasmEngine {
  /** 0 = applied, 1 = not decodable or invalid, 2 = an unknown module type; on non-zero the old plan keeps playing */
  apply(plan: Plan): 0 | 1 | 2;
  applyJson(json: string): 0 | 1 | 2;
  knob(node: number, index: number, value: number): void;
  fixed(node: number, index: number, value: number): void;
  att(node: number, input: number, value: number): void;
  ratio(node: number, input: number, value: number): void;
  listen(target: { node: number; port: number } | null): void;
  /** a frame's gain glides to 0 (muted) or 1 over 50 ms */
  mute(frame: number, on: boolean): void;
  /** the speakers fade in over `ms` (a project just opened) */
  fadeIn(ms: number): void;
  /** Views into WASM memory, valid until the next call. */
  process(): { l: Float32Array; r: Float32Array };
  readouts(): Float32Array;
}

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
  engine_process(e: number): number;
  engine_readouts(e: number): number;
  engine_readouts_len(e: number): number;
}

/** UTF-8 without TextEncoder (the AudioWorklet scope has none). */
function utf8(s: string): Uint8Array {
  const out: number[] = [];
  for (const ch of s) {
    const c = ch.codePointAt(0)!;
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
    else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
  }
  return Uint8Array.from(out);
}

class Engine implements WasmEngine {
  private readonly out = { l: new Float32Array(0), r: new Float32Array(0) };
  private outKey: ArrayBuffer | null = null;
  private outPtr = 0;
  private reads = new Float32Array(0);
  private readKey: ArrayBuffer | null = null;
  private readPtr = 0;

  constructor(
    private readonly x: Exports,
    private readonly e: number,
  ) {}

  apply(plan: Plan): 0 | 1 | 2 {
    return this.applyJson(JSON.stringify(plan));
  }

  applyJson(json: string): 0 | 1 | 2 {
    const bytes = utf8(json);
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
}

export function loadEngine(module: WebAssembly.Module, sampleRate: number, seed: number): WasmEngine {
  const x = new WebAssembly.Instance(module, {}).exports as unknown as Exports;
  return new Engine(x, x.engine_new(sampleRate, seed));
}
