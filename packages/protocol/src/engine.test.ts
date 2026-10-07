import {
  compile,
  emptyDoc,
  addModule,
  connect,
  SPECS,
  starterDoc,
  toKnob,
  type KnobParam,
  type Plan,
} from '@sreda/core';
import { expect, test } from 'vitest';
import { loadEngine, type WasmEngine } from './engine';
import { loadWasm, renderDoc } from './render';

const wasm = loadWasm();

function rising(s: Float32Array, from = 0): number[] {
  const c: number[] = [];
  for (let i = Math.max(1, from); i < s.length; i++) if (s[i - 1]! < 0 && s[i]! >= 0) c.push(i);
  return c;
}
function meanPeriod(s: Float32Array, from: number): number {
  const c = rising(s, from);
  return (c[c.length - 1]! - c[0]!) / (c.length - 1);
}
function play(e: WasmEngine, blocks: number): Float32Array {
  const out = new Float32Array(blocks * 128);
  for (let b = 0; b < blocks; b++) out.set(e.process().l, b * 128);
  return out;
}

test('the starter patch renders a 110 Hz saw', () => {
  const { l } = renderDoc(starterDoc(SPECS), SPECS, 0.5);
  expect(meanPeriod(l, 4800)).toBeCloseTo(48_000 / 110, 0);
  expect(l.reduce((a, x) => Math.max(a, Math.abs(x)), 0)).toBeGreaterThan(0.5);
});

test('a knob message changes the pitch without a new plan', () => {
  const e = loadEngine(wasm, 48_000, 1);
  expect(e.apply(compile(starterDoc(SPECS), SPECS, 1))).toBe(0);
  play(e, 40);
  const freq = SPECS['osc']!.params.find((p) => p.id === 'freq') as KnobParam;
  e.knob(0, 0, toKnob(freq, 220));
  expect(meanPeriod(play(e, 100), 1000)).toBeCloseTo(48_000 / 220, 0);
});

test('a broken plan is refused with a code and the old one keeps sounding', () => {
  const e = loadEngine(wasm, 48_000, 1);
  const good = compile(starterDoc(SPECS), SPECS, 1);
  e.apply(good);
  play(e, 20);
  const unknown = structuredClone(good) as Plan;
  unknown.nodes[0]!.type = 'nope';
  expect(e.apply(unknown)).toBe(2);
  expect(e.applyJson(JSON.stringify(good).slice(0, 100))).toBe(1);
  const after = play(e, 20);
  expect(after.reduce((a, x) => Math.max(a, Math.abs(x)), 0)).toBeGreaterThan(0.5);
});

test('readouts follow the plan layout; listen sends one output to the speakers', () => {
  let doc = addModule(emptyDoc, SPECS, 'osc', 0, 0).doc;
  doc = addModule(doc, SPECS, 'out', 400, 0).doc;
  doc = connect(doc, SPECS, ['m1', 'out'], ['m2', 'l']);
  const plan = compile(doc, SPECS, 5);
  const e = loadEngine(wasm, 48_000, 1);
  e.apply(plan);
  play(e, 4);
  const r = e.readouts();
  expect(r.length).toBe(plan.layout.size);
  expect(r[0]).toBe(5);
  expect(r[plan.layout.nodes[0]!.outs]).toBeGreaterThan(0.5);
  e.knob(1, 0, 0); // OUT level 0
  play(e, 400);
  expect(Math.max(...play(e, 10).map(Math.abs))).toBeLessThan(1e-3);
  e.listen({ node: 0, port: 0 });
  expect(Math.max(...play(e, 10).map(Math.abs))).toBeGreaterThan(0.5);
});

test('process returns the same views every block (no allocation in the worklet)', () => {
  const e = loadEngine(wasm, 48_000, 1);
  e.apply(compile(starterDoc(SPECS), SPECS, 1));
  const a = e.process();
  expect(e.process()).toBe(a);
});
