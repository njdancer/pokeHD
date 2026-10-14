import { describe, expect, it } from "vitest";
import type { StateLite } from "./screen-read.ts";
import { countSteps, Leg, stallFrames, walkNote } from "./walk.ts";

type Step = { dx: number; dy: number; progress: number } | null;
const at = (x: number, y: number, step: Step = null, more: Partial<StateLite> = {}): StateLite => ({
  mode: "overworld",
  mapId: 59,
  fade: 0,
  player: { x, y, facing: "up", step },
  npcs: [],
  ...more,
});
const up = (progress: number): Step => ({ dx: 0, dy: -1, progress });

describe("Leg", () => {
  it("lets go once the last step is under way, counting the step being taken", () => {
    const leg = new Leg("up", 2, at(5, 10), 0, 16);
    expect(leg.sample(at(5, 10, up(0.5)), 8)).toBe("hold");
    // The coordinates change only on a step's last frame; mid-step 2 the player is still at y 9.
    expect(leg.sample(at(5, 9, up(0.25)), 20)).toBe("done");
    expect(leg.progress).toBe(2);
  });

  it("doesn't count the last leg's step, still finishing, toward the next leg", () => {
    // Turning left while the up leg's last step finishes (y 10 → 9): that step isn't the left leg's.
    const leg = new Leg("left", 1, at(5, 10, up(0.5)), 100, 16);
    expect(leg.sample(at(5, 9), 108)).toBe("hold");
    expect(leg.progress).toBe(0);
    expect(leg.sample(at(5, 9, { dx: -1, dy: 0, progress: 0.25 }), 112)).toBe("done");
  });

  it("calls it blocked only after the game has run a while with no step, however slow the page", () => {
    const leg = new Leg("up", 3, at(5, 10), 1000, 16);
    expect(leg.sample(at(5, 10), 1000 + stallFrames(16))).toBe("hold");
    expect(leg.sample(at(5, 10), 1001 + stallFrames(16))).toBe("blocked");
  });

  it("names a battle, text or a new map as the reason it stopped", () => {
    const leg = () => new Leg("up", 3, at(5, 10), 0, 16);
    expect(leg().sample(at(5, 9, null, { mode: "battle" }), 30)).toBe("battle");
    expect(leg().sample(at(5, 9, null, { mode: "dialog" }), 30)).toBe("text");
    expect(leg().sample(at(3, 3, null, { mapId: 60 }), 30)).toBe("map");
  });

  it("times the release for the middle of the last step", () => {
    const leg = new Leg("up", 3, at(5, 10), 0, 16);
    const s = at(5, 10, up(0.5));
    leg.sample(s, 8);
    // Step 1 is half done: 8 frames to its end, 16 for step 2, then half of step 3.
    expect(leg.framesToRelease(s)).toBe(8 + 16 + 8);
    expect(leg.end).toEqual({ x: 5, y: 7 });
  });
});

describe("countSteps", () => {
  it("counts every cell however few samples there were", () => {
    expect(countSteps([at(5, 10), at(5, 8, up(0.5)), at(4, 7)])).toBe(4);
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
  it("owns up to going too far", () => {
    expect(note(5, null)).toBe("You moved 5 steps (you asked for 4).");
  });
});
