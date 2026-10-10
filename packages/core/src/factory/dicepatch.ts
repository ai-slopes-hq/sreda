// DICE a whole patch (spec §6, revision 29): a random, playable patch — rhythmic or ambient — built like the factory
// projects (real units, cables, frames with their own clock, STACK packing) and kept inside safe ranges so every throw
// sounds and none clips hard.
import type { Doc } from '../doc';
import { genNotes, mulberry32, SCALES, type Algo } from '../generators';
import type { Specs } from '../spec';
import { seqParams } from '../migrate/seq';
import { build, euclidRhythm, melodyLine, type Builder } from './build';

export type DiceKind = 'rhythmic' | 'ambient';

const ALGOS: Algo[] = ['303', 'MOTIF', 'WALK', 'TURING', 'ARP', 'PHRASE', 'PEDAL'];
/** minor-ish scales that sit well under a random line: MIN, DOR, PHR, PMIN */
const MOODS = [2, 3, 4, 5];
// option indices
const LPG = { VCA: 0, LP: 1, BOTH: 2 };
const WAVE = { SIN: 0, TRI: 1, SAW: 2, SQR: 3 };

/** A random patch for `seed` (the same seed gives the same patch). */
export function dicePatch(specs: Specs, seed: number): { doc: Doc; kind: DiceKind } {
  const R = mulberry32(seed >>> 0 || 1);
  const kind: DiceKind = R() < 0.5 ? 'rhythmic' : 'ambient';
  const doc = build(specs, (S) => (kind === 'rhythmic' ? rhythmic(S, R) : ambient(S, R)));
  return { doc, kind };
}

type Rand = () => number;
const between = (R: Rand, a: number, b: number) => a + (b - a) * R();
/** log-uniform between a and b */
const logBetween = (R: Rand, a: number, b: number) => a * (b / a) ** R();
const pick = <T>(R: Rand, xs: readonly T[]): T => xs[Math.floor(R() * xs.length)]!;
const chance = (R: Rand, p: number) => R() < p;

/** A generated line in STAGES' saved form (for `seqParams`): gen, scale, root, length and 16 notes with a few slides. */
function line(R: Rand, slides: number): Record<string, number> {
  const algo = Math.floor(R() * ALGOS.length);
  const scale = pick(R, MOODS);
  const root = Math.floor(R() * 12);
  const semis = genNotes(ALGOS[algo]!, 16, SCALES[scale]!, root, R);
  const glide: number[] = [];
  for (let k = 0; k < slides; k++) glide.push(1 + Math.floor(R() * 16));
  return melodyLine(semis, { gen: algo, scale, root, length: pick(R, [8, 16, 16]), slides: [...new Set(glide)] });
}

