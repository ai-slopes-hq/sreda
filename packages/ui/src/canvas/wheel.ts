// A scroll that pans the canvas keeps panning when it passes over a knob or an option (a trackpad swipe must not
// turn controls on its way); a control takes the wheel only once the pan has paused.
const PAUSE_MS = 300;
let panUntil = 0;

export function panned(): void {
  panUntil = performance.now() + PAUSE_MS;
}

export function panning(): boolean {
  return performance.now() < panUntil;
}
