import type { Doc } from './doc';

/**
 * How a commit joins the previous one: the same `key` within 0.7 s merges (a wheel run on one control);
 * `stroke` merges for as long as the key stays the same (one drag).
 */
export type Merge = { key: string; stroke?: boolean } | undefined;

const PAUSE_MS = 700;

export class History {
  current: Doc;
  private past: Doc[] = [];
  private future: Doc[] = [];
  private last: { key: string; stroke: boolean; at: number } | null = null;

  constructor(
    initial: Doc,
    private readonly now: () => number = Date.now,
  ) {
    this.current = initial;
  }

  commit(doc: Doc, merge?: Merge): void {
    const at = this.now();
    const l = this.last;
    const merges = !!merge && !!l && l.key === merge.key && (merge.stroke ? l.stroke : at - l.at < PAUSE_MS);
    if (!merges) this.past.push(this.current);
    this.current = doc;
    this.future = [];
    this.last = merge ? { key: merge.key, stroke: !!merge.stroke, at } : null;
  }

  /** Swap the current document without an undo step (e.g. a resumed autosave). */
  replace(doc: Doc): void {
    this.current = doc;
    this.last = null;
  }

  undo(): Doc | null {
    const prev = this.past.pop();
    if (!prev) return null;
    this.future.push(this.current);
    this.current = prev;
    this.last = null;
    return prev;
  }

  redo(): Doc | null {
    const next = this.future.pop();
    if (!next) return null;
    this.past.push(this.current);
    this.current = next;
    this.last = null;
    return next;
  }
}
