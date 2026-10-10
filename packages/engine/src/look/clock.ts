import type { LookParams } from "./params.ts";

// The day only runs forwards: the sun rises in the east (phase 0), crosses the sky and sets
// low in the west (phase 1), so shadows never swing back (D16). Then the light settles into dusk
// (`time.dusk` 0 → 1): the sun fades out, so there are no direct shadows, and the colours go low
// and warm. Dusk holds a while; with the sun gone the clock can jump back to morning unseen, and
// the light brightens out of dusk into a new day (D40). Nothing ever fades to black.

export interface DayClock {
  /** Seconds left in the dusk hold. */
  holdLeft: number;
  /** True while dusk lifts into the next morning. */
  dawning: boolean;
}

export const createDayClock = (time: LookParams["time"]): DayClock => ({ holdLeft: time.eveningHold, dawning: false });

/** Advances the clock, writing the new phase and dusk into `time`. */
export function stepDay(time: LookParams["time"], clock: DayClock, dt: number) {
  if (!time.drift || dt <= 0) return;
  if (clock.dawning) {
    // The sun rises as the dusk lifts.
    time.dusk = Math.max(0, time.dusk - dt / time.dawnSeconds);
    time.phase = Math.min(1, time.phase + dt / time.cycleSeconds);
    if (time.dusk === 0) clock.dawning = false;
  } else if (time.phase < 1) {
    time.phase = Math.min(1, time.phase + dt / time.cycleSeconds);
    clock.holdLeft = time.eveningHold;
  } else if (time.dusk < 1) {
    time.dusk = Math.min(1, time.dusk + dt / time.duskSeconds);
  } else {
    clock.holdLeft -= dt;
    if (clock.holdLeft <= 0) {
      // Full dusk has no sun, so the sun can go back to the east without anyone seeing it.
      time.phase = 0;
      clock.dawning = true;
      clock.holdLeft = time.eveningHold;
    }
  }
}

/** Jumps straight to a clear morning (look-dev). */
export function wrapNow(time: LookParams["time"], clock: DayClock) {
  time.phase = 0;
  time.dusk = 0;
  clock.dawning = false;
  clock.holdLeft = time.eveningHold;
}
