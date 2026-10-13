import { describe, expect, it } from "vitest";
import { CELL_HUD, CELL_SCENE, CELL_UI, TEXT_WATCHES, type BattleScreen, type TextWatched } from "@pokehd/emu";
import { barColour, battleText, maskBattleScreen } from "./battle.ts";

describe("maskBattleScreen", () => {
  const screen = (origin = { x: 0, y: 0 }): BattleScreen => {
    const cells = new Uint8Array(360).fill(CELL_SCENE);
    cells.fill(CELL_UI, 12 * 20); // the text box
    return {
      battle: true, enemy: null, player: null, objects: [], cells, huds: { enemy: false, player: false },
      palettes: [0xe4, 0xe4, 0xe4], origin,
    };
  };
  const alpha = (data: Uint8ClampedArray, x: number, y: number) => data[(y * 160 + x) * 4 + 3];

  it("keeps only text and menu cells", () => {
    const data = new Uint8ClampedArray(160 * 144 * 4).fill(255);
    maskBattleScreen(data, screen());
    expect(alpha(data, 10, 10)).toBe(0);
    expect(alpha(data, 10, 12 * 8)).toBe(255);
  });

  it("clears the boxes the HD text layer draws", () => {
    const data = new Uint8ClampedArray(160 * 144 * 4).fill(255);
    maskBattleScreen(data, screen(), [{ x: 0, y: 12, width: 20, height: 6, lines: [] }]);
    expect(alpha(data, 10, 12 * 8)).toBe(0);
    expect(alpha(data, 159, 143)).toBe(0);
  });

  it("moves the mask with the screen when the game shakes it", () => {
    const data = new Uint8ClampedArray(160 * 144 * 4).fill(255);
    maskBattleScreen(data, screen({ x: 0, y: 4 }));
    expect(alpha(data, 10, 12 * 8 + 2)).toBe(0);
    expect(alpha(data, 10, 12 * 8 + 4)).toBe(255);
  });
});

describe("battleText", () => {
  it("reads only the text and menu cells, as on screen", () => {
    const watched = Object.fromEntries(Object.entries(TEXT_WATCHES).map(([k, [, n]]) => [k, new Uint8Array(n)])) as TextWatched;
    watched.tileMap.fill(0x80); // "A" everywhere
    watched.windowY[0] = 144;
    const cells = new Uint8Array(360).fill(CELL_SCENE);
    cells.fill(CELL_HUD, 0, 12);
    cells.fill(CELL_UI, 12 * 20);
    const screen: BattleScreen = {
      battle: true, enemy: null, player: null, objects: [], cells, huds: { enemy: true, player: false },
      palettes: [0xe4, 0xe4, 0xe4], origin: { x: 0, y: 0 },
    };
    const text = battleText(watched, screen);
    expect(text.tileMap[5]).toBe(0x7f); // a HUD's name
    expect(text.tileMap[100]).toBe(0x7f); // the scene
    expect(text.tileMap[12 * 20 + 3]).toBe(0x80);
    expect(text.windowY[0]).toBe(0);
    expect(watched.tileMap[5]).toBe(0x80);
  });
});

describe("barColour", () => {
  it("turns yellow and red where the game's bar does", () => {
    expect(barColour(20, 20)).toBe("green");
    expect(barColour(11, 20)).toBe("yellow"); // 26 of 48 pixels
    expect(barColour(4, 20)).toBe("red"); // 9 pixels
    expect(barColour(0, 0)).toBe("red");
  });
});
