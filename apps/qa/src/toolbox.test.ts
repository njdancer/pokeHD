import { describe, expect, it } from "vitest";
import { parseMoves } from "./toolbox.ts";

describe("parseMoves", () => {
  it("groups repeated arrows into runs, in order", () => {
    expect(parseMoves("↑↑→→→↓")).toEqual([
      { direction: "up", tiles: 2 },
      { direction: "right", tiles: 3 },
      { direction: "down", tiles: 1 },
    ]);
  });
  it("takes letters and words too", () => {
    expect(parseMoves("UUr l")).toEqual([{ direction: "up", tiles: 2 }, { direction: "right", tiles: 1 }, { direction: "left", tiles: 1 }]);
    expect(parseMoves("up, up, left")).toEqual([{ direction: "up", tiles: 2 }, { direction: "left", tiles: 1 }]);
  });
  it("explains what it can't read", () => {
    expect(parseMoves("↑x")).toMatch(/"x"/);
    expect(parseMoves("")).toMatch(/at least one/);
    expect(parseMoves("→".repeat(41))).toMatch(/41 steps/);
  });
});
