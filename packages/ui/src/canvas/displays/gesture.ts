import type { JSX } from 'solid-js';

/** a gesture on a sample display, `t` the horizontal position 0…1 across it */
export interface Cursor {
  /** `click`: a press that moved less than 3 px; `drag`: every move of a longer one (the first at the press point);
   * `end`: the release, `pointercancel` or lost capture of a drag, at the last position */
  phase: 'click' | 'drag' | 'end';
  t: number;
}

/** pixels a press may move and still be a click */
export const CLICK_SLOP = 3;

/**
 * Pointer handlers for a display that is a cursor (click) and a scrub (drag). The pointer is captured, so a drag
 * ends on pointerup, pointercancel or lostpointercapture, wherever the pointer is. With `drag` false every press is
 * a click. The press never reaches the canvas (no module drag).
 */
export function cursorHandlers(o: {
  drag: () => boolean;
  on: (c: Cursor) => void;
}): Pick<
  JSX.HTMLAttributes<HTMLDivElement>,
  'onPointerDown' | 'onPointerMove' | 'onPointerUp' | 'onPointerCancel' | 'onLostPointerCapture'
> {
  let id = -1;
  let x0 = 0;
  let dragging = false;
  /** moved at least the slop: no longer a click, drag or not */
  let moved = false;
  let last = 0;
  const at = (e: PointerEvent): number => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    return r.width > 0 ? Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)) : 0;
  };
  const finish = (): void => {
    if (dragging) o.on({ phase: 'end', t: last });
    id = -1;
    dragging = false;
  };
  return {
    onPointerDown(e) {
      e.stopPropagation();
      if (e.button !== 0 || id >= 0) return;
      id = e.pointerId;
      x0 = e.clientX;
      dragging = false;
      moved = false;
      last = at(e);
      (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    },
    onPointerMove(e) {
      if (e.pointerId !== id) return;
      if (!dragging) {
        if (Math.abs(e.clientX - x0) < CLICK_SLOP) return;
        moved = true;
        if (!o.drag()) return;
        dragging = true;
        // the scrub starts where the press was
        o.on({ phase: 'drag', t: last });
      }
      last = at(e);
      o.on({ phase: 'drag', t: last });
    },
    onPointerUp(e) {
      if (e.pointerId !== id) return;
      const wasDrag = dragging;
      if (wasDrag) last = at(e);
      else if (!moved) o.on({ phase: 'click', t: at(e) });
      if (wasDrag) finish();
      id = -1;
      dragging = false;
      (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
    },
    onPointerCancel(e) {
      if (e.pointerId === id) finish();
    },
    onLostPointerCapture(e) {
      if (e.pointerId === id) finish();
    },
  };
}
