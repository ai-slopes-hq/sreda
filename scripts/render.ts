// `pnpm render <name> [seconds=8]`: a factory project through the WASM engine (`pnpm wasm` first) → <name>.wav.
import { writeFileSync } from 'node:fs';
import { FACTORY, SPECS } from '../packages/core/src/index';
import { renderDoc } from '../packages/protocol/src/render';

const [name, secs = '8'] = process.argv.slice(2);
const entry = FACTORY.find((e) => e.kind === 'project' && e.name === name);
if (!entry) {
  console.error(
    `usage: pnpm render <name> [seconds]; projects: ${FACTORY.filter((e) => e.kind === 'project')
      .map((e) => e.name)
      .join(', ')}`,
  );
  process.exit(1);
}
const rate = 48_000;
const { l, r } = renderDoc(entry.build(SPECS), SPECS, Number(secs), rate);
// 16-bit stereo PCM
const data = Buffer.alloc(l.length * 4);
for (let i = 0; i < l.length; i++) {
  data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, l[i]!)) * 32767), i * 4);
  data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, r[i]!)) * 32767), i * 4 + 2);
}
const head = Buffer.alloc(44);
head.write('RIFF', 0);
head.writeUInt32LE(36 + data.length, 4);
head.write('WAVE', 8);
head.write('fmt ', 12);
head.writeUInt32LE(16, 16);
head.writeUInt16LE(1, 20); // PCM
head.writeUInt16LE(2, 22);
head.writeUInt32LE(rate, 24);
head.writeUInt32LE(rate * 4, 28);
head.writeUInt16LE(4, 32);
head.writeUInt16LE(16, 34);
head.write('data', 36);
head.writeUInt32LE(data.length, 40);
writeFileSync(`${name}.wav`, Buffer.concat([head, data]));
console.log(`${name}.wav: ${secs} s at ${rate} Hz`);
