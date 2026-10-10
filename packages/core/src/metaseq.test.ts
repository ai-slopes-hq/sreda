import { expect, test } from 'vitest';
import {
  copyPattern,
  diceLanes,
  laneLen,
  laneParam,
  laneLocked,
  laneRate,
  laneSteps,
  LANES,
  noteMode,
  noteModeParam,
  PATTERNS,
  pastePattern,
  seqTrace,
  snap,
  snapInRange,
  stepId,
  writeLane,
} from './metaseq';
import { mulberry32, SCALES, type Algo } from './generators';

test('step ids: pattern letter, lane, 1-based step', () => {
  expect(PATTERNS).toBe(8);
  expect(LANES).toEqual(['n', 'g', 't', 'a', 'v', 'c']);
  expect(stepId(0, 'g', 1)).toBe('ag1');
  expect(stepId(7, 'c', 16)).toBe('hc16');
});

test('an empty param set reads as the defaults: four on the floor in A', () => {
  expect(laneSteps({}, 0, 'g').join('')).toBe('1000100010001000');
  expect(laneSteps({}, 1, 'g').join('')).toBe('0'.repeat(16));
  expect(laneSteps({}, 0, 'n')).toEqual(Array(16).fill(12));
  expect(laneSteps({}, 0, 'v')).toEqual(Array(16).fill(1));
  expect(laneLen({}, 0, 'n')).toBe(16);
  expect(laneRate({}, 0, 'n')).toBe(3);
  expect(laneLocked({}, 0, 'n')).toBe(false);
  expect(noteMode({}, 0)).toBe(0);
});

test('writeLane stores knob positions and round-trips laneSteps', () => {
  const notes = [0, 3, 7, 12, 15, 19, 24, 12, 5, 2, 9, 10, 11, 1, 4, 6];
  const w = writeLane(2, 'n', notes);
  expect(w['cn1']).toBe(0);
  expect(w['cn7']).toBe(1);
  expect(laneSteps(w, 2, 'n')).toEqual(notes);
  const g = Array.from({ length: 16 }, (_, i) => i % 2);
  expect(laneSteps(writeLane(0, 'g', g), 0, 'g')).toEqual(g);
  const v = Array.from({ length: 16 }, (_, i) => i / 15);
  const back = laneSteps(writeLane(0, 'v', v), 0, 'v');
  back.forEach((x, i) => expect(x).toBeCloseTo(v[i]!));
});

test('lane settings read from knob positions and option indices', () => {
  const p = { bnlen: 6 / 15, bnrate: 5, bnlock: 1, bnmode: 1 };
  expect(laneLen(p, 1, 'n')).toBe(7);
  expect(laneRate(p, 1, 'n')).toBe(5);
  expect(laneLocked(p, 1, 'n')).toBe(true);
  expect(noteMode(p, 1)).toBe(1);
  expect(noteMode(p, 0)).toBe(0);
});

test('seqTrace decodes pattern, cursors, generation and the live steps at an offset', () => {
  const t = new Float32Array(120);
  const at = 5;
  t[at] = 3;
  [0, 4, -1, 2, 1, 9].forEach((c, i) => (t[at + 1 + i] = c));
  t[at + 7] = 11;
  for (let l = 0; l < 6; l++) for (let k = 0; k < 16; k++) t[at + 8 + l * 16 + k] = l * 100 + k;
  const r = seqTrace(t, at);
  expect(r.pattern).toBe(3);
  expect(r.cursors).toEqual([0, 4, -1, 2, 1, 9]);
  expect(r.gen).toBe(11);
  expect(r.live).toHaveLength(6);
  expect(r.live[2]![3]).toBe(203);
});

test('laneParam names a lane setting', () => {
  expect(laneParam(0, 'n', 'len')).toBe('anlen');
  expect(laneParam(7, 'c', 'rate')).toBe('hcrate');
  expect(laneParam(2, 'g', 'lock')).toBe('cglock');
});

