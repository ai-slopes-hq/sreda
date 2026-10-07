// Node only: load the built engine (`pnpm wasm`) and render a document offline (tests, scripts).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { compile, type Doc, type Specs } from '@sreda/core';
import { loadEngine } from './engine';

export function loadWasm(): WebAssembly.Module {
  const path = fileURLToPath(new URL('../../../engine/pkg/sreda_engine.wasm', import.meta.url));
  return new WebAssembly.Module(readFileSync(path));
}

export function renderDoc(
  doc: Doc,
  specs: Specs,
  seconds: number,
  sampleRate = 48_000,
): { l: Float32Array; r: Float32Array } {
  const engine = loadEngine(loadWasm(), sampleRate, 1);
  const code = engine.apply(compile(doc, specs, 1));
  if (code !== 0) throw new Error(`the engine refused the plan (${code})`);
  const blocks = Math.ceil((seconds * sampleRate) / 128);
  const l = new Float32Array(blocks * 128);
  const r = new Float32Array(blocks * 128);
  for (let b = 0; b < blocks; b++) {
    const out = engine.process();
    l.set(out.l, b * 128);
    r.set(out.r, b * 128);
  }
  return { l, r };
}
