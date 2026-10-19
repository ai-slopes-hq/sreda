// Tap tempo (spec §5, §7c): a frame's Tap and CLOCK's TAP.

/** BPM from the last taps (up to 4, within 2.5 s; at least 2) — null until there are two */
export function tapTempo(taps: number[], now: number): { taps: number[]; bpm: number | null } {
  const recent = [...taps.filter((t) => now - t < 2.5), now].slice(-4);
  if (recent.length < 2) return { taps: recent, bpm: null };
  const interval = (recent[recent.length - 1]! - recent[0]!) / (recent.length - 1);
  return { taps: recent, bpm: Math.round(Math.min(300, Math.max(20, 60 / interval))) };
}

/** Tap tempo kept per id (one CLOCK's taps never count for another): a tap at `now` seconds → its BPM, or null. */
export function createTapper(): (id: string, now: number) => number | null {
  const taps = new Map<string, number[]>();
  return (id, now) => {
    const t = tapTempo(taps.get(id) ?? [], now);
    taps.set(id, t.taps);
    return t.bpm;
  };
}
