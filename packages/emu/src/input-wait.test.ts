import { SYMBOLS } from "@pokehd/rom";
import { describe, expect, it } from "vitest";
import { classifyInputWait, type OverworldGates } from "./input-wait.ts";

const FREE: OverworldGates = { walkCounter: 0, joyIgnore: 0, statusFlags5: 0, simulatedJoypad: 0 };
const stack = (...words: number[]) => new Uint8Array(words.flatMap((w) => [w & 0xff, w >> 8]));
const delay = SYMBOLS.DelayFrame.address + 4;

describe("classifyInputWait", () => {
  it("finds the wait for A or B, at its loop or from what it called", () => {
    expect(classifyInputWait(SYMBOLS.WaitForTextScrollButtonPress.address + 0x10, stack(0xc3a0), FREE)).toBe("button");
    // In Joypad's homecall, a few calls down.
    expect(classifyInputWait(0x0123, stack(0x4000, 0x0302, 0x3830, SYMBOLS.WaitForTextScrollButtonPress.address + 0x1a, 0x1234), FREE)).toBe("button");
    // ScriptText holding it: DelayFrame returns to the wait's start.
    expect(classifyInputWait(delay, stack(SYMBOLS.ManualTextScroll.address), FREE)).toBe("button");
  });

  it("finds a menu's wait", () => {
    expect(classifyInputWait(delay, stack(SYMBOLS.HandleMenuInput.address + 0x30, 0x1234), FREE)).toBe("menu");
  });

  it("finds the overworld loop with the player free, and not otherwise", () => {
    const top = stack(SYMBOLS.OverworldLoop.address + 3);
    expect(classifyInputWait(delay, top, FREE)).toBe("overworld");
    expect(classifyInputWait(delay, stack(SYMBOLS.OverworldLoopLessDelay.address + 3), FREE)).toBe("overworld");
    // At the VBlank interrupt, woken from DelayFrame's halt.
    expect(classifyInputWait(0x40, stack(delay, SYMBOLS.OverworldLoopLessDelay.address + 3), FREE)).toBe("overworld");
    expect(classifyInputWait(delay, top, { ...FREE, walkCounter: 3 })).toBeNull();
    expect(classifyInputWait(delay, top, { ...FREE, joyIgnore: 0xff })).toBeNull();
    expect(classifyInputWait(delay, top, { ...FREE, statusFlags5: 0x80 })).toBeNull();
    expect(classifyInputWait(delay, top, { ...FREE, simulatedJoypad: 2 })).toBeNull();
    // The no-text-delay bit doesn't hold the player.
    expect(classifyInputWait(delay, top, { ...FREE, statusFlags5: 0x40 })).toBe("overworld");
    // DelayFrame from elsewhere (a script's own wait).
    expect(classifyInputWait(delay, stack(0x1d00), FREE)).toBeNull();
  });
});
