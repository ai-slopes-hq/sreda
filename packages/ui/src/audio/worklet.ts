// The AudioWorklet glue: owns the WASM engine, forwards messages, copies each block to the output.
// process() runs on the audio thread: no allocation, no closures, no array literals (CLAUDE.md).
import { loadEngine, RingWriter, type FromEngine, type ToEngine, type WasmEngine } from '@sreda/protocol';

// The worklet scope's globals (not in TypeScript's DOM lib).
declare const sampleRate: number;
declare const currentFrame: number;
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
  /** the event ring the UI drains: engine events stamped with their absolute frame */
  events: SharedArrayBuffer;
}

class SredaProcessor extends AudioWorkletProcessor {
  private readonly engine: WasmEngine;
  private readonly shared: Float32Array;
  private readonly ring: RingWriter;

  constructor(options: { processorOptions: Options }) {
    super();
    this.engine = loadEngine(options.processorOptions.module, sampleRate, (Math.random() * 2 ** 32) >>> 0);
    this.shared = new Float32Array(options.processorOptions.readouts);
    this.ring = new RingWriter(options.processorOptions.events);
    this.port.onmessage = (e: MessageEvent<ToEngine>) => this.receive(e.data);
  }

  private receive(msg: ToEngine): void {
    switch (msg.t) {
      case 'plan': {
        const reply: FromEngine = { t: 'applied', seq: msg.seq, code: this.engine.applyBytes(msg.bytes) };
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
      case 'master':
        this.engine.master(msg.value);
        break;
      case 'sample':
        this.engine.sample(msg.id, msg.channels, msg.hits, msg.strengths);
        break;
      case 'unsample':
        this.engine.unsample(msg.id);
        break;
      case 'audition':
        this.engine.audition(msg.id);
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
    const ev = this.engine.events();
    if (ev.length > 0) {
      const seq16 = (r[0] as number) & 0xffff;
      for (let i = 0; i + 1 < ev.length; i += 2) {
        const head = ev[i] as number;
        const seqNode = ((seq16 << 16) | (head >>> 16)) >>> 0;
        this.ring.write(currentFrame + (head & 0xffff), seqNode, ev[i + 1] as number);
      }
    }
    return true;
  }
}

registerProcessor('sreda', SredaProcessor);
