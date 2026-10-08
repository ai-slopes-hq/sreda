import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';
import { clockNode, compile } from './compile';
import { editFrame, frameSelection, unframe } from './frames';
import { TRACE_LEN } from './plan';
import { emptyDoc, starterDoc, type Doc } from './doc';
import { addModule, connect, deleteObjects, removeCable, setAtt, setParam, setRatio } from './ops';
import { inputPorts, SPECS, type Specs } from './spec';
import { TEST_SPECS as S } from './testspecs';

function build(specs: Specs, types: string[]): { doc: Doc; ids: string[] } {
  let doc = emptyDoc;
  const ids: string[] = [];
  for (const t of types) {
    const r = addModule(doc, specs, t, 0, 0);
    doc = r.doc;
    ids.push(r.id);
  }
  return { doc, ids };
}

test('a chain runs in signal order, not document order', () => {
  const { doc: d0, ids } = build(S, ['sink', 'fx', 'src']);
  let doc = connect(d0, S, [ids[2]!, 'out'], [ids[1]!, 'in']);
  doc = connect(doc, S, [ids[1]!, 'out'], [ids[0]!, 'l']);
  expect(compile(doc, S, 1).steps).toEqual([{ node: 2 }, { node: 1 }, { node: 0 }]);
});

test('A → B → A is one loop with one late edge', () => {
  const { doc: d0, ids } = build(S, ['fx', 'fx']);
  let doc = connect(d0, S, [ids[0]!, 'out'], [ids[1]!, 'in']);
  doc = connect(doc, S, [ids[1]!, 'out'], [ids[0]!, 'in']);
  const plan = compile(doc, S, 1);
  expect(plan.steps).toEqual([{ loop: [0, 1] }]);
  expect(plan.nodes[0]!.inputs[0]!.sources).toEqual([{ node: 1, port: 0, late: true }]);
  expect(plan.nodes[1]!.inputs[0]!.sources).toEqual([{ node: 0, port: 0, late: false }]);
});

test('a self-patch is a loop with a late source', () => {
  const { doc: d0, ids } = build(S, ['fx']);
  const plan = compile(connect(d0, S, [ids[0]!, 'out'], [ids[0]!, 'in']), S, 1);
  expect(plan.steps).toEqual([{ loop: [0] }]);
  expect(plan.nodes[0]!.inputs[0]!.sources).toEqual([{ node: 0, port: 0, late: true }]);
});

test('two cables are two sources; kinds, attenuverters and ratios come through', () => {
  const { doc: d0, ids } = build(S, ['src', 'src', 'fx']);
  let doc = connect(d0, S, [ids[0]!, 'out'], [ids[2]!, 'in']);
  doc = connect(doc, S, [ids[1]!, 'out'], [ids[2]!, 'in']);
  doc = setAtt(setRatio(doc, ids[2]!, 'clk', 4), ids[2]!, 'cv', -0.5);
  const fx = compile(doc, S, 1).nodes[2]!;
  expect(fx.inputs[0]!.sources.map((s) => s.node)).toEqual([0, 1]);
  expect(fx.inputs.map((i) => i.kind)).toEqual(['sum', 'cv', 'trigger', 'cv']);
  expect(fx.inputs[1]!.att).toBe(-0.5);
  expect(fx.inputs[2]!.ratio).toBe(4);
  expect(fx.inputs[3]!.att).toBe(0.25); // the @amt mod jack defaults to the knob's modDepth
  expect(fx.knobs).toEqual([0.5]);
  expect(fx.fixed).toEqual([0, 2]); // CYC index, then the hidden knob in real units
  expect(fx.connectedOut).toEqual([false, false]);
});