function rhythmic(S: Builder, R: Rand): void {
  const ids: string[] = [];
  const voices: { out: [string, string]; frame: string[]; name: string }[] = [];
  let y = 0;
  const lane = () => (y += 200);
  // the clock frame's CLK OUT reaches these after the frame exists
  const clocked: [string, string, number][] = [];

  // drums
  if (chance(R, 0.85)) {
    const d: string[] = [];
    const kr = S.seq(0, lane(), seqParams(euclidRhythm(16, Math.round(between(R, 3, 5))), null));
    const kick = S.add('osc', 300, y, { freq: between(R, 45, 62), wave: WAVE.SIN });
    const kl = S.add('lpg', 600, y, { decay: between(R, 0.2, 0.45), mode: LPG.BOTH });
    S.wire(kick, 'out', kl, 'in');
    S.wire(kr, 'gate', kl, 'ping');
    clocked.push([kr, 'clk', 4]);
    d.push(kr, kick, kl);
    const dm = S.add('mix', 900, y, { la: 0.9, lb: 0.45, lc: 0.55 });
    d.push(dm);
    S.wire(kl, 'out', dm, 'a');
    const hits = Math.round(between(R, 5, 11));
    const hr = S.seq(0, lane(), seqParams(euclidRhythm(16, hits, Math.floor(R() * 4)), null));
    const nz = S.add('noise', 300, y, { level: 0.6 });
    const hl = S.add('lpg', 600, y, { decay: between(R, 0.03, 0.09), mode: LPG.BOTH });
    S.wire(nz, 'white', hl, 'in');
    S.wire(hr, 'gate', hl, 'ping');
    S.wire(hl, 'out', dm, 'b');
    clocked.push([hr, 'clk', 4]);
    d.push(hr, nz, hl);
    if (chance(R, 0.5)) {
      // a snare: pink noise through a band-pass, on 2 and 4 (rotated)
      const sr = S.seq(0, lane(), seqParams(euclidRhythm(16, 2, 4), null));
      const sn = S.add('noise', 300, y, { level: 0.7 });
      const sf = S.add('filter', 600, y, { cutoff: between(R, 900, 2200), res: 0.3, model: 0 });
      const sl = S.add('lpg', 900, y, { decay: between(R, 0.08, 0.18), mode: LPG.BOTH });
      S.wire(sn, 'pink', sf, 'in');
      S.wire(sf, 'bp', sl, 'in');
      S.wire(sr, 'gate', sl, 'ping');
      S.wire(sl, 'out', dm, 'c');
      clocked.push([sr, 'clk', 4]);
      d.push(sr, sn, sf, sl);
    }
    voices.push({ out: [dm, 'out'], frame: d, name: 'DRUMS' });
  }

  // one or two pitched voices (always at least one when there are no drums)
  const pitched = voices.length ? (chance(R, 0.6) ? 1 : 2) : 1 + Math.round(R());
  for (let v = 0; v < pitched; v++) {
    const f: string[] = [];
    const bass = v === 0;
    const hits = Math.round(between(R, bass ? 5 : 3, bass ? 10 : 7));
    const rhythm = euclidRhythm(16, hits, Math.floor(R() * 8));
    const gr = S.seq(0, lane(), seqParams(rhythm, line(R, bass ? 3 : 1)));
    clocked.push([gr, 'clk', 4]);
    const src = chance(R, 0.75)
      ? S.add('osc', 0, lane(), {
          freq: bass ? pick(R, [55, 65.4, 73.4]) : pick(R, [220, 261.6, 293.7]),
          wave: pick(R, [WAVE.SAW, WAVE.SQR]),
        })
      : S.add('complex', 0, lane(), {
          freq: bass ? pick(R, [55, 65.4]) : pick(R, [220, 261.6]),
          ratio: pick(R, [1, 2, 3, 0.5]),
          index: between(R, 0.05, 0.3),
        });
    S.wire(gr, 'cv', src, 'pitch');
    const fl = S.add('filter', 300, y, {
      cutoff: logBetween(R, bass ? 180 : 500, bass ? 700 : 2500),
      res: between(R, 0.35, 0.8),
      model: pick(R, [0, 1, 2, 3]),
    });
    S.wire(src, 'out', fl, 'in');
    let last: [string, string] = [fl, 'lp'];
    if (chance(R, 0.3)) {
      const shaper = chance(R, 0.5)
        ? S.add('drive', 600, y, { gain: between(R, 6, 18), model: Math.floor(R() * 7), mix: 0.8 })
        : S.add('fold', 600, y, { fold: between(R, 1.5, 4), model: Math.floor(R() * 4) });
      S.wire(last[0], last[1], shaper, 'in');
      last = [shaper, 'out'];
      f.push(shaper);
    }
    const amp = S.add('lpg', 900, y, { decay: between(R, 0.12, bass ? 0.4 : 0.9), mode: LPG.BOTH });
    S.wire(last[0], last[1], amp, 'in');
    S.wire(gr, 'gate', amp, 'ping');
    // the cutoff's envelope
    const env = S.add('slope', 0, lane(), { rise: 0.002, fall: between(R, 0.08, 0.5) });
    S.wire(gr, 'gate', env, 'trig');
    S.wire(env, 'out', fl, '@cutoff');
    S.att(fl, '@cutoff', between(R, 0.2, 0.5));
    f.push(gr, src, fl, amp, env);
    voices.push({ out: [amp, 'out'], frame: f, name: bass ? 'BASS' : 'LEAD' });
  }

  // the mix, the effects, the out
  const mx = S.add('mix', 1200, 200, { la: 0.7, lb: 0.6, lc: 0.55, ld: 0.5 });
  voices.forEach((v, i) => S.wire(v.out[0], v.out[1], mx, 'abcd'[i]!));
  let last: [string, string] = [mx, 'out'];
  const fx: string[] = [mx];
  if (chance(R, 0.6)) {
    const dl = S.add('delay', 1500, 200, {
      time: pick(R, [0.25, 0.375, 0.5]),
      feedback: between(R, 0.25, 0.5),
      mix: between(R, 0.15, 0.3),
      type: Math.floor(R() * 3),
      ping: chance(R, 0.5) ? 1 : 0,
    });
    clocked.push([dl, 'clk', 1]);
    S.wire(last[0], last[1], dl, 'in');
    last = [dl, 'l'];
    fx.push(dl);
  }
  if (chance(R, 0.4)) {
    const rv = S.add('reverb', 1800, 200, {
      type: pick(R, [0, 1]),
      decay: between(R, 0.8, 2.5),
      mix: between(R, 0.12, 0.25),
    });
    S.wire(last[0], last[1], rv, 'in');
    last = [rv, 'l'];
    fx.push(rv);
  }
  const o = S.add('out', 2100, 200, { level: 0.7 });
  S.wire(last[0], last[1], o, 'l');
  fx.push(o);

  for (const v of voices) {
    ids.push(...v.frame);
    S.frame(v.frame, v.name);
  }
  ids.push(...fx);
  const g = S.frame(ids, 'DICE', { bpm: Math.round(between(R, 90, 150)), tint: 1 + Math.floor(R() * 6) });
  for (const [id, port, ratio] of clocked) {
    S.wire(g, 'clkOut', id, port);
    if (ratio !== 1) S.rat(id, port, ratio);
  }
}

