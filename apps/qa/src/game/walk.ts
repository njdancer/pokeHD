// Following a joystick walk step by step from the decoded state, so the driver knows when to let
// go (the game reads the pad only between steps) and can say afterwards how far the player got
// and, when it was short, why. Pure: the driver feeds it samples; the tests feed it made-up ones.
//
// Timing is in emulated frames (`__pokehd.frames`), never wall time: on a busy machine the page's
// reads lag and the emulator runs unevenly, and a wall clock then mistakes a slow game for a
// stopped player.
import type { StateLite } from "./screen-read.ts";
import type { Direction } from "./types.ts";

export const DIRS: Record<Direction, { dx: number; dy: number }> = { up: { dx: 0, dy: -1 }, down: { dx: 0, dy: 1 }, left: { dx: -1, dy: 0 }, right: { dx: 1, dy: 0 } };

/** Why a walk ended before it was done. */
export type Stop = "battle" | "text" | "map" | "blocked" | "stalled";

/**
 * Emulated frames with no step under way before a walk counts as blocked: three steps' worth, at
 * least 54 (0.9 s). Walking into a wall the game only plays its bump sound and never starts a step.
 */
export const stallFrames = (stepFrames: number) => Math.max(54, stepFrames * 3);

/**
 * The cell the player is headed for: mid-step, the one being stepped into (the game updates
 * wXCoord/wYCoord only on a step's last frame, so `x`/`y` is still the cell being left), else the
 * one they stand on.
 */
export function heading(s: StateLite): { x: number; y: number } {
  const step = s.player.step as { dx?: number; dy?: number } | null;
  return step ? { x: s.player.x + (step.dx ?? 0), y: s.player.y + (step.dy ?? 0) } : { x: s.player.x, y: s.player.y };
}

/** Why the game took the player out of plain walking, if it did. */
export function interruption(start: StateLite, s: StateLite): Stop | null {
  if (s.mapId !== start.mapId) return "map";
  if (s.mode === "battle") return "battle";
  if (s.mode === "dialog") return "text";
  return null;
}

/** One leg of a walk: `steps` steps toward `direction`, counted from the cell the player is headed for at the start. */
export class Leg {
  readonly direction: Direction;
  readonly steps: number;
  readonly start: StateLite;
  readonly stepFrames: number;
  /** Where the leg counts from: the start's heading, unless the last leg was let go of by the clock. */
  readonly base: { x: number; y: number };
  readonly dir: { dx: number; dy: number };
  /** Steps of this leg under way or done. */
  progress = 0;
  #lastActive: number;

  constructor(direction: Direction, steps: number, start: StateLite, frames: number, stepFrames: number, base = heading(start)) {
    this.direction = direction;
    this.steps = steps;
    this.start = start;
    this.stepFrames = stepFrames;
    this.base = base;
    this.dir = DIRS[direction];
    this.#lastActive = frames;
  }

  /** "hold" the stick, "done" (the leg's last step is under way: move on), or why it stopped. */
  sample(s: StateLite | null, frames: number): "hold" | "done" | Stop {
    if (!s) return "hold";
    const why = interruption(this.start, s);
    if (why) return why;
    const at = heading(s);
    const progress = Math.max(0, (at.x - this.base.x) * this.dir.dx + (at.y - this.base.y) * this.dir.dy);
    // Stepping, a fade (a warp on its way) or progress all mean something is still happening.
    if (progress > this.progress || s.player.step || s.fade !== 0) this.#lastActive = frames;
    this.progress = Math.max(this.progress, progress);
    if (this.progress >= this.steps) return "done";
    if (frames - this.#lastActive > stallFrames(this.stepFrames)) return "blocked";
    return "hold";
  }

  /**
   * Emulated frames from this sample until the middle of the leg's last step, when letting go
   * (or turning) gives exactly `steps` steps; null unless a step of this leg is under way.
   */
  framesToRelease(s: StateLite): number | null {
    const step = s.player.step as { progress?: number } | null;
    if (!step || this.progress < 1 || this.progress >= this.steps) return null;
    const into = (step.progress ?? 0) * this.stepFrames;
    // The step under way is this leg's `progress`th; the last one starts (steps - progress) steps later.
    return (this.steps - this.progress) * this.stepFrames - into + this.stepFrames / 2;
  }

  /** Where the next leg counts from when this one was let go of by the clock (its last step not seen yet). */
  get end(): { x: number; y: number } {
    return { x: this.base.x + this.dir.dx * this.steps, y: this.base.y + this.dir.dy * this.steps };
  }
}

/**
 * Steps along a run of samples (the walk's, then the settled state after it): the distance
 * between the cells the player is headed for, sample to sample, until the map changes. Every step
 * is one cell (a ledge hop two), so this counts them however late the samples come, so long as the
 * player doesn't turn back on themselves between two samples.
 */
export function countSteps(samples: readonly (StateLite | null)[]): number {
  let prev: StateLite | null = null;
  let n = 0;
  for (const s of samples) {
    if (!s) continue;
    if (prev && s.mapId !== prev.mapId) break;
    if (prev) {
      const a = heading(prev);
      const b = heading(s);
      n += Math.abs(b.x - a.x) + Math.abs(b.y - a.y);
    }
    prev = s;
  }
  return n;
}

export interface WalkSummary {
  asked: number;
  walked: number;
  /** Why the walk ended early, if it did. */
  stop: Stop | null;
  /** The direction being walked when it stopped. */
  direction: Direction;
  /** For "blocked": what's in the way (from the text map), or null when nothing visible is. */
  blocker: string | null;
}

const REASONS: Record<Exclude<Stop, "blocked" | "stalled">, string> = {
  battle: "a battle started",
  text: "text came up",
  map: "the map changed",
};

/** The line the player gets about how far the joystick took them; empty when it went as asked. */
export function walkNote(w: WalkSummary): string {
  if (w.walked > w.asked) return `You moved ${w.walked} steps (you asked for ${w.asked}).`;
  if (w.walked === w.asked) return "";
  const moved = w.walked === 0 ? "You didn't move" : `You moved ${w.walked} of ${w.asked} steps`;
  if (w.stop === "battle" || w.stop === "text" || w.stop === "map") return `${moved}: ${REASONS[w.stop]}.`;
  if (w.stop === "blocked" && w.blocker) return `${moved}: ${w.blocker} is in the way going ${w.direction}.`;
  return `${moved}; something stopped you going ${w.direction}.`;
}
