// ROM test for the erase guard: saving a new trainer over an old save, the page's answer is
// the one the game gets, and the player mashing A meanwhile can't say YES. Also the save
// summary. Skips without the dev ROM.
import { existsSync, readFileSync } from "node:fs";
import { SYMBOLS } from "@pokehd/rom";
import { beforeAll, describe, expect, it } from "vitest";
import { sameTrainer, saveSummary } from "./autosave.ts";
import { Button, GameBoy } from "./core.ts";
import { EraseGuard } from "./erase-guard.ts";
import { saveGame } from "./gifts/gifts.ts";
import { SafePoint, type Step } from "./gifts/safepoint.ts";
import { playIntro } from "./testing.ts";

const ROM_PATH = new URL("../../../rom/pokeblue.gb", import.meta.url);
const WASM_PATH = new URL("./generated/sameboy.wasm", import.meta.url);

/** The start menu's SAVE, as the player picks it. */
const saveMenu: Step = {
  routine: "Bankswitch",
  registers: () => ({ bc: SYMBOLS.SaveMenu.bank << 8, hl: SYMBOLS.SaveMenu.address }),
};

describe.skipIf(!existsSync(ROM_PATH))("erase guard", () => {
  let rom: Uint8Array;
  let wasm: Uint8Array;
  /** In the world, with a save of this trainer and then a different trainer ID in WRAM. */
  let newGame: Uint8Array;
  let oldSave: Uint8Array;

  beforeAll(async () => {
    rom = new Uint8Array(readFileSync(ROM_PATH));
    wasm = readFileSync(WASM_PATH);
    const gb = await GameBoy.create({ rom, wasmBinary: wasm });
    playIntro(gb);
    const safe = SafePoint.of(gb);
    safe.enqueue({ scratch: [], steps: [saveGame] });
    for (let i = 0; i < 600 && safe.pending > 0; i++) gb.runFrame();
    for (let i = 0; i < 60; i++) gb.runFrame();
    oldSave = gb.saveSram();
    gb.write(SYMBOLS.wPlayerID.address, gb.read(SYMBOLS.wPlayerID.address) ^ 0x5a);
    newGame = gb.saveState();
  }, 60_000);

  /** Opens SAVE, says YES to "Would you like to save?", then answers the erase question. */
  const run = async (erase: boolean) => {
    const gb = await GameBoy.create({ rom, wasmBinary: wasm, sram: oldSave });
    gb.loadState(newGame);
    const events: string[] = [];
    let answered: boolean | undefined;
    const guard = new EraseGuard(gb, {
      rom,
      onPrompt: () => events.push("prompt"),
      onAnswered: (e) => {
        events.push("answered");
        answered = e;
      },
    });
    const safe = SafePoint.of(gb);
    safe.enqueue({ scratch: [], steps: [saveMenu] });
    let frame = 0;
    for (; frame < 3000 && answered === undefined; frame++) {
      // The player mashes A throughout, as a small child might.
      guard.setButtons(frame % 8 < 2 ? Button.A : 0);
      // The page answers a while after the question came up.
      if (guard.asking && frame % 300 === 0) guard.answer(erase);
      guard.frame();
      gb.runFrame();
    }
    guard.setButtons(0);
    for (let i = 0; i < 600 && safe.pending > 0; i++) gb.runFrame();
    return { gb, events, answered };
  };

  it("keeps the old save when the page says no, however much A is pressed", async () => {
    const { gb, events, answered } = await run(false);
    expect(events).toEqual(["prompt", "answered"]);
    expect(answered).toBe(false);
    expect(sameTrainer(saveSummary(gb.saveSram())!, saveSummary(oldSave)!)).toBe(true);
  }, 60_000);

  it("saves the new trainer when the page says yes", async () => {
    const { gb, answered } = await run(true);
    expect(answered).toBe(true);
    const after = saveSummary(gb.saveSram())!;
    expect(sameTrainer(after, saveSummary(oldSave)!)).toBe(false);
    const id = gb.readBytes(SYMBOLS.wPlayerID.address, 2);
    expect(after.id).toBe((id[0]! << 8) | id[1]!);
  }, 60_000);

  it("summarises a save", () => {
    const summary = saveSummary(oldSave)!;
    expect(summary.badges).toBe(0);
    expect(summary.hours).toBe(0);
    expect(summary.name.length).toBe(11);
    expect(saveSummary(new Uint8Array(32 * 1024))).toBeNull();
  });
});
