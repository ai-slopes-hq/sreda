// The main-thread side of the audio path: the AudioContext, the compiled WASM engine, the worklet node and the
// readout buffer the worklet fills after every block.
import { READOUT_CAPACITY } from '@sreda/core';
import { EventRing, ringBytes, type FromEngine, type ToEngine } from '@sreda/protocol';
import wasmUrl from '../../../../engine/pkg/sreda_engine.wasm?url';
import workletUrl from './worklet.ts?worker&url';

export class AudioHost {
  /** a view over the SharedArrayBuffer the worklet copies the engine's readouts into */
  readonly readouts: Float32Array;
  /** engine events (MIDI) the worklet stamped with absolute frames; drain from the main thread */
  readonly events: EventRing;
  onMessage: ((msg: FromEngine) => void) | null = null;
  /** the worklet died (a trap in the engine) */
  onError: ((message: string) => void) | null = null;

  private constructor(
    private readonly context: AudioContext,
    private readonly node: AudioWorkletNode,
    readouts: Float32Array,
    events: EventRing,
  ) {
    this.readouts = readouts;
    this.events = events;
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
    const events = new SharedArrayBuffer(ringBytes());
    const node = new AudioWorkletNode(context, 'sreda', {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [2],
      processorOptions: { module, readouts: shared, events },
    });
    node.connect(context.destination);
    await context.resume();
    return new AudioHost(context, node, new Float32Array(shared), new EventRing(events));
  }

  /** stops the sound for good (a hot reload starts another session) */
  close(): void {
    this.node.port.onmessage = null;
    this.node.disconnect();
    void this.context.close();
  }

  get sampleRate(): number {
    return this.context.sampleRate;
  }

  post(msg: ToEngine): void {
    // a plan's bytes move to the audio thread without a copy
    if (msg.t === 'plan') this.node.port.postMessage(msg, [msg.bytes.buffer]);
    else if (msg.t === 'sample')
      this.node.port.postMessage(msg, [
        ...msg.channels.map((c) => c.buffer),
        msg.hits.buffer,
        msg.strengths.buffer,
      ]);
    else this.node.port.postMessage(msg);
  }
}
