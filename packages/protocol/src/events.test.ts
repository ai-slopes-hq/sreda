import { describe, expect, it } from 'vitest';
import { EventRing, RING_RECORDS, RingWriter, ringBytes } from './events';

function make(): { w: RingWriter; r: EventRing } {
  const sab = new SharedArrayBuffer(ringBytes());
  return { w: new RingWriter(sab), r: new EventRing(sab) };
}

describe('event ring', () => {
  it('a written record reads back', () => {
    const { w, r } = make();
    const frame = 2 ** 33 + 5;
    w.write(frame, (7 << 16) | 2, 0x403c90);
    const got: number[][] = [];
    const n = r.read((f, s, node, midi) => got.push([f, s, node, midi]));
    expect(n).toBe(1);
    expect(got).toEqual([[frame, 7, 2, 0x403c90]]);
    expect(r.read(() => {})).toBe(0);
  });

  it('the ring wraps', () => {
    const { w, r } = make();
    const seen: number[] = [];
    for (let i = 0; i < 5000; i++) {
      w.write(i, 0, i);
      if ((i + 1) % 1000 === 0) r.read((_f, _s, _n, midi) => seen.push(midi));
    }
    expect(seen).toHaveLength(5000);
    for (let i = 0; i < 5000; i++) expect(seen[i]).toBe(i);
    expect(r.dropped()).toBe(0);
  });

  it('a full ring drops and counts', () => {
    const { w, r } = make();
    for (let i = 0; i < RING_RECORDS + 1; i++) w.write(i, 0, i);
    expect(r.read(() => {})).toBe(RING_RECORDS);
    expect(r.dropped()).toBe(1);
  });
});
