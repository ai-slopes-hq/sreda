// The WASM engine wrapped for TypeScript: instantiated synchronously, so it works in Node and in the AudioWorklet.
// process() runs on the audio thread: after the first call it allocates nothing (the views are cached).

const BLOCK = 128;

export interface WasmEngine {
  setTone(hz: number): void;
  /** Views into WASM memory, valid until the next call. */
  process(): { l: Float32Array; r: Float32Array };
}

interface Exports {
  memory: WebAssembly.Memory;
  engine_new(sampleRate: number, seed: number): number;
  engine_set_tone(e: number, hz: number): void;
  engine_process(e: number): number;
}

class Engine implements WasmEngine {
  private readonly out = { l: new Float32Array(0), r: new Float32Array(0) };
  private buffer: ArrayBuffer | null = null;
  private ptr = 0;

  constructor(
    private readonly x: Exports,
    private readonly e: number,
  ) {}

  setTone(hz: number): void {
    this.x.engine_set_tone(this.e, hz);
  }

  process(): { l: Float32Array; r: Float32Array } {
    const ptr = this.x.engine_process(this.e);
    const buffer = this.x.memory.buffer;
    if (buffer !== this.buffer || ptr !== this.ptr) {
      // the first block, or WASM memory grew: re-make the views
      this.buffer = buffer;
      this.ptr = ptr;
      this.out.l = new Float32Array(buffer, ptr, BLOCK);
      this.out.r = new Float32Array(buffer, ptr + BLOCK * 4, BLOCK);
    }
    return this.out;
  }
}

export function loadEngine(module: WebAssembly.Module, sampleRate: number, seed: number): WasmEngine {
  const x = new WebAssembly.Instance(module, {}).exports as unknown as Exports;
  return new Engine(x, x.engine_new(sampleRate, seed));
}
