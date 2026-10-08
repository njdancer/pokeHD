// Dynamic resolution: watches display frame times and steps the render scale down when frames
// run long, and back up when there's headroom, so a phone holds its frame rate and a fast machine
// stays sharp. The bottom rung also drops depth of field, the costliest post effect (docs/PERF.md).
//
// The only signal every browser gives is the time between animation frames, which vsync rounds
// up: at 60 Hz a frame either makes 16.7 ms or shows as 33 ms. So the governor counts missed
// frames rather than timing work, and it learns from its own moves:
// - a whole descent to the bottom rung that doesn't make frames faster is undone and held off
//   for a while (the frame rate is capped elsewhere: iOS Low Power Mode's 30 fps, or a CPU-bound
//   page). One step alone can't tell: vsync hides a frame that got faster but still misses;
// - a step up that has to come back down within 15 s waits twice as long before trying again,
//   so a device on the edge of a rung settles below it instead of flickering between the two;
// - a window with many stalls (startup, shader compiles, a hidden tab) is thrown away whole, so
//   its few surviving frames can't pass for the steady load.
// Pure logic, no three.js: the engine feeds it frame intervals and applies the rung it returns.

export interface Rung {
  /** Multiplies the pixel ratio. */
  scale: number;
  /** False drops depth of field. */
  dof: boolean;
}

export const RUNGS: readonly Rung[] = [
  { scale: 1, dof: true },
  { scale: 0.9, dof: true },
  { scale: 0.8, dof: true },
  { scale: 0.7, dof: true },
  { scale: 0.6, dof: true },
  { scale: 0.5, dof: true },
  { scale: 0.5, dof: false },
];

export interface GovernorOptions {
  /** Frame rate to hold. Default 60. */
  targetFps?: number;
  /** Seconds of frames judged at a time. Default 0.5. */
  window?: number;
  /** Seconds ignored after a change (render targets resize, shaders compile). Default 1. */
  settle?: number;
  /** Seconds of clean windows before trying a rung up. Doubles each time a rung up fails. Default 3. */
  upHold?: number;
  /** Most seconds a failed rung up waits. Default 60. */
  maxUpHold?: number;
  /** Seconds a fruitless descent is held off; doubles each time, up to 10 minutes. Default 30. */
  capHold?: number;
}

export interface Governor {
  readonly rung: number;
  /** Feeds one display frame interval (ms) at time `now` (s). Returns the new rung when it changes. */
  sample(intervalMs: number, now: number): number | null;
  /** Back to full resolution (the scene changed completely, e.g. a new device size). */
  reset(now: number): void;
}

/** A frame later than this share of the frame budget counts as missed. */
const MISS = 1.25;
/** Windows with more missed frames than this step down; with fewer than CLEAN they count as clean. */
const DOWN = 0.2;
const CLEAN = 0.03;
/** Intervals over this are stalls (tab hidden, a chunk build, a GC), not the steady load. */
const STALL_MS = 100;
/** A window with more stalls than this share of its frames says nothing about the steady load. */
const STALLY = 0.1;
/** A step down within this many seconds of a step up marks that step up as failed. */
const PROBE_S = 15;

export function createGovernor(options: GovernorOptions = {}): Governor {
  const budget = 1000 / (options.targetFps ?? 60);
  const windowS = options.window ?? 0.5;
  const settle = options.settle ?? 1;
  const baseUpHold = options.upHold ?? 3;
  const maxUpHold = options.maxUpHold ?? 60;
  const capHold = options.capHold ?? 30;

  let rung = 0;
  let quietUntil = 0;
  let windowStart = -1;
  let frames: number[] = [];
  let cleanSince = -1;
  /** Seconds to wait before stepping up from each rung. */
  const upHold = RUNGS.map(() => baseUpHold);
  /** Don't step below this rung until `floorUntil`. */
  let floor = RUNGS.length - 1;
  let floorUntil = 0;
  let capFor = capHold;
  /** When the governor last arrived at the current rung by stepping up. */
  let cameUpAt = -Infinity;
  let stalls = 0;
  /** Where the current run of steps down started, and the mean frame time there. */
  let descent: { from: number; meanMs: number } | null = null;

  const move = (to: number, now: number, meanMs: number) => {
    if (to > rung) {
      descent ??= { from: rung, meanMs };
      // Coming straight back down from a step up: that rung isn't sustainable yet.
      if (now - cameUpAt < PROBE_S) upHold[to] = Math.min(upHold[to]! * 2, maxUpHold);
      cameUpAt = -Infinity;
    } else {
      descent = null;
      cameUpAt = now;
    }
    rung = to;
    quietUntil = now + settle;
    cleanSince = -1;
    return rung;
  };

  return {
    get rung() {
      return rung;
    },
    reset(now) {
      rung = 0;
      cameUpAt = -Infinity;
      descent = null;
      floor = RUNGS.length - 1;
      capFor = capHold;
      upHold.fill(baseUpHold);
      quietUntil = now + settle;
      cleanSince = -1;
      frames = [];
      stalls = 0;
      windowStart = -1;
    },
    sample(intervalMs, now) {
      if (now < quietUntil || intervalMs <= 0) return null;
      if (windowStart < 0) windowStart = now;
      if (intervalMs > STALL_MS) stalls++;
      else frames.push(intervalMs);
      if (now - windowStart < windowS || frames.length < 8) return null;

      const stally = stalls > (frames.length + stalls) * STALLY;
      const missed = frames.filter((ms) => ms > budget * MISS).length / frames.length;
      const meanMs = frames.reduce((a, b) => a + b, 0) / frames.length;
      frames = [];
      stalls = 0;
      windowStart = now;
      if (stally) return null;
      if (now >= floorUntil) floor = RUNGS.length - 1;

      // At the bottom and no faster than where the descent began: the frame rate is capped
      // elsewhere, so the lost sharpness buys nothing. Go back up and stay there a while.
      if (descent && rung === RUNGS.length - 1 && missed > DOWN && meanMs > descent.meanMs * 0.95) {
        const top = descent.from;
        floor = top;
        floorUntil = now + capFor;
        capFor = Math.min(capFor * 2, 600);
        move(top, now, meanMs);
        cameUpAt = -Infinity; // not a probe up
        return rung;
      }

      if (missed > DOWN) {
        if (rung >= floor) return null;
        return move(rung + 1, now, meanMs);
      }
      if (missed < CLEAN && rung > 0) {
        if (cleanSince < 0) cleanSince = now;
        if (now - cleanSince >= upHold[rung]!) return move(rung - 1, now, meanMs);
      } else {
        cleanSince = -1;
      }
      return null;
    },
  };
}
