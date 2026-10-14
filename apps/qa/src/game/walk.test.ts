import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StateLite } from "./screen-read.ts";
import { countSteps, MapEntry, stallFrames, walkNote, walkPath, type PathArg, type PathResult } from "./walk.ts";

type Dir = { dx: number; dy: number };

/**
 * The game's walking, frame by frame: a step takes 16 frames; on the frame one ends (and when
 * standing) the game looks at the pad and, with a direction held, starts the next. The
 * coordinates change on a step's last frame, and the decoder shows no step on its first.
 */
class Walker {
  x = 10;
  y = 10;
  mapId = 59;
  mode: StateLite["mode"] = "overworld";
  /** The palette's shade: a dark cave without Flash holds it two thirds down. */
  fade = 0;
  frames = 0;
  #f = -1;
  #dir: Dir = { dx: 0, dy: 0 };
  #held: Dir | null = null;
  #queue: { at: number; held: Dir | null }[] = [];
  walls = new Set<string>();

  /** The pad as the emulator will see it `latency` frames from now. */
  hold(held: Dir | null, latency: number) {
    this.#queue.push({ at: this.frames + latency, held });
  }

  tick() {
    this.frames++;
    while (this.#queue[0] && this.#queue[0].at <= this.frames) this.#held = this.#queue.shift()!.held;
    if (this.#f >= 0 && ++this.#f >= 16) {
      this.x += this.#dir.dx;
      this.y += this.#dir.dy;
      this.#f = -1;
    }
    const h = this.#held;
    if (this.#f < 0 && h && !this.walls.has(`${this.x + h.dx},${this.y + h.dy}`)) {
      this.#dir = h;
      this.#f = 0;
    }
  }

  get state(): StateLite {
    const step = this.#f >= 1 ? { ...this.#dir, progress: this.#f / 16 } : null;
    return { mode: this.mode, mapId: this.mapId, fade: this.fade, player: { x: this.x, y: this.y, facing: "up", step }, npcs: [] };
  }
}

/**
 * A busy page: its main thread sees the game's state only every `burst` frames, and a move of the
 * thumb reaches the emulator `latency` frames later.
 */
function page(game: Walker, burst: number, latency: number, onFrame?: (g: Walker) => void, rogue?: { dir: Dir; late: number }) {
  const centre = { x: 100, y: 100 };
  const listeners: ((e: { target: unknown; pointerId: number }) => void)[] = [];
  let moves = 0;
  const stick = {
    contains: () => true,
    dispatchEvent(e: { type: string; clientX: number; clientY: number }) {
      const dir = e.type === "pointerup" ? null : { dx: Math.sign(e.clientX - centre.x), dy: Math.sign(e.clientY - centre.y) };
      game.hold(dir && (dir.dx || dir.dy) ? dir : null, latency);
      // Something else moving the thumb back after the first turn (as the harness's own slide could).
      if (dir && ++moves === 2 && rogue) game.hold(rogue.dir, latency + rogue.late);
      return true;
    },
  };
  vi.stubGlobal("document", { querySelector: () => stick, addEventListener: (_: string, fn: (typeof listeners)[number]) => listeners.push(fn) });
  vi.stubGlobal(
    "PointerEvent",
    class {
      readonly type: string;
      constructor(type: string, init: object) {
        this.type = type;
        Object.assign(this, init);
      }
    },
  );
  vi.stubGlobal("__pokehd", {
    get state() {
      for (let i = 0; i < burst; i++) {
        game.tick();
        onFrame?.(game);
      }
      return game.state;
    },
    get frames() {
      return game.frames;
    },
  });
  return {
    async walk(legs: PathArg["legs"]): Promise<PathResult> {
      delete (globalThis as { __qaStickArmed?: boolean }).__qaStickArmed; // a new fake document
      expect(walkPath({ legs, centre, reach: 40, stall: stallFrames(16), idleMs: 2000, maxMs: 30_000 })).toBe(true);
      // The touch goes down on the stick's centre (walkPath leans it).
      for (const fn of listeners) fn({ target: stick, pointerId: 3 });
      const result = await (globalThis as typeof globalThis & { __qaWalk: Promise<PathResult> }).__qaWalk;
      for (let i = 0; i < 64; i++) game.tick(); // whatever the game does next on its own
      return result;
    },
  };
}

const up = (steps: number) => ({ dx: 0, dy: -1, steps });
const left = (steps: number) => ({ dx: -1, dy: 0, steps });

describe("walkPath", () => {
  beforeEach(() => {
    delete (globalThis as { __qaStickArmed?: boolean }).__qaStickArmed;
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("takes exactly the steps asked for, on a page that sees the game only every few frames", async () => {
    for (const steps of [1, 2, 5, 8]) {
      for (const [burst, latency] of [
        [1, 0],
        [6, 4],
        [8, 6],
      ] as const) {
        const game = new Walker();
        const result = await page(game, burst, latency).walk([up(steps)]);
        expect(result.end).toBe("done");
        expect([game.x, game.y, steps, burst]).toEqual([10, 10 - steps, steps, burst]);
        expect(countSteps([...result.trail, game.state])).toBe(steps);
      }
    }
  });

  it("turns between legs without a step too many or too few", async () => {
    const game = new Walker();
    const result = await page(game, 6, 4).walk([up(3), left(2), up(1)]);
    expect(result).toMatchObject({ end: "done", leg: 3 });
    expect([game.x, game.y]).toEqual([8, 6]);
    expect(countSteps([...result.trail, game.state])).toBe(6);
  });

  it("lets go at once when the thumb is moved back the old way after a turn", async () => {
    // Up 2 then left 4, with something leaning the thumb up again just after the turn: without the
    // fail safe the player walks up until a wall stops them.
    const game = new Walker();
    const result = await page(game, 6, 4, undefined, { dir: { dx: 0, dy: -1 }, late: 2 }).walk([up(2), left(4)]);
    expect(result.end).toBe("astray");
    const steps = countSteps([...result.trail, game.state]);
    expect(steps).toBeLessThanOrEqual(6);
    expect(game.y).toBeGreaterThanOrEqual(7);
  });

  it("stops at a wall, after the game has run a while without a step", async () => {
    const game = new Walker();
    game.walls.add("10,8");
    const result = await page(game, 6, 4).walk([up(4)]);
    expect(result).toMatchObject({ end: "blocked", leg: 0 });
    expect([game.x, game.y]).toEqual([10, 9]);
  });

  it("stops at a wall in a dark cave, whose dim palette holds still (Rock Tunnel hang)", async () => {
    for (const run of [false, true]) {
      const game = new Walker();
      game.fade = 2 / 3;
      game.walls.add("10,8");
      const result = await page(game, 6, 4).walk([{ ...up(run ? 40 : 4), run }]);
      expect(result.end).toBe(run ? "done" : "blocked");
      expect([game.x, game.y]).toEqual([10, 9]);
    }
  });

  it("lets go when the harness says stop", async () => {
    const game = new Walker();
    const p = page(game, 1, 0, (g) => {
      if (g.frames === 40) (globalThis as { __qaWalkStop?: boolean }).__qaWalkStop = true;
    });
    const result = await p.walk([up(20)]);
    expect(result.end).toBe("stalled");
  });

  it("runs a leg until something stops it, then carries on with the next", async () => {
    const game = new Walker();
    game.walls.add("10,6");
    const result = await page(game, 6, 4).walk([{ ...up(40), run: true }, left(2)]);
    expect(result).toMatchObject({ end: "done", ran: [{ leg: 0, steps: 3, x: 10, y: 7 }] });
    expect([game.x, game.y]).toEqual([8, 7]);
  });

  it("ends a walk that finishes on a run as done, where it stopped", async () => {
    const game = new Walker();
    game.walls.add("7,9");
    const result = await page(game, 6, 4).walk([up(1), { ...left(40), run: true }]);
    expect(result).toMatchObject({ end: "done", ran: [{ leg: 1, steps: 2 }] });
    expect([game.x, game.y]).toEqual([8, 9]);
  });

  it("lets go when a battle starts", async () => {
    const game = new Walker();
    const result = await page(game, 3, 2, (g) => {
      if (g.y === 8) g.mode = "battle";
    }).walk([up(5)]);
    expect(result.end).toBe("battle");
  });
});

const at = (x: number, y: number, step: { dx: number; dy: number; progress: number } | null = null, more: Partial<StateLite> = {}): StateLite => ({
  mode: "overworld",
  mapId: 59,
  fade: 0,
  player: { x, y, facing: "up", step },
  npcs: [],
  ...more,
});

describe("countSteps", () => {
  it("counts every cell however few samples there were", () => {
    expect(countSteps([at(5, 10), at(5, 8, { dx: 0, dy: -1, progress: 0.5 }), at(4, 7)])).toBe(4);
  });
  it("stops at a map change and skips missing samples", () => {
    expect(countSteps([at(5, 10), null, at(5, 9), at(1, 1, null, { mapId: 60 })])).toBe(1);
  });
});

describe("walkNote", () => {
  const note = (walked: number, stop: Parameters<typeof walkNote>[0]["stop"], blocker: string | null = null) => walkNote({ asked: 4, walked, stop, direction: "up", blocker });
  it("says nothing when the walk went as asked", () => {
    expect(note(4, null)).toBe("");
    expect(note(4, "battle")).toBe("");
  });
  it("gives the reason a walk was short", () => {
    expect(note(0, "blocked", "a wall")).toBe("You didn't move: a wall is in the way going up.");
    expect(note(2, "battle")).toBe("You moved 2 of 4 steps: a battle started.");
    expect(note(1, "text")).toBe("You moved 1 of 4 steps: text came up.");
    expect(note(3, "map")).toBe("You moved 3 of 4 steps: the map changed.");
    expect(note(2, "blocked")).toBe("You moved 2 of 4 steps; something stopped you going up.");
  });
  it("owns up to going too far, and to the harness letting go", () => {
    expect(note(5, null)).toBe("You moved 5 steps (you asked for 4).");
    expect(note(3, "astray")).toBe("You moved 3 steps of the 4 you asked for: the joystick went a way you didn't ask for, so the harness let go (a harness problem).");
  });
});

describe("MapEntry", () => {
  const at = (mapId: number, x: number, y: number): StateLite => ({ mode: "overworld", mapId, fade: 0, player: { x, y, facing: "down", step: null }, npcs: [] });
  it("measures from where the player came into the map, and starts again on a new one", () => {
    const e = new MapEntry();
    e.see(at(1, 5, 5));
    expect(e.line(at(1, 5, 5))).toBe("You're where you came into this map (or started).");
    expect(e.line(at(1, 8, 2))).toBe("You're 3 north and 3 east of where you came into this map (or started).");
    expect(e.line(at(2, 0, 9))).toBe("You're where you came into this map (or started).");
    expect(e.line(at(2, 0, 10))).toBe("You're 1 south of where you came into this map (or started).");
  });
});
