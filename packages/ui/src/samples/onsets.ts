// Where the hits are in a sample (spec §7a: SAMPLER's SLICE and GRAINS' hits): a rise in short-time energy.

const WIN = 256;
const HOP = 64;
/** a rise of at least this (dB) over the frames before is a hit */
const RISE_DB = 9;
/** and at most one hit per 40 ms */
const GAP_S = 0.04;

/** Hits as sample positions with a strength 0…1 (how sharp the rise, how loud the hit). */
export function onsets(channels: Float32Array[], rate: number): { at: number; strength: number }[] {
  const len = channels[0]?.length ?? 0;
  const frames = Math.max(0, Math.floor((len - WIN) / HOP) + 1);
  const energy = new Float64Array(frames);
  let max = 0;
  for (let f = 0; f < frames; f++) {
    let e = 0;
    for (const ch of channels) for (let i = f * HOP; i < f * HOP + WIN; i++) e += ch[i]! * ch[i]!;
    energy[f] = e / (WIN * channels.length);
    max = Math.max(max, energy[f]!);
  }
  if (max <= 0) return [];
  const floor = max * 1e-6; // −60 dB under the loudest frame
  const out: { at: number; strength: number }[] = [];
  let last = -Infinity;
  for (let f = 0; f < frames; f++) {
    // the frames that do not overlap this one, the quietest of the last few
    let before = Infinity;
    for (let k = f - WIN / HOP - 3; k <= f - WIN / HOP; k++)
      before = Math.min(before, k >= 0 ? energy[k]! : 0);
    const e = energy[f]!;
    if (e < floor) continue;
    const rise = 10 * Math.log10((e + floor) / (before + floor));
    if (rise < RISE_DB) continue;
    // the first sample inside the frame that reaches a quarter of its peak
    let peak = 0;
    for (const ch of channels)
      for (let i = f * HOP; i < f * HOP + WIN; i++) peak = Math.max(peak, Math.abs(ch[i]!));
    let at = f * HOP;
    find: for (let i = f * HOP; i < f * HOP + WIN; i++)
      for (const ch of channels)
        if (Math.abs(ch[i]!) >= peak / 4) {
          at = i;
          break find;
        }
    if (at - last < GAP_S * rate) continue;
    last = at;
    out.push({ at, strength: Math.min(1, rise / 30) * Math.min(1, Math.sqrt(e / max) * 2) });
  }
  return out;
}
