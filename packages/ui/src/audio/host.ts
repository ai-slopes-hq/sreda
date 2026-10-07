// The main-thread side of the audio path: the AudioContext, the compiled WASM engine, the worklet node and the
// readout buffer the worklet fills after every block.
import { READOUT_CAPACITY } from '@sreda/core';
import type { FromEngine, ToEngine } from '@sreda/protocol';
import wasmUrl from '../../../../engine/pkg/sreda_engine.wasm?url';
import workletUrl from './worklet.ts?worker&url';

export class AudioHost {
  /** a view over the SharedArrayBuffer the worklet copies the engine's readouts into */
  readonly readouts: Float32Array;
  onMessage: ((msg: FromEngine) => void) | null = null;
  /** the worklet died (a trap in the engine) */
  onError: ((message: string) => void) | null = null;

  private constructor(
    private readonly context: AudioContext,
    private readonly node: AudioWorkletNode,
    readouts: Float32Array,
  ) {
    this.readouts = readouts;
    node.port.onmessage = (e: MessageEvent<FromEngine>) => this.onMessage?.(e.data);
    node.onprocessorerror = (e) => this.onError?.(String((e as ErrorEvent).message ?? e.type));
  }

  /** Call from a user gesture (autoplay rule). */
  static async start(): Promise<AudioHost> {
    const context = new AudioContext({ latencyHint: 'interactive' });
    const bytes = await (await fetch(wasmUrl)).arrayBuffer();
    const module = await WebAssembly.compile(bytes);
    await context.audioWorklet.addModule(workletUrl);
    const shared = new SharedArrayBuffer(READOUT_CAPACITY * 4);
    const node = new AudioWorkletNode(context, 'sreda', {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [2],
      processorOptions: { module, readouts: shared },
    });
    node.connect(context.destination);
    await context.resume();
    return new AudioHost(context, node, new Float32Array(shared));
  }

  get sampleRate(): number {
    return this.context.sampleRate;
  }

  post(msg: ToEngine): void {
    this.node.port.postMessage(msg);
  }
}
