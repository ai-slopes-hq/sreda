// Sequence generators for DICE, ported from the old SREDA (`../sreda/design/mockup/reference-js/seqgen.js`) by way
// of the prototype. The RNG is passed in.

/** CHR MAJ MIN DOR PHR PMIN PMAJ WHL: semitones from the root */
export const SCALES: number[][] = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
  [0, 2, 4, 5, 7, 9, 11],
  [0, 2, 3, 5, 7, 8, 10],
  [0, 2, 3, 5, 7, 9, 10],
  [0, 1, 3, 5, 7, 8, 10],
  [0, 3, 5, 7, 10],
  [0, 2, 4, 7, 9],
  [0, 2, 4, 6, 8, 10],
];

/** A seeded PRNG in [0, 1), the same sequence as the engine's `Rng`. */
export function mulberry32(seed: number): () => number {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Euclid: n steps, k hits spread evenly, rotated by rot. */
export function euclid(n: number, k: number, rot: number): boolean[] {
  const out: boolean[] = [];
  for (let i = 0; i < n; i++) {
    const sh = (((i - rot) % n) + n) % n;
    out.push(k >= n ? true : k <= 0 ? false : (sh * k) % n < k);
  }
  return out;
}

export type Algo = '303' | 'MOTIF' | 'WALK' | 'TURING' | 'ARP' | 'PHRASE' | 'PEDAL' | 'EUCLID';

/** A line of n notes as semitones 0…24, all in the scale from the root. */
export function genNotes(algo: Algo, n: number, scale: number[], root: number, R: () => number): number[] {
  const pcs = scale.map((q) => (q + root) % 12).sort((a, b) => a - b);
  const notes: number[] = [];
  const K = pcs.length;
  for (let o = 0; o <= 2; o++) for (const q of pcs) if (o * 12 + q <= 24) notes.push(o * 12 + q);
  const ri = (a: number, b: number) => a + Math.floor(R() * (b - a + 1));
  const shuffle = <T>(a: T[]): T[] => {
    const b = a.slice();
    for (let i = b.length - 1; i > 0; i--) {
      const j = Math.floor(R() * (i + 1));
      [b[i], b[j]] = [b[j]!, b[i]!];
    }
    return b;
  };
  const deg = (d: number) => notes[Math.max(0, Math.min(notes.length - 1, d))]!;
  const walk = (k: number, len: number): number[] => {
    const out: number[] = [];
    for (let i = 0; i < len; i++) {
      if (i) {
        const r = R();
        const d = r < 0.15 ? 0 : r < 0.75 ? 1 : r < 0.92 ? 2 : 3 + Math.floor(R() * 3);
        k += (R() < 0.5 ? -1 : 1) * d;
      }
      if (k < 0) k = -k;
      if (k > notes.length - 1) k = 2 * (notes.length - 1) - k;
      k = Math.max(0, Math.min(notes.length - 1, k));
      out.push(k);
    }
    return out;
  };
  let line: number[] = [];
  if (algo === '303' || algo === 'MOTIF') {
    let base: number[] = [];
    if (algo === '303') {
      let bag: number[] = [];
      while (base.length < n) {
        if (!bag.length) bag = shuffle(pcs);
        base.push(bag.pop()!);
      }
    } else {
      const mm = Math.min(K, ri(3, 5));
      const motif = shuffle(pcs).slice(0, mm);
      for (let i = 0; i < n; i++) base.push(motif[i % mm]!);
      base = shuffle(base);
    }
    line = base.map((pc) => {
      const c = ri(-1, 1);
      let s2 = 0;
      for (let t = 0; t < 2; t++) if (R() * 100 < 20) s2++;
      const oo = Math.max(-1, Math.min(2, c * s2));
      return pc + (oo > 0 && pc + 12 <= 24 ? 12 : 0);
    });
  } else if (algo === 'WALK') line = walk(Math.floor(notes.length * (0.2 + R() * 0.4)), n).map(deg);
  else if (algo === 'TURING') {
    const bits: number[] = [];
    for (let b = 0; b < 16; b++) bits.push(R() < 0.5 ? 1 : 0);
    const span = notes.filter((v) => v <= 19).length;
    for (let i = 0; i < n; i++) {
      let v = 0;
      for (let j = 0; j < 8; j++) v += bits[(i + j) % 16]! << j;
      line.push(deg(Math.round((v / 255) * (span - 1))));
    }
  } else if (algo === 'ARP') {
    const ch = [0, 2, 4]
      .concat(K > 6 && R() < 0.5 ? [6] : [])
      .filter((d) => d < K)
      .map((d) => pcs[d]!);
    let lad: number[] = [];
    for (const oo of [0, 12]) for (const c of ch) lad.push(c + oo);
    lad.push(pcs[0]! + 24);
    lad = lad.filter((x) => x <= 24).sort((a, b) => a - b);
    const kind = (['UP', 'DOWN', 'UPDOWN', 'UPDOWN'] as const)[ri(0, 3)];
    const pt =
      kind === 'UP' ? lad : kind === 'DOWN' ? lad.slice().reverse() : lad.concat(lad.slice(1, -1).reverse());
    const st0 = ri(0, pt.length - 1);
    for (let i = 0; i < n; i++) line.push(pt[(st0 + i) % pt.length]!);
  } else if (algo === 'PHRASE') {
    const Aw = walk(ri(0, Math.max(0, K - 1)) + (R() < 0.5 ? 0 : K), 4);
    const sh = [1, 2, -1][ri(0, 2)]!;
    const A2 = Aw.map((d) => d + sh);
    const B = walk(Aw[3]!, 3);
    const rootD = Math.round(B[2]! / K) * K;
    line = Aw.concat(A2, Aw, B, [Math.min(notes.length - 1, rootD)])
      .map(deg)
      .slice(0, n);
    while (line.length < n) line.push(line[line.length - 1]!);
  } else {
    const every = R() < 0.5 ? 2 : 3;
    const tune = walk(ri(Math.floor(K / 2), K + 2), n);
    line = tune.map((d, i) => (i % every === 0 ? pcs[0]! : deg(Math.max(d, 2))));
  }
  return line;
}
