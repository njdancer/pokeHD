import { describe, expect, it } from "vitest";
import { inWorldTracker, screenLayout } from "./screen.ts";

describe("screenLayout", () => {
  it("shows the full screen until a map has loaded, and in battle", () => {
    expect(screenLayout("overworld", false, true)).toBe("full");
    expect(screenLayout("dialog", false, false)).toBe("full");
    expect(screenLayout("battle", true, false)).toBe("full");
  });

  it("raises the screen for text and menus, whatever the picture-in-picture choice", () => {
    expect(screenLayout("dialog", true, false)).toBe("dialog");
    expect(screenLayout("dialog", true, true)).toBe("dialog");
  });

  it("follows the player's choice on the overworld", () => {
    expect(screenLayout("overworld", true, true)).toBe("corner");
    expect(screenLayout("overworld", true, false)).toBe("hidden");
  });
});

describe("inWorldTracker", () => {
  const at = (header: number[], flags = 0) => ({ mapHeader: new Uint8Array(header), mapScriptFlags: new Uint8Array([flags]) });
  const ENTERED = 0b0110_0000;

  it("ignores whatever WRAM holds before the game clears it", () => {
    const track = inWorldTracker();
    expect(track(at([4, 4, 4], ENTERED))).toBe(false);
    expect(track(at([0, 0, 0]))).toBe(false);
    expect(track(at([4, 4, 4], ENTERED))).toBe(true);
  });

  it("waits for the game to enter the map, not the main menu's save preview", () => {
    const track = inWorldTracker();
    track(at([0, 0, 0]));
    expect(track(at([4, 4, 4]))).toBe(false);
    expect(track(at([4, 4, 4], 0b0010_0000))).toBe(false); // the Continue screen
    expect(track(at([4, 4, 4], ENTERED))).toBe(true);
    // Map scripts clear the flags once they've run; the player is still in the world.
    expect(track(at([4, 4, 4]))).toBe(true);
  });

  it("ends when the game resets", () => {
    const track = inWorldTracker();
    track(at([0, 0, 0]));
    track(at([4, 4, 4], ENTERED));
    expect(track(at([4, 4, 0]))).toBe(false);
    expect(track(at([4, 4, 4]))).toBe(false);
  });
});