test('snap: the nearest pitch in the scale from the root, the lower on a tie (as the engine)', () => {
  // the same values as engine/src/modules/metaseq.rs `trns_snaps_to_the_scale`
  expect(snap(14, 2, 0)).toBe(14);
  expect(snap(13, 2, 0)).toBe(12);
  expect(snap(16, 2, 0)).toBe(15);
  expect(snap(14, 5, 0)).toBe(15);
  expect(snap(-1, 2, 0)).toBe(-2);
  expect(snap(13, 1, 1)).toBe(13);
});

test('snapInRange keeps a drawn note within 0…24 and in the scale', () => {
  // D major: 0 (C) ties between B (−1) and C♯ (1); the lane holds 0…24, so C♯
  expect(snap(0, 1, 2)).toBe(-1);
  expect(snapInRange(0, 1, 2)).toBe(1);
  expect(snapInRange(24, 1, 2)).toBe(23);
  expect(snapInRange(13, 2, 0)).toBe(12);
});

test("noteModeParam names a pattern's STEP / PLAYED param", () => {
  expect(noteModeParam(0)).toBe('anmode');
  expect(noteMode({ cnmode: 1 }, 2)).toBe(1);
});

test('pastePattern(copyPattern(p, 0), 3) sets every d… id to the a… values', () => {
  const p: Record<string, number> = {
    an3: 0.5,
    ag2: 1,
    at4: 1,
    av7: 0.25,
    anlen: 0.4,
    agrate: 5,
    aclock: 0,
    atlock: 1,
    anmode: 1,
  };
  const out = pastePattern(copyPattern(p, 0), 3);
  expect(Object.keys(out).length).toBe(6 * 19 + 1);
  const merged = { ...p, ...out };
  for (const l of LANES) {
    expect(laneSteps(merged, 3, l)).toEqual(laneSteps(p, 0, l));
    expect(laneLen(merged, 3, l)).toBe(laneLen(p, 0, l));
    expect(laneRate(merged, 3, l)).toBe(laneRate(p, 0, l));
    expect(laneLocked(merged, 3, l)).toBe(laneLocked(p, 0, l));
  }
  expect(noteMode(merged, 3)).toBe(1);
  expect(out['dn3']).toBe(0.5);
  expect(out['dtlock']).toBe(1);
  expect(out['dg1']).toBe(1); // pattern A's default gate on step 1, captured explicitly
});

test('pasting a default pattern over a drawn one resets it', () => {
  const drawn: Record<string, number> = { bn1: 0.9, bg3: 1, bnlen: 0.1, bnmode: 1 };
  const reset = pastePattern(copyPattern({}, 1), 1);
  const merged = { ...drawn, ...reset };
  expect(laneSteps(merged, 1, 'n')[0]).toBe(12);
  expect(laneSteps(merged, 1, 'g')[2]).toBe(0);
  expect(laneLen(merged, 1, 'n')).toBe(16);
  expect(noteMode(merged, 1)).toBe(0);
});

const ALGOS: Algo[] = ['303', 'MOTIF', 'WALK', 'TURING', 'ARP', 'PHRASE', 'PEDAL', 'EUCLID'];

test('DICE: every style writes notes in the scale from the root, ACC only on GATE, TIE only after a hit', () => {
  for (const algo of ALGOS)
    for (let seed = 1; seed <= 30; seed++) {
      const out = diceLanes({}, 2, algo, 3, 5, mulberry32(seed));
      const m = { ...out };
      const n = laneSteps(m, 2, 'n');
      const g = laneSteps(m, 2, 'g');
      const t = laneSteps(m, 2, 't');
      const a = laneSteps(m, 2, 'a');
      const v = laneSteps(m, 2, 'v');
      const why = `${algo} seed ${seed}`;
      expect(Object.keys(out).length, why).toBe(6 * 16);
      for (const s of n) expect(SCALES[3]!.includes((((s - 5) % 12) + 12) % 12), `${why}: ${s}`).toBe(true);
      expect(
        g.some((x) => x === 1),
        why,
      ).toBe(true);
      for (let k = 0; k < 16; k++) {
        if (a[k] === 1) expect(g[k], `${why} acc ${k}`).toBe(1);
        if (t[k] === 1) expect(k > 0 && g[k - 1] === 1, `${why} tie ${k}`).toBe(true);
        if (g[k] === 1) expect(v[k]! >= 0.6 && v[k]! <= 1, why).toBe(true);
      }
      expect(laneSteps(m, 2, 'c')).toEqual(Array(16).fill(1));
      if (algo === 'EUCLID')
        expect(
          t.every((x) => x === 0),
          why,
        ).toBe(true);
    }
});

