// The AudioWorklet glue: owns the WASM engine, forwards messages, copies each block to the output.
// process() runs on the audio thread: no allocation, no closures, no array literals (CLAUDE.md).
import { loadEngine, type FromEngine, type ToEngine, type WasmEngine } from '@sreda/protocol';

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
  /** the UI reads this once per frame */
  readouts: SharedArrayBuffer;
}

class SredaProcessor extends AudioWorkletProcessor {
  private readonly engine: WasmEngine;
  private readonly shared: Float32Array;

  constructor(options: { processorOptions: Options }) {
    super();
    this.engine = loadEngine(options.processorOptions.module, sampleRate, (Math.random() * 2 ** 32) >>> 0);
    this.shared = new Float32Array(options.processorOptions.readouts);
    this.port.onmessage = (e: MessageEvent<ToEngine>) => this.receive(e.data);
  }

  private receive(msg: ToEngine): void {
    switch (msg.t) {
      case 'plan': {
        const reply: FromEngine = { t: 'applied', seq: msg.plan.seq, code: this.engine.apply(msg.plan) };
        this.port.postMessage(reply);
        break;
      }
      case 'knob':
        this.engine.knob(msg.node, msg.index, msg.value);
        break;
      case 'fixed':
        this.engine.fixed(msg.node, msg.index, msg.value);
        break;
      case 'att':
        this.engine.att(msg.node, msg.input, msg.value);
        break;
      case 'ratio':
        this.engine.ratio(msg.node, msg.input, msg.value);
        break;
      case 'listen':
        this.engine.listen(msg.target);
        break;
      case 'mute':
        this.engine.mute(msg.frame, msg.on);
        break;
      case 'fade':
        this.engine.fadeIn(msg.ms);
        break;
    }
  }

  process(_inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const out = outputs[0];
    if (out === undefined) return true;
    const block = this.engine.process();
    out[0]?.set(block.l);
    out[1]?.set(block.r);
    const r = this.engine.readouts();
    if (r.length <= this.shared.length) this.shared.set(r);
    return true;
  }
}

registerProcessor('sreda', SredaProcessor);
