import { describe, expect, it } from "vitest";
import { playerName } from "./player.ts";

describe("playerName", () => {
  it("names the player from the model", () => {
    expect(playerName("claude-haiku-5-5")).toBe("Haiku 5.5");
    expect(playerName("claude-sonnet-5-5")).toBe("Sonnet 5.5");
    expect(playerName("claude-opus-5")).toBe("Opus 5");
    expect(playerName("claude-sonnet-4-5-20250929")).toBe("Sonnet 4.5");
    expect(playerName("something-else")).toBe("something-else");
  });
});
