// Voices for the factory presets (spec §6, revision 31): each builds its modules at (x, y) and tells what it sends
// out and which jacks want the clock (with a ratio), so a group is a voice in a frame with its own clock and a project
// is several voices, a mix and effects under one clock frame.
import type { Builder } from './build';

export interface Voice {
  ids: string[];
  /** the main output */
  out: [string, string];
  /** jacks that take the frame's CLK OUT, with their input ratio */
  clocks: [string, string, number][];
}

// option indices
const WAVE = { SIN: 0, TRI: 1, SAW: 2, SQR: 3 };
const LPG = { VCA: 0, LP: 1, BOTH: 2 };
const FILTER = { SVF: 0, LADDER: 1, DIODE: 2, SK: 3 };

/** a euclidean RHYTHM on 16 steps, clocked ×4 (sixteenths) */
function steps(S: Builder, x: number, y: number, hits: number, rot = 0): string {
  return S.add('rhythm', x, y, { mode: 0, length: 16, hits, rot });
}

export function kick(S: Builder, x: number, y: number, hits = 4): Voice {
  const rh = steps(S, x, y, hits);
  const os = S.add('osc', x + 300, y, { freq: 48, wave: WAVE.SIN });
  const pe = S.add('slope', x + 300, y + 160, { rise: 0.001, fall: 0.06 });
  const amp = S.add('lpg', x + 600, y, { decay: 0.35, mode: LPG.BOTH });
  const sat = S.add('drive', x + 600, y + 160, { gain: 6, model: 0, mix: 0.5 });
  S.wire(rh, 'gate', pe, 'trig');
  S.wire(pe, 'out', os, '@freq');
  S.att(os, '@freq', 0.25);
  S.wire(os, 'out', amp, 'in');
  S.wire(rh, 'gate', amp, 'ping');
  S.wire(amp, 'out', sat, 'in');
  return { ids: [rh, os, pe, amp, sat], out: [sat, 'out'], clocks: [[rh, 'clk', 4]] };
}

export function snare(S: Builder, x: number, y: number): Voice {
  const rh = steps(S, x, y, 2, 4);
  const tone = S.add('osc', x + 300, y, { freq: 190, wave: WAVE.TRI });
  const tl = S.add('lpg', x + 600, y, { decay: 0.12, mode: LPG.BOTH });
  const nz = S.add('noise', x + 300, y + 160, { level: 0.8 });
  const bp = S.add('filter', x + 600, y + 160, { cutoff: 1800, res: 0.3, model: FILTER.SVF });
  const nl = S.add('lpg', x + 900, y + 160, { decay: 0.18, mode: LPG.BOTH });
  const mx = S.add('mix', x + 900, y, { la: 0.6, lb: 0.9 });
  S.wire(tone, 'out', tl, 'in');
  S.wire(rh, 'gate', tl, 'ping');
  S.wire(nz, 'white', bp, 'in');
  S.wire(bp, 'bp', nl, 'in');
  S.wire(rh, 'gate', nl, 'ping');
  S.wire(tl, 'out', mx, 'a');
  S.wire(nl, 'out', mx, 'b');
  return { ids: [rh, tone, tl, nz, bp, nl, mx], out: [mx, 'out'], clocks: [[rh, 'clk', 4]] };
}

export function hats(S: Builder, x: number, y: number): Voice {
  const closed = steps(S, x, y, 11, 1);
  const open = steps(S, x, y + 220, 2, 2);
  const nz = S.add('noise', x + 300, y, { level: 0.7 });
  const hp = S.add('filter', x + 600, y, { cutoff: 7000, res: 0.2, model: FILTER.SVF });
  const cl = S.add('lpg', x + 900, y, { decay: 0.04, mode: LPG.BOTH });
  const op = S.add('lpg', x + 900, y + 220, { decay: 0.25, mode: LPG.BOTH });
  const mx = S.add('mix', x + 1200, y, { la: 0.8, lb: 0.6 });
  S.wire(nz, 'white', hp, 'in');
  S.wire(hp, 'hp', cl, 'in');
  S.wire(hp, 'hp', op, 'in');
  S.wire(closed, 'gate', cl, 'ping');
  S.wire(open, 'gate', op, 'ping');
  S.wire(cl, 'out', mx, 'a');
  S.wire(op, 'out', mx, 'b');
  return {
    ids: [closed, open, nz, hp, cl, op, mx],
    out: [mx, 'out'],
    clocks: [
      [closed, 'clk', 4],
      [open, 'clk', 4],
    ],
  };
}