function ambient(S: Builder, R: Rand): void {
  const ids: string[] = [];
  const voices: { out: [string, string]; frame: string[]; name: string }[] = [];
  let y = 0;
  const lane = () => (y += 200);
  const clocked: [string, string, number][] = [];

  // a drone
  if (chance(R, 0.8)) {
    const f: string[] = [];
    const cx = S.add('complex', 0, lane(), {
      freq: logBetween(R, 40, 110),
      ratio: pick(R, [0.5, 1.5, 2, 3]),
      index: between(R, 0.1, 0.4),
      timbre: between(R, 0, 0.5),
    });
    let last: [string, string] = [cx, 'out'];
    if (chance(R, 0.5)) {
      const fo = S.add('fold', 300, y, { fold: between(R, 1.5, 5), model: pick(R, [0, 1, 3]) });
      S.wire(cx, 'out', fo, 'in');
      last = [fo, 'out'];
      const un = S.add('uncertainty', 0, lane(), { rate: logBetween(R, 0.05, 0.4) });
      S.wire(un, 'smooth', fo, '@fold');
      S.att(fo, '@fold', between(R, 0.2, 0.4));
      f.push(fo, un);
    }
    const fl = S.add('filter', 600, y, {
      cutoff: logBetween(R, 300, 1400),
      res: between(R, 0.2, 0.6),
      model: pick(R, [0, 1, 3]),
    });
    S.wire(last[0], last[1], fl, 'in');
    const sw = S.add('slope', 0, lane(), { rise: between(R, 4, 12), fall: between(R, 6, 15), cycle: 1 });
    S.wire(sw, 'out', fl, '@cutoff');
    S.att(fl, '@cutoff', between(R, 0.25, 0.5));
    f.push(cx, fl, sw);
    voices.push({ out: [fl, 'lp'], frame: f, name: 'DRONE' });
  }

  // a slow line: bells or a pad, pinged on the clock (sometimes by chance)
  if (chance(R, 0.8) || voices.length === 0) {
    const f: string[] = [];
    const st = S.seq(0, lane(), seqParams(null, line(R, 4)));
    const bells = chance(R, 0.5);
    const os = S.add('osc', 300, y, {
      freq: bells ? pick(R, [440, 523.3, 587.3]) : pick(R, [110, 130.8, 146.8]),
      wave: bells ? WAVE.SIN : WAVE.TRI,
    });
    S.wire(st, 'cv', os, 'pitch');
    const amp = S.add('lpg', 600, y, {
      decay: between(R, bells ? 0.8 : 1.5, bells ? 2.5 : 4),
      mode: LPG.BOTH,
    });
    S.wire(os, 'out', amp, 'in');
    // CHANCE thins the line out only beside a drone, so a patch is never silent for long
    if (voices.length > 0 && chance(R, 0.5)) {
      const ch = S.add('chance', 900, y, { p: between(R, 0.35, 0.7) });
      clocked.push([ch, 'trig', 1]);
      S.wire(ch, 'a', st, 'clk');
      S.wire(ch, 'a', amp, 'ping');
      f.push(ch);
    } else {
      clocked.push([st, 'clk', 1]);
      clocked.push([amp, 'ping', 1]);
    }
    f.push(st, os, amp);
    voices.push({ out: [amp, 'out'], frame: f, name: bells ? 'BELLS' : 'PAD' });
  }

  const mx = S.add('mix', 1200, 200, { la: 0.6, lb: 0.6, lc: 0.5, ld: 0.5 });
  voices.forEach((v, i) => S.wire(v.out[0], v.out[1], mx, 'abcd'[i]!));
  const fx: string[] = [mx];
  // GRAINS on LIVE, fed by the first voice, back into the mix
  if (chance(R, 0.4)) {
    const gr = S.add('grains', 1200, 400, {
      source: 1,
      pos: between(R, 0.7, 0.95),
      size: between(R, 0.1, 0.4),
      dens: between(R, 8, 30),
      spray: between(R, 0.2, 0.5),
      spread: 0.8,
    });
    S.wire(voices[0]!.out[0], voices[0]!.out[1], gr, 'in');
    S.wire(gr, 'l', mx, 'abcd'[voices.length]!);
    fx.push(gr);
  }
  const dl = S.add('delay', 1500, 200, {
    time: between(R, 0.4, 1.2),
    feedback: between(R, 0.5, 0.75),
    mix: between(R, 0.3, 0.45),
    type: Math.floor(R() * 3),
    ping: 1,
  });
  const rv = S.add('reverb', 1800, 200, {
    type: pick(R, [1, 2]),
    size: between(R, 0.6, 0.9),
    decay: between(R, 4, 12),
    mix: between(R, 0.35, 0.55),
  });
  const o = S.add('out', 2100, 200, { level: 0.7 });
  S.wire(mx, 'out', dl, 'in');
  S.wire(dl, 'l', rv, 'in');
  S.wire(rv, 'l', o, 'l');
  S.wire(rv, 'r', o, 'r');
  fx.push(dl, rv, o);

  for (const v of voices) {
    ids.push(...v.frame);
    S.frame(v.frame, v.name);
  }
  ids.push(...fx);
  const g = S.frame(ids, 'DICE', { bpm: Math.round(between(R, 40, 80)), tint: 1 + Math.floor(R() * 6) });
  for (const [id, port, ratio] of clocked) {
    S.wire(g, 'clkOut', id, port);
    if (ratio !== 1) S.rat(id, port, ratio);
  }
}