test('normals: own only with its option on and the input free; value and internal while free', () => {
  const { doc: d0, ids } = build(S, ['fx', 'sink', 'src']);
  const off = compile(d0, S, 1).nodes[0]!;
  expect(off.inputs[2]!.normal).toBeNull();
  expect(off.inputs[1]!.normal).toEqual({ value: 1 });
  const on = setParam(d0, S, ids[0]!, 'cyc', 1);
  const plan = compile(on, S, 1);
  expect(plan.nodes[0]!.inputs[2]!.normal).toEqual({ node: 0, port: 1 });
  expect(plan.steps).toContainEqual({ loop: [0] });
  expect(plan.nodes[1]!.inputs[1]!.normal).toBe('internal');
  const patched = compile(connect(on, S, [ids[2]!, 'out'], [ids[0]!, 'cv']), S, 1).nodes[0]!;
  expect(patched.inputs[1]!.normal).toBeNull();
});

test('the readout layout is disjoint and starts after the seq and master slots', () => {
  const { doc } = build(S, ['fx', 'src', 'sink']);
  const { layout } = compile(doc, S, 7);
  const used: number[] = [];
  const counts = [
    { knobs: 1, trigs: 1, outs: 2 },
    { knobs: 1, trigs: 0, outs: 1 },
    { knobs: 1, trigs: 0, outs: 0 },
  ];
  layout.nodes.forEach((n, i) => {
    const c = counts[i]!;
    for (let j = 0; j < c.knobs; j++) used.push(n.knobs + j);
    for (let j = 0; j < c.trigs; j++) used.push(n.trigs + j);
    for (let j = 0; j < c.outs; j++) used.push(n.outs + j);
    used.push(n.state);
  });
  expect(new Set(used).size).toBe(used.length);
  expect(Math.min(...used)).toBe(2);
  expect(Math.max(...used)).toBeLessThan(layout.size);
});

// Plans for the Rust decoder test: UPDATE_FIXTURES=1 pnpm test -- compile
test('fixtures for the engine', () => {
  const starter = starterDoc(SPECS);
  const osc = starter.modules[0]!.id;
  const loop = connect(starter, SPECS, [osc, 'out'], [osc, 'fm']);
  // OSC → SCOPE A and TRIG, OSC → OUT; then OUT removed and the OSC re-routed from SCOPE A to B
  let scoped = addModule(starter, SPECS, 'scope', 0, 300).doc;
  scoped = connect(scoped, SPECS, [osc, 'out'], ['m3', 'a']);
  scoped = connect(scoped, SPECS, [osc, 'out'], ['m3', 'trig']);
  let rerouted = deleteObjects(scoped, ['m2']);
  rerouted = connect(
    removeCable(rerouted, { from: [osc, 'out'], to: ['m3', 'a'] }),
    SPECS,
    [osc, 'out'],
    ['m3', 'b'],
  );
  // every module type at once: a saw and a square clock feed every input of every module
  let all = addModule(addModule(emptyDoc, SPECS, 'osc', 0, 0).doc, SPECS, 'osc', 0, 200).doc;
  all = setParam(setParam(all, SPECS, 'm1', 'wave', 2), SPECS, 'm2', 'wave', 3);
  for (const type of Object.keys(SPECS).filter((t) => !SPECS[t]!.internal)) {
    const added = addModule(all, SPECS, type, 400, 0);
    all = added.doc;
    for (const port of inputPorts(SPECS[type]!))
      all = connect(
        all,
        SPECS,
        [
          port.id.startsWith('@') || SPECS[type]!.inputs.find((q) => q.id === port.id)?.role !== 'trigger'
            ? 'm1'
            : 'm2',
          'out',
        ],
        [added.id, port.id],
      );
  }
  const ids = (t: string) => all.modules.filter((m) => m.type === t).map((m) => m.id);
  const filter = ids('filter')[0]!;
  let allB = deleteObjects(all, ids('delay'));
  allB = connect(
    removeCable(allB, { from: ['m1', 'out'], to: [filter, 'in'] }),
    SPECS,
    [ids('noise')[0]!, 'white'],
    [filter, 'in'],
  );
  const plans = {
    starter: compile(starter, SPECS, 1),
    'all-a': compile(all, SPECS, 5),
    'all-b': compile(allB, SPECS, 6),
    'self-fm': compile(loop, SPECS, 2),
    'scope-a': compile(scoped, SPECS, 3),
    'scope-b': compile(rerouted, SPECS, 4),
  };
  expect(plans['self-fm'].steps).toEqual([{ loop: [0] }, { node: 1 }]);
  if (process.env['UPDATE_FIXTURES']) {
    const dir = fileURLToPath(new URL('../../../engine/tests/fixtures/', import.meta.url));
    mkdirSync(dir, { recursive: true });
    for (const [name, plan] of Object.entries(plans))
      writeFileSync(`${dir}plan-${name}.json`, JSON.stringify(plan, null, 2) + '\n');
  }
});

