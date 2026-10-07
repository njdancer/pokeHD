import { describe, expect, it } from "vitest";
import { mapLoaded, screenLayout } from "./screen.ts";

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

describe("mapLoaded", () => {
  it("needs both map dimensions", () => {
    expect(mapLoaded({ mapHeader: new Uint8Array([0, 0, 0]) })).toBe(false);
    expect(mapLoaded({ mapHeader: new Uint8Array([4, 4, 0]) })).toBe(false);
    expect(mapLoaded({ mapHeader: new Uint8Array([4, 4, 4]) })).toBe(true);
  });
});
