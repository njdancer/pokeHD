import type { DialogState, ScreenText } from "@pokehd/emu";
import { describe, expect, it } from "vitest";
import { DialogJoiner } from "./dialog-join.ts";

const box = { x: 0, y: 12, width: 20, height: 6, lines: [] };
const screen = (lines: [string, string], state: DialogState, menu = false) =>
  ({ dialog: { box, lines, state }, menus: menu ? [{ active: true }] : [], boxes: [box] }) as unknown as ScreenText;

describe("DialogJoiner", () => {
  it("reads on past a page that stops mid-sentence and shows the lines together", () => {
    const j = new DialogJoiner();
    expect(j.frame(screen(["My name is OAK!", "People call me"], "printing"))).toEqual({ lines: null, press: false });
    expect(j.frame(screen(["My name is OAK!", "People call me"], "waiting"))).toEqual({ lines: ["My name is OAK!", "People call me"], press: true });
    // Until the game moves on, no second press.
    expect(j.frame(screen(["My name is OAK!", "People call me"], "waiting"))).toEqual({ lines: ["My name is OAK!", "People call me"], press: false });
    // The lines scroll up and the next prints.
    expect(j.frame(screen(["People call me", ""], "printing")).lines).toEqual(["My name is OAK!", "People call me"]);
    expect(j.frame(screen(["People call me", "the POKéMON PROF!"], "waiting"))).toEqual({
      lines: ["My name is OAK!", "People call me", "the POKéMON PROF!"],
      press: false,
    });
    // The player reads on: the next sentence starts a fresh box.
    expect(j.frame(screen(["This world is", ""], "printing"))).toEqual({ lines: null, press: false });
  });

  it("stops at a question, a full box or a menu", () => {
    const j = new DialogJoiner();
    expect(j.frame(screen(["Is that right?", ""], "waiting")).press).toBe(false);
    const k = new DialogJoiner();
    expect(k.frame(screen(["one", "two"], "waiting")).press).toBe(true);
    k.frame(screen(["three", "four"], "printing"));
    expect(k.frame(screen(["three", "four"], "waiting"))).toEqual({ lines: ["one", "two", "three", "four"], press: false });
    const m = new DialogJoiner();
    expect(m.frame(screen(["Which will", "you take"], "waiting", true))).toEqual({ lines: null, press: false });
  });
});