test('every node gets a state slot; a scope display gets a 1024-float trace', () => {
  const specs = { ...S, sc: { ...S['src']!, type: 'sc', display: { lanes: 4, kind: 'scope' } } };
  const { doc } = build(specs, ['src', 'sc', 'fx']);
  const { layout } = compile(doc, specs, 1);
  const used: number[] = [];
  layout.nodes.forEach((n) => {
    used.push(n.state);
    if (n.trace !== null) for (let i = 0; i < TRACE_LEN; i++) used.push(n.trace + i);
  });
  expect(layout.nodes.map((n) => n.trace === null)).toEqual([true, false, true]);
  expect(new Set(used).size).toBe(used.length);
  expect(Math.max(...used)).toBeLessThan(layout.size);
});

test('a frame compiles to a clock node after the modules; CLK OUT cables read it', () => {
  const { doc: d0, ids } = build(S, ['fx', 'fx']);
  const g = frameSelection(d0, S, [ids[0]!]);
  let doc = editFrame(g.doc, g.id, { clock: { on: true, bpm: 128 } });
  doc = connect(doc, S, [g.id, 'clkOut'], [ids[0]!, 'clk']);
  doc = connect(doc, S, [ids[1]!, 'eoc'], [g.id, 'clkIn']);
  const plan = compile(doc, S, 1);
  expect(clockNode(doc, g.id)).toBe(2);
  expect(plan.nodes[2]).toMatchObject({ id: g.id, type: 'clock', knobs: [], fixed: [1, 128] });
  expect(plan.nodes[2]!.inputs).toEqual([
    { sources: [{ node: 1, port: 1, late: false }], normal: null, kind: 'trigger', att: 1, ratio: 1 },
  ]);
  expect(plan.nodes[0]!.inputs[2]!.sources).toEqual([{ node: 2, port: 0, late: false }]);
  expect(plan.layout.nodes).toHaveLength(3);
  const l = plan.layout.nodes[2]!;
  expect([l.trigs - l.knobs, l.outs - l.trigs, l.state - l.outs]).toEqual([0, 1, 1]);
});

test("a nested frame's CLK IN is normalled to its parent's clock, at its ratio; the parent runs first", () => {
  const { doc: d0, ids } = build(S, ['fx']);
  const outer = frameSelection(d0, S, ids);
  const inner = frameSelection(outer.doc, S, ids);
  const doc = editFrame(inner.doc, inner.id, { ratio: -2 });
  // the inner frame comes after the outer one in doc.groups; put it first to check the order
  const flipped = { ...doc, groups: [...doc.groups].reverse() };
  const plan = compile(flipped, S, 1);
  const [pi, ci] = [clockNode(flipped, outer.id), clockNode(flipped, inner.id)];
  expect(plan.nodes[ci]!.inputs[0]).toMatchObject({ normal: { node: pi, port: 0 }, ratio: -2 });
  const at = (n: number) => plan.steps.findIndex((s) => 'node' in s && s.node === n);
  expect(at(pi)).toBeLessThan(at(ci));
  // removing the parent takes the normal with it
  const alone = unframe(doc, S, [outer.id]);
  expect(compile(alone, S, 1).nodes[clockNode(alone, inner.id)]!.inputs[0]!.normal).toBeNull();
});
