import { Button, type ScreenText, type TextBox } from "@pokehd/emu";
import { describe, expect, it } from "vitest";
import { Starter } from "./onboarding.ts";

const box = (lines: string[]): TextBox => ({ x: 0, y: 0, width: 15, height: 8, lines: lines.map((text, i) => ({ row: 2 + i * 2, col: 2, text })) });
const screen = (boxes: TextBox[] = [], menuItems?: string[]): ScreenText => ({
  shown: true, boxes, dialog: null, quantity: null, loose: [], pictures: false,
  menus: menuItems ? [{ kind: "other", box: boxes[0]!, items: menuItems.map((text, i) => ({ text, row: 2 + i * 2 })), cursor: 0, active: true }] : [],
});
const recorder = () => {
  const calls: string[] = [];
  return { calls, press: { tap: (m: number) => calls.push(`tap ${m}`), select: (i: number, p: boolean) => calls.push(`select ${i} ${p}`) } };
};

describe("Starter", () => {
  it("presses START until the main menu, then picks CONTINUE and confirms the save", () => {
    const { calls, press } = recorder();
    const s = new Starter("continue", press);
    for (let f = 0; f < 25; f++) s.frame(screen(), false, f);
    expect(calls).toEqual([`tap ${Button.Start}`, `tap ${Button.Start}`, `tap ${Button.Start}`]);
    calls.length = 0;
    const menu = box(["CONTINUE", "NEW GAME", "OPTION"]);
    s.frame(screen([menu], ["CONTINUE", "NEW GAME", "OPTION"]), false, 30);
    expect(calls).toEqual(["select 0 true"]);
    calls.length = 0;
    const details = box(["PLAYER NICK", "BADGES 2"]);
    for (let f = 60; f < 100; f++) s.frame(screen([details]), false, f);
    expect(calls).toEqual([`tap ${Button.A}`, `tap ${Button.A}`]);
    s.frame(screen(), true, 101);
    expect(s.done).toBe(true);
  });

  it("picks NEW GAME, also when there's no save to continue", () => {
    const { calls, press } = recorder();
    const s = new Starter("continue", press);
    s.frame(screen([box(["NEW GAME", "OPTION"])], ["NEW GAME", "OPTION"]), false, 0);
    expect(calls).toEqual(["select 0 true"]);
    expect(s.done).toBe(true);
    const n = recorder();
    const fresh = new Starter("new", n.press);
    fresh.frame(screen([box(["CONTINUE", "NEW GAME", "OPTION"])], ["CONTINUE", "NEW GAME", "OPTION"]), false, 0);
    expect(n.calls).toEqual(["select 1 true"]);
  });
});
