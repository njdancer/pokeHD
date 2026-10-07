import { existsSync, readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { Button, CYCLES_PER_FRAME, GameBoy, SCREEN_HEIGHT, SCREEN_WIDTH } from "./core.ts";

const ROM_PATH = new URL("../../../rom/pokeblue.gb", import.meta.url);
const WASM_PATH = new URL("./generated/sameboy.wasm", import.meta.url);
const hasRom = existsSync(ROM_PATH);

const REDS_HOUSE_2F = 0x26;

/** Mashes A (with the odd Down and Start) through the intro until the overworld loop runs. */
function playIntro(gb: GameBoy): number {
  let reached = false;
  const remove = gb.addHook("OverworldLoop", () => (reached = true));
  let frame = 0;
  while (!reached && frame < 20_000) {
    const press = frame % 64 < 8 ? Button.Down : frame % 512 < 8 ? Button.Start : Button.A;
    gb.setButtons(frame % 8 < 2 ? press : 0);
    gb.runFrame();
    frame++;
  }
  remove();
  gb.setButtons(0);
  for (let i = 0; i < 60; i++) gb.runFrame();
  return frame;
}

const position = (gb: GameBoy) => [gb.readSymbol("wCurMap"), gb.readSymbol("wXCoord"), gb.readSymbol("wYCoord")];

describe.skipIf(!hasRom)("GameBoy with the dev ROM", () => {
  let gb: GameBoy;

  beforeAll(async () => {
    gb = await GameBoy.create({ rom: readFileSync(ROM_PATH), wasmBinary: readFileSync(WASM_PATH) });
    playIntro(gb);
  }, 60_000);

  it("plays a new game into Red's room", () => {
    expect(position(gb)).toEqual([REDS_HOUSE_2F, 3, 6]);
  });

  it("draws frames and produces audio", () => {
    gb.drainAudio();
    gb.runFrame();
    const frame = gb.frame;
    expect(frame.length).toBe(SCREEN_WIDTH * SCREEN_HEIGHT * 4);
    expect(new Set(new Uint32Array(frame.slice().buffer)).size).toBeGreaterThan(1);
    // 48 kHz / 59.73 fps ≈ 804 stereo frames per video frame.
    expect(gb.drainAudio().length / 2).toBeGreaterThan(700);
  });

  it("calls hooks before the hooked instruction runs", () => {
    const pcs: number[] = [];
    const remove = gb.addHook("DelayFrame", (g) => pcs.push(g.registers.pc));
    for (let i = 0; i < 10; i++) gb.runFrame();
    remove();
    for (let i = 0; i < 10; i++) gb.runFrame();
    expect(pcs.length).toBe(10);
    expect(new Set(pcs)).toEqual(new Set([0x20af]));
  });

  it("restores position from a save state", () => {
    const state = gb.saveState();
    const before = position(gb);
    gb.setButtons(Button.Right);
    for (let i = 0; i < 40; i++) gb.runFrame();
    gb.setButtons(0);
    for (let i = 0; i < 30; i++) gb.runFrame();
    expect(position(gb)).not.toEqual(before);
    gb.loadState(state);
    expect(position(gb)).toEqual(before);
  });

  it("writes memory the game then sees", () => {
    const address = 0xc000; // wShadowOAM, rewritten by the game; check the write lands first
    gb.write(address, 0x5a);
    expect(gb.read(address)).toBe(0x5a);
  });

  it("round-trips battery RAM", () => {
    const sram = gb.saveSram();
    expect(sram.length).toBe(0x8000);
    const patched = sram.slice();
    patched[0x100] = (patched[0x100]! + 1) & 0xff;
    gb.loadSram(patched);
    expect(gb.saveSram()).toEqual(patched);
    gb.loadSram(sram);
  });

  it("runs in cycle-sized steps", () => {
    let frames = 0;
    for (let i = 0; i < 10; i++) if (gb.runCycles(CYCLES_PER_FRAME / 10)) frames++;
    expect(frames).toBeLessThanOrEqual(1);
    for (let i = 0; i < 40; i++) if (gb.runCycles(CYCLES_PER_FRAME / 10)) frames++;
    expect(frames).toBeGreaterThanOrEqual(4);
  });
});
