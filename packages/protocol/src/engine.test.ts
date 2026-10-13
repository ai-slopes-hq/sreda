import {
  compile,
  emptyDoc,
  addModule,
  connect,
  frameSelection,
  setParam,
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

test('the starter patch renders a 110 Hz saw at 48 and 44.1 kHz', () => {
  const at44 = renderDoc(starterDoc(SPECS), SPECS, 0.5, 44_100).l;
  expect(meanPeriod(at44, 4410)).toBeCloseTo(44_100 / 110, 0);
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

test('a mute message silences a framed OUT in about 50 ms; a fade-in ramps the speakers', () => {
  const e = loadEngine(wasm, 48_000, 1);
  const framed = frameSelection(starterDoc(SPECS), SPECS, ['m1', 'm2']).doc;
  expect(e.apply(compile(framed, SPECS, 1))).toBe(0);
  const peak = (s: Float32Array) => s.reduce((a, x) => Math.max(a, Math.abs(x)), 0);
  expect(peak(play(e, 40))).toBeGreaterThan(0.1);
  e.mute(0, true);
  play(e, 20);
  expect(peak(play(e, 20))).toBeLessThan(0.001);
  e.mute(0, false);
  e.fadeIn(200);
  const back = play(e, 100);
  expect(peak(back.subarray(0, 128))).toBeLessThan(0.05);
  expect(peak(back.subarray(back.length - 1280))).toBeGreaterThan(0.1);
});

test('a sample into the pool, then auditioned: it plays in place of the mix and stops by itself', () => {
  const e = loadEngine(wasm, 48_000, 1);
  e.apply(compile(starterDoc(SPECS), SPECS, 1));
  const n = 10 * 128;
  const tone = Float32Array.from({ length: n }, (_, i) => 0.3 * Math.sin(i * 0.05));
  e.sample(4, [tone], new Uint32Array([0]), new Float32Array([1]));
  play(e, 4);
  e.audition(4);
  const heard = play(e, 30);
  // the saw's 110 Hz is replaced by the tone (period 2π / 0.05 ≈ 126 samples)
  expect(meanPeriod(heard.subarray(128, 8 * 128), 0)).toBeCloseTo((2 * Math.PI) / 0.05, -1);
  // then the starter's saw again
  expect(meanPeriod(heard, 14 * 128)).toBeCloseTo(48_000 / 110, -1);
});

test('master(0) silences the starter patch', () => {
  const e = loadEngine(wasm, 48_000, 1);
  e.apply(compile(starterDoc(SPECS), SPECS, 1));
  play(e, 20);
  e.master(0);
  play(e, 100); // the glide, then the DC blocker's tail
  expect(play(e, 20).reduce((a, x) => Math.max(a, Math.abs(x)), 0)).toBeLessThan(1e-3);
});

test('events() is an empty view of the outbox when no module pushes; nothing is dropped', () => {
  const e = loadEngine(wasm, 48_000, 1);
  e.apply(compile(starterDoc(SPECS), SPECS, 1));
  play(e, 4);
  expect(e.events()).toBeInstanceOf(Uint32Array);
  expect(e.eventsLen()).toBe(0);
  expect(e.eventsDropped()).toBe(0);
});

test('events() reports A4 notes', () => {
  // a square OSC (110 Hz) is the gate
  let doc = setParam(addModule(emptyDoc, SPECS, 'osc', 0, 0).doc, SPECS, 'm1', 'wave', 3);
  const a4 = addModule(doc, SPECS, 'a4', 400, 0);
  doc = connect(a4.doc, SPECS, ['m1', 'out'], [a4.id, 'gate']);
  const plan = compile(doc, SPECS, 1);
  const node = plan.nodes.findIndex((n) => n.type === 'a4');
  const e = loadEngine(wasm, 48_000, 1);
  expect(e.apply(plan)).toBe(0);
  const seen: number[][] = [];
  const first = e.events();
  const lens = new Set<number>();
  // the outbox is cleared every block, so collect after each one
  for (let b = 0; b < 400; b++) {
    e.process();
    const ev = e.events();
    // one fixed-capacity view for every block, whatever the event count: nothing is rebuilt
    expect(ev).toBe(first);
    lens.add(e.eventsLen());
    for (let i = 0; i < e.eventsLen(); i += 2)
      seen.push([ev[i]! >>> 16, ev[i + 1]! & 0xff, (ev[i + 1]! >> 8) & 0xff, ev[i + 1]! >>> 16]);
  }
  expect(lens.size).toBeGreaterThan(1);
  const on = seen.findIndex((x) => x[1] === 0x90);
  expect(on).toBeGreaterThanOrEqual(0);
  expect(seen[on]).toEqual([node, 0x90, 48, 100]);
  expect(seen.slice(on).some((x) => x[0] === node && x[1] === 0x80 && x[2] === 48)).toBe(true);
});
