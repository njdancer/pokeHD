import { describe, expect, it } from "vitest";
import type { OverworldState } from "@pokehd/emu";
import { toGhosts, toPresence } from "./presence.ts";

const state: OverworldState = {
  mode: "overworld",
  mapId: 12,
  lastMap: 0,
  player: { x: 10, y: 20, facing: "up", step: { dx: 0, dy: -1, progress: 0.5 }, animFrame: 1, transport: "walk" },
  npcs: [],
  fade: 0,
  palettes: { bgp: 0xe4, obp0: 0xd0, obp1: 0xe0 },
};

describe("toPresence", () => {
  it("is null until a map has loaded", () => {
    expect(toPresence(state, false)).toBeNull();
  });

  it("carries the player's half of the state", () => {
    expect(toPresence(state, true)).toEqual({
      mapId: 12, x: 10, y: 20, facing: "up", step: { dx: 0, dy: -1, progress: 0.5 }, animFrame: 1, transport: "walk", mode: "overworld",
    });
  });
});

describe("toGhosts", () => {
  it("draws friends with a presence and skips the rest", () => {
    const presence = toPresence(state, true);
    expect(toGhosts({
      a: { id: "a", name: "Ash", presence },
      b: { id: "b", name: "Gary", presence: null },
    })).toEqual([{ id: "a", name: "Ash", mapId: 12, x: 10, y: 20, step: { dx: 0, dy: -1, progress: 0.5 }, animFrame: 1 }]);
  });
});