export function clap(S: Builder, x: number, y: number): Voice {
  const rh = steps(S, x, y, 2, 4);
  const nz = S.add('noise', x + 300, y, { level: 1 });
  const bp = S.add('filter', x + 600, y, { cutoff: 900, res: 0.3, model: FILTER.SVF });
  const amp = S.add('lpg', x + 900, y, { decay: 0.3, mode: LPG.VCA });
  // the clap's several hands: a short digital delay
  const dl = S.add('delay', x + 1200, y, { time: 0.012, feedback: 0.5, mix: 0.5, type: 0 });
  // the crack: a soft DRIVE
  const sat = S.add('drive', x + 1500, y, { gain: 10, model: 0 });
  S.wire(nz, 'white', bp, 'in');
  S.wire(bp, 'hp', amp, 'in');
  S.wire(rh, 'gate', amp, 'ping');
  S.wire(amp, 'out', dl, 'in');
  S.wire(dl, 'l', sat, 'in');
  return { ids: [rh, nz, bp, amp, dl, sat], out: [sat, 'out'], clocks: [[rh, 'clk', 4]] };
}

export function technoDrums(S: Builder, x: number, y: number): Voice {
  const k = kick(S, x, y);
  const h = hats(S, x, y + 400);
  // a folded, distorted percussion
  const pr = steps(S, x, y + 880, 5, 3);
  const nz = S.add('noise', x + 300, y + 880, { level: 0.7 });
  const fo = S.add('fold', x + 600, y + 880, { fold: 6, model: 1 });
  const pl = S.add('lpg', x + 900, y + 880, { decay: 0.08, mode: LPG.BOTH });
  S.wire(nz, 'pink', fo, 'in');
  S.wire(fo, 'out', pl, 'in');
  S.wire(pr, 'gate', pl, 'ping');
  const mx = S.add('mix', x + 1500, y, { la: 0.9, lb: 0.5, lc: 0.4 });
  const dist = S.add('drive', x + 1800, y, { gain: 12, model: 3, mix: 0.6, tone: 0.45 });
  S.wire(k.out[0], k.out[1], mx, 'a');
  S.wire(h.out[0], h.out[1], mx, 'b');
  S.wire(pl, 'out', mx, 'c');
  S.wire(mx, 'out', dist, 'in');
  return {
    ids: [...k.ids, ...h.ids, pr, nz, fo, pl, mx, dist],
    out: [dist, 'out'],
    clocks: [...k.clocks, ...h.clocks, [pr, 'clk', 4]],
  };
}

/** STAGES with a fixed line (semitones 0…24 over the scale's root), advanced by a RHYTHM */
function sequence(
  S: Builder,
  x: number,
  y: number,
  semis: number[],
  scale: number,
  hits: number,
  slides: number[] = [],
): {
  rh: string;
  st: string;
} {
  const rh = steps(S, x, y, hits, 0);
  const st = S.add('stages', x + 300, y, S.notes({ scale, length: semis.length }, semis, slides));
  S.wire(rh, 'gate', st, 'adv');
  return { rh, st };
}

export function fmBass(S: Builder, x: number, y: number): Voice {
  const { rh, st } = sequence(S, x, y, [0, 0, 12, 0, 3, 0, 7, 5], 2, 7);
  const cx = S.add('complex', x, y + 400, { freq: 55, ratio: 1, index: 0.15 });
  const env = S.add('slope', x + 300, y + 400, { rise: 0.002, fall: 0.2 });
  const amp = S.add('lpg', x + 600, y + 400, { decay: 0.3, mode: LPG.BOTH });
  S.wire(st, 'cv', cx, 'pitch');
  S.wire(rh, 'gate', env, 'trig');
  S.wire(env, 'out', cx, '@index');
  S.att(cx, '@index', 0.4);
  S.wire(cx, 'out', amp, 'in');
  S.wire(rh, 'gate', amp, 'ping');
  return { ids: [rh, st, cx, env, amp], out: [amp, 'out'], clocks: [[rh, 'clk', 4]] };
}

