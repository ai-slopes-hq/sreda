// The assembler: voices into role frames, a MIX (a second one past four voices), the style's effect chain, an OUT and
// the outer frame with the style's name and its own clock.
import { between, weighted } from './random';
import type { DiceCtx, DiceVoice, Style } from './types';

const INPUTS = 'abcd';
const LEVELS = ['la', 'lb', 'lc', 'ld'];

export function assemble(
  c: DiceCtx,
  style: Style,
  voices: DiceVoice[],
  extra: { ids: string[]; clocks: [string, string, number][] }[],
): void {
  const { S, R } = c;
  if (voices.length === 0 || voices.length > 7) throw new Error(`DICE: ${voices.length} voices cannot be mixed`);

  // role frames: the drums share one, every other voice has its own
  const frames: string[][] = [];
  const names: string[] = [];
  const drums = voices.filter((v) => v.role === 'drums');
  if (drums.length) {
    frames.push(drums.flatMap((v) => v.ids));
    names.push('DRUMS');
  }
  for (const v of voices) {
    if (v.role === 'drums') continue;
    frames.push(v.ids);
    names.push(v.name);
  }
  frames.forEach((ids, i) => S.frame(ids, names[i]!));

  // the mix: four voices on one MIX; past that the second MIX comes in on the first's D
  const levels = (vs: DiceVoice[]) => Object.fromEntries(vs.map((v, i) => [LEVELS[i]!, v.level]));
  const first = voices.length <= 4 ? voices : voices.slice(0, 3);
  const mx = S.add('mix', c.x + 1200, c.y, levels(first));
  const mixIds = [mx];
  first.forEach((v, i) => S.wire(v.out[0], v.out[1], mx, INPUTS[i]!));
  if (voices.length > 4) {
    const rest = voices.slice(3);
    const m2 = S.add('mix', c.x + 1200, c.y + 200, levels(rest));
    rest.forEach((v, i) => S.wire(v.out[0], v.out[1], m2, INPUTS[i]!));
    S.wire(m2, 'out', mx, 'd');
    mixIds.push(m2);
  }

  const chain = weighted(R, style.fx)(c, [mx, 'out']);
  const o = S.add('out', c.x + 2100, c.y, { level: 0.7 });
  S.wire(chain.l[0], chain.l[1], o, 'l');
  if (chain.r) S.wire(chain.r[0], chain.r[1], o, 'r');

  const ids = [...voices.flatMap((v) => v.ids), ...mixIds, ...chain.ids, o, ...extra.flatMap((e) => e.ids)];
  const g = S.frame(ids, style.label.toUpperCase(), { bpm: c.bpm, tint: 1 + Math.floor(between(R, 0, 6)) });
  const clocked = [...voices.flatMap((v) => v.clocks), ...chain.clocks, ...extra.flatMap((e) => e.clocks)];
  for (const [id, port, ratio] of clocked) {
    S.wire(g, 'clkOut', id, port);
    if (ratio !== 1) S.rat(id, port, ratio);
  }
}
