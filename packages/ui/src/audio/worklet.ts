// The AudioWorklet glue: owns the WASM engine, forwards messages, copies each block to the output.
// process() runs on the audio thread: no allocation, no closures, no array literals (CLAUDE.md).
import { loadEngine, type ToEngine, type WasmEngine } from '@sreda/protocol';

// The worklet scope's globals (not in TypeScript's DOM lib).
declare const sampleRate: number;
declare function registerProcessor(
  name: string,
  ctor: new (options: { processorOptions: Options }) => object,
): void;
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
}

interface Options {
  module: WebAssembly.Module;
}

class SredaProcessor extends AudioWorkletProcessor {
  private readonly engine: WasmEngine;

  constructor(options: { processorOptions: Options }) {
    super();
    this.engine = loadEngine(options.processorOptions.module, sampleRate, (Math.random() * 2 ** 32) >>> 0);
    this.port.onmessage = (e: MessageEvent<ToEngine>) => this.receive(e.data);
  }

  private receive(msg: ToEngine): void {
    if (msg.t === 'tone') this.engine.setTone(msg.hz);
  }

  process(_inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const out = outputs[0];
    if (out === undefined) return true;
    const block = this.engine.process();
    out[0]?.set(block.l);
    out[1]?.set(block.r);
    return true;
  }
}

registerProcessor('sreda', SredaProcessor);