test('DICE: 303 slides (TIE on a hit after a hit) and long notes (TIE on a rest after a hit) appear', () => {
  let slides = 0;
  let holds = 0;
  for (let seed = 1; seed <= 40; seed++) {
    const m = diceLanes({}, 0, '303', 2, 0, mulberry32(seed));
    const g = laneSteps(m, 0, 'g');
    const t = laneSteps(m, 0, 't');
    for (let k = 1; k < 16; k++)
      if (t[k]) {
        if (g[k]) slides++;
        else holds++;
      }
  }
  expect(slides).toBeGreaterThan(0);
  expect(holds).toBeGreaterThan(0);
});

test('DICE leaves locked lanes, LEN, RATE and other patterns alone; only the first LEN steps are written', () => {
  const params: Record<string, number> = {
    [laneParam(1, 'g', 'lock')]: 1,
    [laneParam(1, 'n', 'len')]: 6 / 15, // LEN 7
    [laneParam(1, 'v', 'rate')]: 5,
    [stepId(1, 'n', 9)]: 0.75,
  };
  const out = diceLanes(params, 1, 'WALK', 2, 0, mulberry32(9));
  for (const k of Object.keys(out)) {
    expect(k.startsWith('b'), k).toBe(true);
    expect(k.endsWith('len') || k.endsWith('rate') || k.endsWith('lock'), k).toBe(false);
    expect(k.startsWith('bg'), k).toBe(false);
  }
  expect(Object.keys(out).filter((k) => k.startsWith('bn')).length).toBe(7);
  expect(out[stepId(1, 'n', 9)]).toBeUndefined();
  expect(out[stepId(1, 't', 1)]).toBeDefined();
});

test('⚄ writes the one lane, even locked, consistent with the GATE drawn', () => {
  const gate = [1, 0, 0, 1, 0, 0, 1, 0, 1, 0, 1, 0, 0, 1, 0, 0];
  const params: Record<string, number> = {
    ...writeLane(0, 'g', gate),
    [laneParam(0, 'a', 'lock')]: 1,
    [laneParam(0, 't', 'lock')]: 1,
  };
  for (let seed = 1; seed <= 20; seed++) {
    const acc = diceLanes(params, 0, '303', 2, 0, mulberry32(seed), 'a');
    expect(
      Object.keys(acc).every((k) => k.startsWith('aa')),
      `seed ${seed}`,
    ).toBe(true);
    expect(Object.keys(acc).length).toBe(16);
    laneSteps(acc, 0, 'a').forEach((x, k) => x && expect(gate[k], `seed ${seed} step ${k}`).toBe(1));
    const tie = diceLanes(params, 0, '303', 2, 0, mulberry32(seed), 't');
    expect(Object.keys(tie).every((k) => k.startsWith('at'))).toBe(true);
    laneSteps(tie, 0, 't').forEach((x, k) => x && expect(k > 0 && gate[k - 1] === 1).toBe(true));
  }
  expect(diceLanes(params, 0, '303', 2, 0, mulberry32(1))[stepId(0, 'a', 1)]).toBeUndefined();
});

test('DICE is seed-stable', () => {
  for (const algo of ALGOS)
    expect(diceLanes({}, 0, algo, 1, 3, mulberry32(77))).toEqual(
      diceLanes({}, 0, algo, 1, 3, mulberry32(77)),
    );
  expect(diceLanes({}, 0, '303', 1, 3, mulberry32(1))).not.toEqual(
    diceLanes({}, 0, '303', 1, 3, mulberry32(2)),
  );
});
