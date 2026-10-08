// Gliding the view to something off-screen (spec §5a): centre it, zoom unchanged.
type View = { x: number; y: number; z: number };
type Rect = { x: number; y: number; w: number; h: number };

/** The view that centres `target` (canvas px) in `visible` (screen px), or null when it is already in view. */
export function glideTo(view: View, target: Rect, visible: Rect): View | null {
  const sx = target.x * view.z + view.x;
  const sy = target.y * view.z + view.y;
  const [sw, sh] = [target.w * view.z, target.h * view.z];
  if (
    sx >= visible.x &&
    sy >= visible.y &&
    sx + sw <= visible.x + visible.w &&
    sy + sh <= visible.y + visible.h
  )
    return null;
  return {
    x: view.x + (visible.x + visible.w / 2 - (sx + sw / 2)),
    y: view.y + (visible.y + visible.h / 2 - (sy + sh / 2)),
    z: view.z,
  };
}

/** Animate from one view to another over `ms` (ease-out cubic). Returns a cancel function. */
export function animateView(from: View, to: View, ms: number, set: (v: View) => void): () => void {
  const t0 = performance.now();
  let raf = 0;
  const step = (t: number) => {
    const k = Math.min(1, (t - t0) / ms);
    const e = 1 - (1 - k) ** 3;
    set({ x: from.x + (to.x - from.x) * e, y: from.y + (to.y - from.y) * e, z: to.z });
    if (k < 1) raf = requestAnimationFrame(step);
  };
  raf = requestAnimationFrame(step);
  return () => cancelAnimationFrame(raf);
}
