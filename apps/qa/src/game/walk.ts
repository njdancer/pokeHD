// Following a joystick walk step by step from the decoded state, so the thumb turns or lets go at
// the right moment, and saying afterwards how far the player got and, when it was short, why.
//
// The game decides whether to take another step on the frame a step ends: if a direction is held
// then, the next step starts. So to take exactly N steps, the thumb must come off (or turn) after
// the Nth step has begun and before it ends: a window of one step, 16 emulated frames (8 on the
// bike), about a quarter of a second. Watching from the harness (a read across Playwright, then a
// touch back through the browser) costs two trips through a busy machine, often more than that
// window, so the walk overshot. `walkPath` runs in the game's page instead: it checks every state
// the emulator posts and moves the thumb in the same tick, by pointer events on the joystick, the
// same events the touch itself makes. Timing is in emulated frames, never wall time.
import type { StateLite } from "./screen-read.ts";
import type { Direction } from "./types.ts";

export const DIRS: Record<Direction, { dx: number; dy: number }> = { up: { dx: 0, dy: -1 }, down: { dx: 0, dy: 1 }, left: { dx: -1, dy: 0 }, right: { dx: 1, dy: 0 } };

/** Why a walk ended before it was done. */
export type Stop = "battle" | "text" | "map" | "blocked" | "stalled" | "astray";

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

export interface PathArg {
  /** Each leg: a direction and how many steps; a run leg goes on until something stops it. */
  legs: { dx: number; dy: number; steps: number; run?: boolean }[];
  /** The joystick's centre, where the touch went down, and how far the thumb leans (frame CSS px). */
  centre: { x: number; y: number };
  reach: number;
  /** See `stallFrames`. */
  stall: number;
  /** Wall time with no emulated frame at all before giving up (the game stopped running). */
  idleMs: number;
}

export interface PathResult {
  end: "done" | Stop;
  /** The leg it ended on. */
  leg: number;
  /** The player's state each time the cell they're headed for changed (and the first and last). */
  trail: StateLite[];
  /** Each run leg that ended: how far it went and where it stopped. */
  ran?: { leg: number; steps: number; x: number; y: number }[];
}

interface WalkHook {
  readonly state: StateLite | null;
  readonly frames: number;
}

/**
 * Runs in the game's page (serialised by Playwright: self-contained, no outer names). Call it
 * before the touch goes down on the stick's centre: it notes the touch's pointer and leans the
 * thumb toward the first leg, then follows the walk and stores its promise as `__qaWalk`. At each
 * leg's last step it leans the thumb to the next leg's direction, and after the last leg (or
 * anything that stops the walk) it lifts it. Any step the walk didn't ask for (the wrong way, or
 * one too many) lifts it at once ("astray"). Returns false when the page has no state to follow.
 */