export function reese(S: Builder, x: number, y: number): Voice {
  const { rh, st } = sequence(S, x, y, [0, 0, 3, 3, 5, 5, 7, 2], 2, 4);
  const a = S.add('osc', x, y + 400, { freq: 55, wave: WAVE.SAW });
  const b = S.add('osc', x, y + 560, { freq: 55.6, wave: WAVE.SAW });
  const mx = S.add('mix', x + 300, y + 400, { la: 0.3, lb: 0.3 });
  const fl = S.add('filter', x + 600, y + 400, { cutoff: 380, res: 0.35, model: FILTER.LADDER });
  const sw = S.add('slope', x + 600, y + 560, { rise: 2, fall: 3, cycle: 1 });
  S.wire(st, 'cv', a, 'pitch');
  S.wire(st, 'cv', b, 'pitch');
  S.wire(a, 'out', mx, 'a');
  S.wire(b, 'out', mx, 'b');
  S.wire(mx, 'out', fl, 'in');
  S.wire(sw, 'out', fl, '@cutoff');
  S.att(fl, '@cutoff', 0.25);
  return { ids: [rh, st, a, b, mx, fl, sw], out: [fl, 'lp'], clocks: [[rh, 'clk', 2]] };
}

export function pluck(S: Builder, x: number, y: number): Voice {
  const { rh, st } = sequence(S, x, y, [12, 14, 16, 19, 21, 19, 16, 14], 6, 5);
  const os = S.add('osc', x, y + 400, { freq: 220, wave: WAVE.SAW });
  const amp = S.add('lpg', x + 300, y + 400, { decay: 0.25, mode: LPG.LP });
  S.wire(st, 'cv', os, 'pitch');
  S.wire(os, 'out', amp, 'in');
  S.wire(rh, 'gate', amp, 'ping');
  return { ids: [rh, st, os, amp], out: [amp, 'out'], clocks: [[rh, 'clk', 4]] };
}

export function chaoticBells(S: Builder, x: number, y: number): Voice {
  const ch = S.add('chance', x, y, { p: 0.45 });
  const un = S.add('uncertainty', x + 300, y, { levels: 8 });
  const q = S.add('quant', x + 600, y, { scale: 6 });
  const a = S.add('osc', x, y + 200, { freq: 880, wave: WAVE.SIN });
  const al = S.add('lpg', x + 300, y + 200, { decay: 2.2, mode: LPG.BOTH });
  const b = S.add('osc', x, y + 360, { freq: 1320, wave: WAVE.TRI });
  const bl = S.add('lpg', x + 300, y + 360, { decay: 1.4, mode: LPG.BOTH });
  const mx = S.add('mix', x + 600, y + 200, { la: 0.6, lb: 0.4 });
  const rv = S.add('reverb', x + 900, y + 200, { type: 1, size: 0.8, decay: 8, mix: 0.5 });
  S.wire(ch, 'a', un, 'trig');
  S.wire(ch, 'a', al, 'ping');
  S.wire(ch, 'b', bl, 'ping');
  S.wire(un, 'quant', q, 'in');
  S.wire(q, 'out', a, 'pitch');
  S.wire(q, 'out', b, 'pitch');
  S.wire(a, 'out', al, 'in');
  S.wire(b, 'out', bl, 'in');
  S.wire(al, 'out', mx, 'a');
  S.wire(bl, 'out', mx, 'b');
  S.wire(mx, 'out', rv, 'in');
  return { ids: [ch, un, q, a, al, b, bl, mx, rv], out: [rv, 'l'], clocks: [[ch, 'trig', 4]] };
}

