// The main-thread side of the audio path: the AudioContext, the compiled WASM engine and the worklet node.
import type { ToEngine } from '@sreda/protocol';
import wasmUrl from '../../../../engine/pkg/sreda_engine.wasm?url';
import workletUrl from './worklet.ts?worker&url';

export class AudioHost {
  private constructor(
    private readonly context: AudioContext,
    private readonly node: AudioWorkletNode,
  ) {}

  /** Call from a user gesture (autoplay rule). */
  static async start(): Promise<AudioHost> {
    const context = new AudioContext({ latencyHint: 'interactive' });
    const bytes = await (await fetch(wasmUrl)).arrayBuffer();
    const module = await WebAssembly.compile(bytes);
    await context.audioWorklet.addModule(workletUrl);
    const node = new AudioWorkletNode(context, 'sreda', {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [2],
      processorOptions: { module },
    });
    node.connect(context.destination);
    await context.resume();
    return new AudioHost(context, node);
  }

  get sampleRate(): number {
    return this.context.sampleRate;
  }

  post(msg: ToEngine): void {
    this.node.port.postMessage(msg);
  }
}
