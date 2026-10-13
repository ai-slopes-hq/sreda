// Test doubles for Web MIDI: a fake MIDIAccess with pluggable output ports that record what they were sent.
export class FakeOutput {
  readonly sent: { bytes: number[]; time: number | undefined }[] = [];
  throwOnSend = false;
  constructor(readonly name: string) {}
  send(bytes: number[], time?: number): void {
    if (this.throwOnSend) throw new Error('port gone');
    this.sent.push({ bytes, time });
  }
}

export class FakeAccess {
  readonly outputs = new Map<string, FakeOutput>();
  onstatechange: (() => void) | null = null;

  plug(name: string): FakeOutput {
    const out = new FakeOutput(name);
    this.outputs.set(name, out);
    this.onstatechange?.();
    return out;
  }

  unplug(name: string): void {
    this.outputs.delete(name);
    this.onstatechange?.();
  }

  asAccess(): MIDIAccess {
    return this as unknown as MIDIAccess;
  }
}
