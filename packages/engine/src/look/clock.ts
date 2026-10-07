import type { LookParams } from "./params.ts";

// The day only runs forwards: the sun rises in the east (phase 0), crosses the sky and sets
// low in the west (phase 1), so shadows never swing back (D16). After an evening hold the
// clock wraps to morning behind a short fade to black. In-game that wrap belongs inside one of
// Gen 1's own fades (doors, caves, route changes), via `wrapNow()`, so it's never seen.

/** Seconds to fade out, and again to fade back in, around a wrap. */
export const WRAP_FADE_SECONDS = 0.8;

export interface DayClock {
  /** 0 = clear, 1 = black. Multiplies the final image. */
  fade: number;
  /** Seconds left in the evening hold. */
  holdLeft: number;
  /** 1 while fading out to wrap, −1 while fading back in, 0 otherwise. */
  fading: -1 | 0 | 1;
}

export const createDayClock = (time: LookParams["time"]): DayClock => ({ fade: 0, holdLeft: time.eveningHold, fading: 0 });

/** Advances the clock, writing the new phase into `time.phase`. */
export function stepDay(time: LookParams["time"], clock: DayClock, dt: number) {
  if (clock.fading === 1) {
    clock.fade = Math.min(1, clock.fade + dt / WRAP_FADE_SECONDS);
    if (clock.fade === 1) {
      time.phase = 0;
      clock.holdLeft = time.eveningHold;
      clock.fading = -1;
    }
    return;
  }
  if (clock.fading === -1) {
    clock.fade = Math.max(0, clock.fade - dt / WRAP_FADE_SECONDS);
    if (clock.fade === 0) clock.fading = 0;
    return;
  }
  if (!time.drift) return;
  if (time.phase < 1) {
    time.phase = Math.min(1, time.phase + dt / time.cycleSeconds);
    clock.holdLeft = time.eveningHold;
  } else {
    clock.holdLeft -= dt;
    if (clock.holdLeft <= 0) clock.fading = 1;
  }
}

/**
 * Jumps to morning. With `instant` (the screen is already black, e.g. mid-warp) the phase
 * resets at once; otherwise it fades out and back in.
 */
export function wrapNow(time: LookParams["time"], clock: DayClock, instant: boolean) {
  if (instant) {
    time.phase = 0;
    clock.holdLeft = time.eveningHold;
    clock.fading = clock.fade > 0 ? -1 : 0;
  } else if (clock.fading === 0) {
    clock.fading = 1;
  }
}
