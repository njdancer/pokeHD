import type { ScreenText } from "@pokehd/emu";
import { describe, expect, it } from "vitest";
import { battleTextFits, hdTextFits, textKey } from "./hd-text.ts";

const box = { x: 0, y: 12, width: 20, height: 6, lines: [{ row: 14, col: 1, text: "HELLO" }] };
const text = (over: Partial<ScreenText> = {}): ScreenText => ({
  shown: true,
  boxes: [box],
  dialog: { box, lines: ["HELLO", ""], state: "printing" },
  menus: [],
  quantity: null,
  loose: [],
  pictures: false,
  ...over,
});

describe("hdTextFits", () => {
  it("takes over boxes of text in the world", () => {
    expect(hdTextFits(text(), "dialog", true)).toBe(true);
  });

  it("leaves battles, the intro and screens it can't draw to the Game Boy screen", () => {
    expect(hdTextFits(text(), "battle", true)).toBe(false);
    expect(hdTextFits(text(), "dialog", false)).toBe(false);
    expect(hdTextFits(text({ loose: [{ row: 0, col: 0, text: "BULBASAUR" }] }), "dialog", true)).toBe(false);
    expect(hdTextFits(text({ pictures: true }), "dialog", true)).toBe(false);
    expect(hdTextFits(text({ boxes: [] }), "dialog", true)).toBe(false);
    expect(hdTextFits(null, "dialog", true)).toBe(false);
  });
});

describe("battleTextFits", () => {
  it("takes over the battle's messages and leaves its menus to the Game Boy screen", () => {
    expect(battleTextFits(text())).toBe(true);
    const fight = { ...box, x: 8, width: 12, lines: [{ row: 14, col: 10, text: "FIGHT" }] };
    expect(battleTextFits(text({ boxes: [box, fight], menus: [{ kind: "battle", box: fight, items: [{ text: "FIGHT", row: 14 }], cursor: 0, active: true }] }))).toBe(false);
    expect(battleTextFits(text({ quantity: { box, value: 1 } }))).toBe(false);
    expect(battleTextFits(text({ loose: [{ row: 0, col: 0, text: "PIDGEY" }] }))).toBe(false);
    expect(battleTextFits(text({ boxes: [] }))).toBe(false);
    expect(battleTextFits(null)).toBe(false);
  });
});

describe("textKey", () => {
  it("changes with the text and the dialog's state, not otherwise", () => {
    expect(textKey(text())).toBe(textKey(text()));
    const more = { ...box, lines: [{ row: 14, col: 1, text: "HELLO!" }] };
    expect(textKey(text({ boxes: [more] }))).not.toBe(textKey(text()));
    expect(textKey(text({ dialog: { box, lines: ["HELLO", ""], state: "waiting" } }))).not.toBe(textKey(text()));
  });
});
