// StairStep against the real game, in Pallet Town: south of the player's house a wall runs from
// x 4 to 7 along y 9, open at x 8. Holding Down+Right along it walks right (never turning to
// bump the wall) until the gap, steps down through it, then zigzags. Skips without the ROM.
import { existsSync, readFileSync } from "node:fs";
import { SYMBOLS } from "@pokehd/rom";
import { describe, expect, it } from "vitest";
import { Button, GameBoy } from "./core.ts";
import { StairStep } from "./stair-step.ts";
import { enterMap, playIntro } from "./testing.ts";

const ROM_PATH = new URL("../../../rom/pokeblue.gb", import.meta.url);
const WASM_PATH = new URL("./generated/sameboy.wasm", import.meta.url);
const PALLET_TOWN = 0x00;
const PALLET_WIDTH = 10;
const SFX_COLLISION = 0xb4;
const FACING: Record<number, string> = { 0x0: "D", 0x4: "U", 0x8: "L", 0xc: "R" };

describe.skipIf(!existsSync(ROM_PATH))("StairStep (ROM)", () => {
  const boot = async () => {
    const gb = await GameBoy.create({ rom: new Uint8Array(readFileSync(ROM_PATH)), wasmBinary: new Uint8Array(readFileSync(WASM_PATH)) });
    playIntro(gb);
    return gb;
  };
  const read = (gb: GameBoy, name: keyof typeof SYMBOLS) => gb.read(SYMBOLS[name].address);

  /** Holds `buttons` until `steps` steps are done; returns each step's way and every frame's facing and bump sound. */
  const hold = (gb: GameBoy, buttons: number, steps: number) => {
    const ways: string[] = [];
    const facings = new Set<string>();
    let bumps = 0;
    let at = [read(gb, "wXCoord"), read(gb, "wYCoord")];
    for (let frame = 0; ways.length < steps; frame++) {
      if (frame > steps * 40) throw new Error(`Stuck at ${at} after ${ways.join("")}`);
      gb.setButtons(buttons);
      gb.runFrame();
      facings.add(FACING[read(gb, "wSpritePlayerStateData1FacingDirection")]!);
      if (gb.read(SYMBOLS.wChannelSoundIDs.address + 4) === SFX_COLLISION) bumps++;
      const now = [read(gb, "wXCoord"), read(gb, "wYCoord")];
      if (now[0] !== at[0]) ways.push(now[0]! > at[0]! ? "R" : "L");
      else if (now[1] !== at[1]) ways.push(now[1]! > at[1]! ? "D" : "U");
      at = now;
    }
    gb.setButtons(0);
    for (let i = 0; i < 20; i++) gb.runFrame();
    return { ways: ways.join(""), facings, bumps, at };
  };

  it("walks along a wall without turning into it, then through the gap", { timeout: 120_000 }, async () => {
    const gb = await boot();
    const stairs = new StairStep(gb);
    enterMap(gb, PALLET_TOWN, 4, 8, PALLET_WIDTH);
    // Face right first, as a player running along the wall would.
    hold(gb, Button.Left, 1);
    hold(gb, Button.Right, 1);
    expect([read(gb, "wXCoord"), read(gb, "wYCoord")]).toEqual([4, 8]);
    const run = hold(gb, Button.Down | Button.Right, 7);
    expect(run.ways).toBe("RRRRDRD");
    expect(run.at).toEqual([9, 10]);
    expect(run.bumps).toBe(0);
    // Down showed only once there was a gap to step through.
    expect([...run.facings].sort()).toEqual(["D", "R"]);
    stairs.dispose();
  });

  it("zigzags in the open, and leaves one held direction to the game", { timeout: 120_000 }, async () => {
    const gb = await boot();
    const stairs = new StairStep(gb);
    enterMap(gb, PALLET_TOWN, 1, 6, PALLET_WIDTH);
    const zig = hold(gb, Button.Down | Button.Right, 4);
    expect(zig.ways).toMatch(/^(RD){2}$|^(DR){2}$/);
    expect(zig.bumps).toBe(0);
    // Straight down into the wall bumps it, as ever.
    enterMap(gb, PALLET_TOWN, 5, 8, PALLET_WIDTH);
    let bumped = false;
    for (let i = 0; i < 30; i++) {
      gb.setButtons(Button.Down);
      gb.runFrame();
      bumped ||= gb.read(SYMBOLS.wChannelSoundIDs.address + 4) === SFX_COLLISION;
    }
    expect(bumped).toBe(true);
    expect([read(gb, "wXCoord"), read(gb, "wYCoord")]).toEqual([5, 8]);
    stairs.dispose();
  });
});
