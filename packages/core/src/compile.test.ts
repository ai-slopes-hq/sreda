import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';
import { bigPatch } from './bigpatch';
import { clockNode, compile } from './compile';
import { editFrame, frameSelection, unframe } from './frames';
import { TRACE_LEN } from './plan';
import { emptyDoc, starterDoc, type Doc } from './doc';
import {
  addModule,
  connect,
  deleteObjects,
  moveObjects,
  removeCable,
  setAtt,
  setParam,
  setRatio,
} from './ops';
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
    frames: compile(nestedFrames(), SPECS, 7),
    '200': compile(bigPatch(SPECS), SPECS, 8),
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
  // the parent's clock has run already this sample: read as it is, not one sample late
  expect(plan.nodes[ci]!.inputs[0]).toMatchObject({ normal: { node: pi, port: 0, late: false }, ratio: -2 });
  const at = (n: number) => plan.steps.findIndex((s) => 'node' in s && s.node === n);
  expect(at(pi)).toBeLessThan(at(ci));
  // removing the parent takes the normal with it
  const alone = unframe(doc, S, [outer.id]);
  expect(compile(alone, S, 1).nodes[clockNode(alone, inner.id)]!.inputs[0]!.normal).toBeNull();
});

/** OSC → (cable) → OUT with the OSC in frame G1 and the OUT outside; a second OUT inside G1 */
function framedVoice() {
  let { doc, ids } = build(SPECS, ['osc', 'out', 'out']);
  doc = moveObjects(doc, SPECS, [ids[1]!], 2000, 0);
  doc = connect(doc, SPECS, [ids[0]!, 'out'], [ids[1]!, 'l']);
  doc = connect(doc, SPECS, [ids[0]!, 'out'], [ids[1]!, 'r']);
  doc = connect(doc, SPECS, [ids[0]!, 'out'], [ids[2]!, 'l']);
  const g1 = frameSelection(doc, SPECS, [ids[0]!, ids[2]!]);
  return { doc: g1.doc, ids, g1: g1.id };
}

test('a cable leaving a frame is gated by it; one inside is not; an OUT inside is gated by its frame', () => {
  const { doc, ids, g1 } = framedVoice();
  const plan = compile(doc, SPECS, 1);
  expect(plan.nodes[1]!.inputs[0]!.sources[0]!.gate).toBe(0);
  expect(plan.nodes[2]!.inputs[0]!.sources[0]!.gate).toBeUndefined();
  expect(plan.nodes[2]!.gate).toBe(0);
  expect(plan.nodes[1]!.gate).toBeUndefined();
  expect(plan.frames).toEqual([{ id: g1, muted: false, sources: [{ node: 0, port: 0 }], outs: [2] }]);
  // one float per frame, after the nodes
  const last = Math.max(...plan.layout.nodes.map((n) => n.state));
  expect(plan.layout.frames).toBe(last + 1);
  expect(plan.layout.size).toBe(last + 2);
  expect(compile(editFrame(doc, g1, { muted: true }), SPECS, 2).frames[0]!.muted).toBe(true);
  void ids;
});

test('a cable leaving nested frames is gated by the innermost one it leaves; a muted parent mutes its children', () => {
  const { doc: d0, ids, g1 } = framedVoice();
  const g2 = frameSelection(d0, SPECS, [ids[0]!]);
  const plan = compile(editFrame(g2.doc, g1, { muted: true }), SPECS, 1);
  const k2 = g2.doc.groups.findIndex((g) => g.id === g2.id);
  expect(plan.nodes[1]!.inputs[0]!.sources[0]!.gate).toBe(k2);
  // the cable to the OUT inside G1 leaves G2 only
  expect(plan.nodes[2]!.inputs[0]!.sources[0]!.gate).toBe(k2);
  expect(plan.frames.map((f) => f.muted)).toEqual([true, true]);
});

/** frameVoice with the OSC in a second frame inside G1, both clocks on (the alloc fixture `plan-frames.json`) */
function nestedFrames(): Doc {
  const { doc, ids, g1 } = framedVoice();
  const g2 = frameSelection(doc, SPECS, [ids[0]!]);
  let d = editFrame(g2.doc, g1, { clock: { on: true, bpm: 140 } });
  d = editFrame(d, g2.id, { ratio: -2 });
  return connect(d, SPECS, [g2.id, 'clkOut'], [ids[0]!, 'sync']);
}

test('the 200-module patch validates, compiles, and compiles in under 10 ms', async () => {
  const { validateDoc } = await import('./doc');
  const doc = bigPatch(SPECS);
  expect(doc.modules).toHaveLength(200);
  expect(doc.groups).toHaveLength(20);
  expect(validateDoc(JSON.parse(JSON.stringify(doc)), SPECS)).toEqual(doc);
  const times: number[] = [];
  for (let i = 0; i < 6; i++) {
    const t = performance.now();
    compile(doc, SPECS, i);
    times.push(performance.now() - t);
  }
  times.shift(); // the first run warms up
  times.sort((a, b) => a - b);
  expect(times[2]).toBeLessThan(10);
});

/** a sampler-like type: a knob, an option, then the hidden `sample` slot */
const SAMPLING: Specs = {
  ...SPECS,
  smp: {
    type: 'smp',
    label: 'SMP',
    desc: '',
    size: [4, 1],
    inputs: [],
    outputs: [{ id: 'out', label: 'OUT', role: 'audio' }],
    params: [
      { kind: 'knob', id: 'gain', label: 'GAIN', min: 0, max: 1, def: 1, taper: 'lin' },
      { kind: 'option', id: 'mode', label: 'MODE', options: ['A', 'B'], def: 0 },
      {
        kind: 'knob',
        id: 'sample',
        label: 'SAMPLE',
        min: -1,
        max: 1e6,
        def: -1,
        taper: 'lin',
        step: 1,
        hidden: true,
      },
    ],
    normals: [],
  },
};

test("a module's sample goes into its fixed slot as the registry's id (−1 without one)", () => {
  const m = (id: string, sample?: string) => ({
    id,
    type: 'smp',
    x: 0,
    y: 0,
    parent: null,
    params: { gain: 1, mode: 1, sample: 0.5 },
    atts: {},
    ratios: {},
    ...(sample === undefined ? {} : { sample }),
  });
  const doc: Doc = { ...emptyDoc, modules: [m('m1', 'kick.wav'), m('m2')], nextId: 3 };
  const ids: Record<string, number> = { 'kick.wav': 7 };
  const plan = compile(doc, SAMPLING, 1, (p) => ids[p] ?? -1);
  expect(plan.nodes[0]!.fixed).toEqual([1, 7]);
  expect(plan.nodes[1]!.fixed).toEqual([1, -1]);
  expect(compile(doc, SAMPLING, 1).nodes[0]!.fixed).toEqual([1, -1]);
});
