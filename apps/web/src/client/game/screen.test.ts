import { describe, expect, it } from "vitest";
import { inWorldTracker, mapOnlyTracker, screenLayout } from "./screen.ts";

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

  it("keeps the screen down either side of a battle, while the game plays its transition", () => {
    expect(screenLayout("dialog", true, false, false, "transition")).toBe("hidden");
    expect(screenLayout("dialog", true, true, false, "transition")).toBe("corner");
    expect(screenLayout("overworld", true, true, false, "transition")).toBe("corner");
    expect(screenLayout("dialog", false, false, false, "transition")).toBe("full");
  });

  it("stays out of the way while the HD text layer shows the text", () => {
    expect(screenLayout("dialog", true, false, true)).toBe("hidden");
    expect(screenLayout("dialog", true, true, true)).toBe("corner");
    expect(screenLayout("battle", true, false, true)).toBe("full");
  });

  it("puts battles in HD once there's an HD view to show them in", () => {
    expect(screenLayout("battle", true, false, false, "transition")).toBe("hidden");
    expect(screenLayout("battle", true, true, false, "scene")).toBe("battle");
    expect(screenLayout("battle", true, false, false, "menu")).toBe("full");
    expect(screenLayout("battle", false, false, false, "scene")).toBe("full");
  });

  it("stages the evolution screen in HD, after a battle or from an evolution stone (QA bug 27)", () => {
    expect(screenLayout("battle", true, false, true, "evolution")).toBe("battle");
    expect(screenLayout("battle", true, true, false, "evolution")).toBe("battle");
    expect(screenLayout("dialog", true, false, false, "evolution")).toBe("battle");
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

  it("starts in the world after a resume point, until a reset", () => {
    const track = inWorldTracker(true);
    expect(track(at([4, 4, 4]))).toBe(true);
    expect(track(at([0, 0, 0]))).toBe(false);
    expect(track(at([4, 4, 4]))).toBe(false);
  });

  it("ends when the game resets", () => {
    const track = inWorldTracker();
    track(at([0, 0, 0]));
    track(at([4, 4, 4], ENTERED));
    expect(track(at([4, 4, 0]))).toBe(false);
    expect(track(at([4, 4, 4]))).toBe(false);
  });
});

describe("mapOnlyTracker", () => {
  // A 20×18 screen buffer: the lab's floor, then the message box drawn over it.
  const lab = () => new Uint8Array(360).fill(0x11);
  const withBox = () => {
    const b = lab().fill(0x7f, 12 * 20, 18 * 20);
    b[12 * 20] = 0x79; // ┌
    return b;
  };

  it("keeps the screen down while the window shows the map as it was (Oak's lab, before its box)", () => {
    const track = mapOnlyTracker();
    expect(track(lab(), "overworld", true)).toBe(false);
    // DisplayTextIDInit puts the window up over the plain map; the font loads for ~17 frames.
    for (let i = 0; i < 17; i++) {
      const mapOnly = track(lab(), "dialog", true);
      expect(mapOnly).toBe(true);
      expect(screenLayout("dialog", true, false, mapOnly)).toBe("hidden");
    }
    // PrintText draws the box: the text layer decides from here.
    expect(track(withBox(), "dialog", true)).toBe(false);
  });

  it("lets anything drawn over the map through", () => {
    const track = mapOnlyTracker();
    track(lab(), "overworld", true);
    expect(track(lab().fill(0x20, 0, 40), "dialog", true)).toBe(false);
  });

  it("compares with the map as it last stood, after the player moves", () => {
    const track = mapOnlyTracker();
    track(lab(), "overworld", true);
    const moved = lab().fill(0x2a, 0, 20);
    track(moved, "overworld", true);
    expect(track(lab(), "dialog", true)).toBe(false);
    expect(track(moved, "dialog", true)).toBe(true);
  });

  it("needs a map seen in the world first: not after a reset, a battle or a resume into a text", () => {
    expect(mapOnlyTracker()(lab(), "dialog", true)).toBe(false);
    const track = mapOnlyTracker();
    track(lab(), "overworld", true);
    track(lab(), "battle", true);
    expect(track(lab(), "dialog", true)).toBe(false);
    track(lab(), "overworld", true);
    track(lab(), "overworld", false);
    expect(track(lab(), "dialog", true)).toBe(false);
  });
});
