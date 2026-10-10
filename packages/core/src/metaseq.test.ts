import { expect, test } from 'vitest';
import { laneLen, laneLocked, laneRate, laneSteps, LANES, noteMode, PATTERNS, seqTrace, stepId, writeLane } from './metaseq';

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
