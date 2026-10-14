// Caps how often the frame loop draws. A rAF tick that comes sooner than 1/maxFps after the
// schedule's last slot is skipped, so 60 fps on a 120 Hz display draws every other tick. The
// slots run on a schedule rather than from the last draw, so a display whose ticks don't divide
// evenly (144 Hz) still averages the cap instead of dropping to the next divisor (48 fps).
// Pure logic: the engine asks before each draw and reports the draws it made.

export interface FrameCap {
  /** Whether a tick at `t` (ms) may draw. */
  allows(t: number): boolean;
  /** A frame was drawn at `t` (ms). */
  drew(t: number): void;
}

/**
 * `toleranceMs` lets a tick a little early still draw: vsync timestamps jitter, and a 120 Hz
 * tick due at 16.67 ms that lands at 16.5 must not slip to the next one.
 */
export function createFrameCap(maxFps: number, toleranceMs = 2): FrameCap {
  const interval = 1000 / maxFps;
  /** Earliest time the next frame may draw. */
  let due = -Infinity;
  return {
    allows: (t) => t >= due - toleranceMs,
    drew(t) {
      // On schedule: the next slot follows this one. Behind it (an idle spell, a stall): start
      // again from now, rather than bursting to catch up.
      due = due + interval >= t ? due + interval : t + interval;
    },
  };
}