export function pad(S: Builder, x: number, y: number): Voice {
  const st = S.add('stages', x, y, S.notes({ scale: 2, length: 4 }, [0, 3, 7, 5], [2, 4]));
  const a = S.add('osc', x, y + 400, { freq: 110, wave: WAVE.SAW });
  const b = S.add('osc', x, y + 560, { freq: 110.7, wave: WAVE.TRI });
  const mx = S.add('mix', x + 300, y + 400, { la: 0.5, lb: 0.6 });
  const fl = S.add('filter', x + 600, y + 400, { cutoff: 900, res: 0.2, model: FILTER.SVF });
  const sw = S.add('slope', x + 600, y + 560, { rise: 5, fall: 7, cycle: 1 });
  const env = S.add('slope', x + 900, y + 560, { rise: 1.5, fall: 3 });
  const amp = S.add('lpg', x + 900, y + 400, { level: 0, mode: LPG.VCA });
  const rv = S.add('reverb', x + 1200, y + 400, { type: 2, size: 0.85, decay: 10, mix: 0.45 });
  S.wire(st, 'cv', a, 'pitch');
  S.wire(st, 'cv', b, 'pitch');
  S.wire(a, 'out', mx, 'a');
  S.wire(b, 'out', mx, 'b');
  S.wire(mx, 'out', fl, 'in');
  S.wire(sw, 'out', fl, '@cutoff');
  S.att(fl, '@cutoff', 0.3);
  S.wire(fl, 'lp', amp, 'in');
  S.wire(env, 'out', amp, '@level');
  S.wire(amp, 'out', rv, 'in');
  return {
    ids: [st, a, b, mx, fl, sw, env, amp, rv],
    out: [rv, 'l'],
    clocks: [
      [st, 'adv', 1],
      [env, 'trig', 1],
    ],
  };
}

export function drone(S: Builder, x: number, y: number): Voice {
  const cx = S.add('complex', x, y, { freq: 55, ratio: 1.5, index: 0.25 });
  const fo = S.add('fold', x + 300, y, { fold: 3, model: 1 });
  const un = S.add('uncertainty', x + 300, y + 160, { rate: 0.15 });
  const fl = S.add('filter', x + 600, y, { cutoff: 600, res: 0.5, model: FILTER.LADDER });
  const sw = S.add('slope', x + 600, y + 160, { rise: 8, fall: 11, cycle: 1 });
  const dl = S.add('delay', x + 900, y, { time: 0.7, feedback: 0.6, mix: 0.35, type: 1 });
  S.wire(cx, 'out', fo, 'in');
  S.wire(un, 'smooth', fo, '@fold');
  S.att(fo, '@fold', 0.3);
  S.wire(fo, 'out', fl, 'in');
  S.wire(sw, 'out', fl, '@cutoff');
  S.att(fl, '@cutoff', 0.35);
  S.wire(fl, 'lp', dl, 'in');
  return { ids: [cx, fo, un, fl, sw, dl], out: [dl, 'l'], clocks: [] };
}

/** a slow sine bell, pinged on the clock: the source for the ambient effects */
function slowBell(S: Builder, x: number, y: number): { ids: string[]; out: [string, string]; ping: string } {
  const os = S.add('osc', x, y, { freq: 330, wave: WAVE.SIN });
  const amp = S.add('lpg', x + 300, y, { decay: 1.5, mode: LPG.BOTH });
  S.wire(os, 'out', amp, 'in');
  return { ids: [os, amp], out: [amp, 'out'], ping: amp };
}

export function grainCloud(S: Builder, x: number, y: number): Voice {
  const bell = slowBell(S, x, y);
  const gr = S.add('grains', x + 600, y, {
    source: 1,
    pos: 0.9,
    size: 0.25,
    dens: 20,
    spray: 0.4,
    detune: 0.2,
    spread: 0.9,
  });
  S.wire(bell.out[0], bell.out[1], gr, 'in');
  return { ids: [...bell.ids, gr], out: [gr, 'l'], clocks: [[bell.ping, 'ping', 1]] };
}

export function frozenSpace(S: Builder, x: number, y: number): Voice {
  const nz = S.add('noise', x, y, { level: 1 });
  const amp = S.add('lpg', x + 300, y, { decay: 1.2, mode: LPG.LP });
  const rv = S.add('reverb', x + 600, y, { type: 2, size: 1, decay: 30, damp: 0.6, mix: 0.7 });
  S.wire(nz, 'pink', amp, 'in');
  S.wire(amp, 'out', rv, 'in');
  return { ids: [nz, amp, rv], out: [rv, 'l'], clocks: [[amp, 'ping', 1]] };
}