export function walkPath(arg: PathArg): boolean {
  type G = typeof globalThis & { __pokehd?: WalkHook; __qaWalk?: Promise<PathResult>; __qaStickPointer?: number; __qaStickArmed?: boolean };
  const g = globalThis as G;
  const hook = g.__pokehd;
  const first = hook?.state;
  if (!hook || !first) return false;
  const stickEl = () => document.querySelector('[aria-label="Joystick"]');
  if (!g.__qaStickArmed) {
    g.__qaStickArmed = true;
    document.addEventListener(
      "pointerdown",
      (e) => {
        const target = e.target as Node | null;
        if (target && stickEl()?.contains(target)) g.__qaStickPointer = e.pointerId;
      },
      true,
    );
  }
  const thumb = (to: { dx: number; dy: number } | null) => {
    const el = stickEl();
    const pointerId = g.__qaStickPointer;
    if (!el || pointerId === undefined) return;
    const x = arg.centre.x + (to ? to.dx * arg.reach : 0);
    const y = arg.centre.y + (to ? to.dy * arg.reach : 0);
    el.dispatchEvent(new PointerEvent(to ? "pointermove" : "pointerup", { pointerId, pointerType: "touch", isPrimary: true, bubbles: true, clientX: x, clientY: y }));
  };
  const at = (s: StateLite) => {
    const step = s.player.step as { dx?: number; dy?: number } | null;
    return { x: s.player.x + (step?.dx ?? 0), y: s.player.y + (step?.dy ?? 0) };
  };
  const lite = (s: StateLite): StateLite => ({ mode: s.mode, mapId: s.mapId, fade: s.fade, player: { ...s.player }, npcs: [] });
  const trail: StateLite[] = [lite(first)];
  const asked = arg.legs.reduce((n, l) => n + l.steps, 0);
  // This walk's touch is the next one to go down on the stick.
  g.__qaStickPointer = undefined;
  g.__qaWalk = (async (): Promise<PathResult> => {
    let leg = 0;
    let base = at(first);
    let best = 0;
    let lastFrames = hook.frames;
    let lastActive = hook.frames;
    let ranAt = Date.now();
    let leaned = false;
    let prev = base;
    let moved = 0;
    const ran: NonNullable<PathResult["ran"]> = [];
    const finish = (end: PathResult["end"]): PathResult => {
      thumb(null);
      const s = hook.state;
      if (s) trail.push(lite(s));
      return { end, leg, trail, ran };
    };
    for (;;) {
      // The touch is down: lean toward the first leg. Every move of the thumb from here on is
      // walkPath's, in order (a slide from the harness could land after a turn and undo it).
      if (!leaned && g.__qaStickPointer !== undefined) {
        leaned = true;
        thumb(arg.legs[0]!);
        lastActive = hook.frames;
      }
      const s = hook.state;
      const frames = hook.frames;
      if (frames !== lastFrames && s) {
        lastFrames = frames;
        ranAt = Date.now();
        const h = at(s);
        if (s.mapId !== first.mapId) return finish("map");
        const l = arg.legs[leg]!;
        if (h.x !== prev.x || h.y !== prev.y) {
          trail.push(lite(s));
          const along = (h.x - prev.x) * l.dx + (h.y - prev.y) * l.dy;
          moved++; // one step (a ledge hop moves two cells in one)
          prev = h;
          // Fail safe: a step the walk didn't ask for (the wrong way, or past the last one) means
          // the thumb isn't where it should be: let go at once.
          if (along <= 0 || moved > asked) return finish("astray");
        }
        if (s.mode === "battle") return finish("battle");
        if (s.mode === "dialog") return finish("text");
        const progress = Math.max(0, (h.x - base.x) * l.dx + (h.y - base.y) * l.dy);
        // Stepping, a fade (a warp on its way) or progress all mean something is still happening.
        if (progress > best || s.player.step || s.fade !== 0) lastActive = frames;
        best = Math.max(best, progress);
        if (best >= l.steps) {
          // The leg's last step is under way: turn now, or let go after the last leg.
          leg++;
          const next = arg.legs[leg];
          if (!next) return finish("done");
          thumb(next);
          base = { x: base.x + l.dx * l.steps, y: base.y + l.dy * l.steps };
          best = 0;
          lastActive = frames;
          continue;
        }
        if (frames - lastActive > arg.stall) {
          if (!l.run) return finish("blocked");
          // A run leg ends where something stopped it; the walk goes on from there.
          ran.push({ leg, steps: best, x: h.x, y: h.y });
          leg++;
          const next = arg.legs[leg];
          if (!next) {
            leg--;
            return finish("done");
          }
          thumb(next);
          base = h;
          best = 0;
          lastActive = frames;
          continue;
        }
      }
      if (Date.now() - ranAt > arg.idleMs) return finish("stalled");
      await new Promise((r) => setTimeout(r, 1));
    }
  })();
  return true;
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

const REASONS: Record<Exclude<Stop, "blocked" | "stalled" | "astray">, string> = {
  battle: "a battle started",
  text: "text came up",
  map: "the map changed",
};
/** The harness's own slip, said plainly so the player can report it (tag "harness"). */
const ASTRAY = "the joystick went a way you didn't ask for, so the harness let go (a harness problem)";

/** The line the player gets about how far the joystick took them; empty when it went as asked. */
export function walkNote(w: WalkSummary): string {
  if (w.stop === "astray") return `You moved ${w.walked} step${w.walked === 1 ? "" : "s"} of the ${w.asked} you asked for: ${ASTRAY}.`;
  if (w.walked > w.asked) return `You moved ${w.walked} steps (you asked for ${w.asked}).`;
  if (w.walked === w.asked) return "";
  const moved = w.walked === 0 ? "You didn't move" : `You moved ${w.walked} of ${w.asked} steps`;
  if (w.stop === "battle" || w.stop === "text" || w.stop === "map") return `${moved}: ${REASONS[w.stop]}.`;
  if (w.stop === "blocked" && w.blocker) return `${moved}: ${w.blocker} is in the way going ${w.direction}.`;
  return `${moved}; something stopped you going ${w.direction}.`;
}

/**
 * Where the player is from where they came into the map they're on: a fixed origin across turns,
 * since the text map recentres on every step. The live player asked for one ("the text map
 * recentres after every move, so I can't keep absolute coordinates"), and in the movement eval
 * the line took multi-turn goals from 82% to 90% in fewer turns. A person could count the same
 * steps; it says nothing the screen hasn't shown.
 */
export class MapEntry {
  #map = -1;
  #x = 0;
  #y = 0;

  /** Notes the state; on a map not seen last time, here is where the player came in. */
  see(s: StateLite): void {
    if (s.mapId === this.#map) return;
    this.#map = s.mapId;
    this.#x = s.player.x;
    this.#y = s.player.y;
  }

  /** "You're 5 north and 3 east of where you came into this map (or started)." */
  line(s: StateLite): string {
    this.see(s);
    const dx = s.player.x - this.#x;
    const dy = s.player.y - this.#y;
    const parts = [dy ? `${Math.abs(dy)} ${dy < 0 ? "north" : "south"}` : "", dx ? `${Math.abs(dx)} ${dx < 0 ? "west" : "east"}` : ""].filter(Boolean);
    return parts.length ? `You're ${parts.join(" and ")} of where you came into this map (or started).` : "You're where you came into this map (or started).";
  }
}
