// gameInputWait against the real game: free in the bedroom after the introduction, not while a
// step is under way, free again after it; and the first rival battle's opening line waiting for A.
// Skips without the ROM.
import { existsSync, readFileSync } from "node:fs";
import { SYMBOLS } from "@pokehd/rom";
import { describe, expect, it } from "vitest";
import { Button, GameBoy } from "./core.ts";
import { gameInputWait } from "./input-wait.ts";
import { playIntro, playToRivalBattle } from "./testing.ts";

const ROM_PATH = new URL("../../../rom/pokeblue.gb", import.meta.url);
const WASM_PATH = new URL("./generated/sameboy.wasm", import.meta.url);

describe.skipIf(!existsSync(ROM_PATH))("gameInputWait (ROM)", () => {
  const boot = async () => GameBoy.create({ rom: new Uint8Array(readFileSync(ROM_PATH)), wasmBinary: new Uint8Array(readFileSync(WASM_PATH)) });
  const frame = (gb: GameBoy, buttons = 0) => {
    gb.setButtons(buttons);
    gb.runFrame();
    return gameInputWait(gb);
  };

  it("is free in the overworld only between steps", { timeout: 120_000 }, async () => {
    const gb = await boot();
    playIntro(gb);
    // Through the last of Oak's words, until the game has let go of the pad.
    let run = 0;
    for (let i = 0; run < 30; i++) {
      if (i > 5000) throw new Error("Never free after the introduction");
      run = frame(gb, run === 0 && i % 8 < 2 ? Button.A : 0) === "overworld" ? run + 1 : 0;
    }
    const x = gb.read(SYMBOLS.wXCoord.address);
    // Right until a step starts (a turn first, if facing elsewhere), then let go mid-step.
    for (let i = 0; gb.read(SYMBOLS.wWalkCounter.address) === 0; i++) {
      if (i > 60) throw new Error("No step");
      frame(gb, Button.Right);
    }
    const during: (string | null)[] = [];
    while (gb.read(SYMBOLS.wWalkCounter.address) !== 0) during.push(frame(gb));
    expect(during.length).toBeGreaterThan(4);
    expect(during.slice(0, -1).filter((w) => w !== null)).toEqual([]);
    let after = 0;
    for (let i = 0; i < 30; i++) if (frame(gb) === "overworld") after++;
    expect(gb.read(SYMBOLS.wXCoord.address)).toBe(x + 1);
    expect(after).toBeGreaterThanOrEqual(28);
  });

  it("waits for a button under a battle's message", { timeout: 240_000 }, async () => {
    const gb = await boot();
    playToRivalBattle(gb);
    const seen = new Set<string | null>();
    for (let i = 0; i < 600 && !seen.has("button"); i++) seen.add(frame(gb));
    expect(seen.has("button")).toBe(true);
    expect(seen.has("overworld")).toBe(false);
  });
});
