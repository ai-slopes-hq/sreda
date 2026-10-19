// Tap tempo (spec §5, §7c): a frame's Tap and CLOCK's TAP.

/** BPM from the last taps (up to 4, within 2.5 s; at least 2) — null until there are two */
export function tapTempo(taps: number[], now: number): { taps: number[]; bpm: number | null } {
  const recent = [...taps.filter((t) => now - t < 2.5), now].slice(-4);
  if (recent.length < 2) return { taps: recent, bpm: null };
  const interval = (recent[recent.length - 1]! - recent[0]!) / (recent.length - 1);
  return { taps: recent, bpm: Math.round(Math.min(300, Math.max(20, 60 / interval))) };
}

/**
 * Tap tempo kept per id (one module's taps never count for another): a tap at `now` seconds → its BPM (null until
 * there are two taps) and its run — a tap with none of its id's taps in the window starts a new run. A run is one
 * undo step: merge with `tap:<id>:<run>`.
 */
export function createTapper(): (id: string, now: number) => { bpm: number | null; run: number } {
  const taps = new Map<string, { taps: number[]; run: number }>();
  let runs = 0;
  return (id, now) => {
    const t = tapTempo(taps.get(id)?.taps ?? [], now);
    const run = t.taps.length === 1 ? ++runs : taps.get(id)!.run;
    taps.set(id, { taps: t.taps, run });
    return { bpm: t.bpm, run };
  };
}
