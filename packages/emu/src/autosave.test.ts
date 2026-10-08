// ROM test for autosave and resume points: the game's own save runs at the idle point on a
// timer and when prompted, never over another trainer's save, and a resume point is used only
// while it holds the stored save. Skips without the dev ROM.
import { existsSync, readFileSync } from "node:fs";
import { SYMBOLS } from "@pokehd/rom";
import { beforeAll, describe, expect, it } from "vitest";
import { AutoSave, hasSave, loadResumePoint, otherTrainersSave } from "./autosave.ts";
import { GameBoy } from "./core.ts";
import { saveCommits } from "./gifts/desk.ts";
import { saveGame } from "./gifts/gifts.ts";
import { SafePoint } from "./gifts/safepoint.ts";
import { playIntro } from "./testing.ts";

const ROM_PATH = new URL("../../../rom/pokeblue.gb", import.meta.url);
const WASM_PATH = new URL("./generated/sameboy.wasm", import.meta.url);

const frames = (gb: GameBoy, n: number) => {
  for (let i = 0; i < n; i++) gb.runFrame();
};
/** Runs frames through an AutoSave until it has saved, or gives up. */
const runUntilSaved = (gb: GameBoy, auto: AutoSave, limit: number) => {
  for (let i = 0; i < limit; i++) {
    gb.runFrame();
    auto.frame();
    if (hasSave(gb.saveSram())) {
      // Let the routine finish (the party and Pokédex come after the checksum).
      frames(gb, 30);
      return i;
    }
  }
  return -1;
};

describe.skipIf(!existsSync(ROM_PATH))("autosave and resume points", () => {
  let rom: Uint8Array;
  let wasm: Uint8Array;
  let start: Uint8Array;
  const boot = async (sram?: Uint8Array) => GameBoy.create({ rom, wasmBinary: wasm, ...(sram ? { sram } : {}) });
  const fromStart = async () => {
    const gb = await boot();
    gb.loadState(start);
    return gb;
  };

  beforeAll(async () => {
    rom = new Uint8Array(readFileSync(ROM_PATH));
    wasm = readFileSync(WASM_PATH);
    const gb = await boot();
    playIntro(gb);
    start = gb.saveState();
  }, 60_000);

  it("saves with the game's own routine once the interval has passed", async () => {
    const gb = await fromStart();
    expect(hasSave(gb.saveSram())).toBe(false);
    const auto = new AutoSave(gb, { rom, intervalFrames: 300, minGapFrames: 60 });
    const at = runUntilSaved(gb, auto, 1000);
    expect(at).toBeGreaterThanOrEqual(299);
    expect(otherTrainersSave(gb)).toBeUndefined();
    // The save file holds this trainer: a reboot from it would CONTINUE as them.
    const sram = gb.saveSram();
    const id = gb.readBytes(SYMBOLS.wPlayerID.address, 2);
    const idAt = 0x2000 + SYMBOLS.sMainData.address - 0xa000 + SYMBOLS.wPlayerID.address - SYMBOLS.wMainDataStart.address;
    expect([...sram.slice(idAt, idAt + 2)]).toEqual([...id]);
  }, 60_000);

  it("saves soon after a prompt, but not before the gap", async () => {
    const gb = await fromStart();
    const auto = new AutoSave(gb, { rom, intervalFrames: 100_000, minGapFrames: 200 });
    auto.prompt();
    const at = runUntilSaved(gb, auto, 600);
    expect(at).toBeGreaterThanOrEqual(199);
    expect(at).toBeLessThan(400);
  }, 60_000);

  it("restarts its clock after a save by hand", async () => {
    const gb = await fromStart();
    let saves = 0;
    gb.addHook(saveCommits(rom)[0]!.at, () => saves++);
    const auto = new AutoSave(gb, { rom, intervalFrames: 300 });
    const run = (n: number) => {
      for (let i = 0; i < n; i++) {
        gb.runFrame();
        auto.frame();
      }
    };
    run(250);
    // The start menu's SAVE, at the idle point.
    const safe = SafePoint.of(gb);
    safe.enqueue({ scratch: [], steps: [saveGame] });
    for (let i = 0; i < 600 && safe.pending > 0; i++) {
      gb.runFrame();
      auto.frame();
    }
    expect(saves).toBe(1);
    run(250);
    expect(saves).toBe(1);
    run(100);
    expect(saves).toBe(2);
  }, 60_000);

  it("never saves over another trainer's save", async () => {
    const gb = await fromStart();
    const auto = new AutoSave(gb, { rom, intervalFrames: 120 });
    runUntilSaved(gb, auto, 600);
    const theirs = gb.saveSram();
    // A NEW GAME: a different trainer ID in WRAM.
    gb.write(SYMBOLS.wPlayerID.address, gb.read(SYMBOLS.wPlayerID.address) ^ 0x5a);
    expect(otherTrainersSave(gb)).toBeDefined();
    const skipped: string[] = [];
    const again = new AutoSave(gb, { rom, intervalFrames: 120, skipped: (why) => skipped.push(why) });
    auto.enabled = false;
    for (let i = 0; i < 600; i++) {
      gb.runFrame();
      again.frame();
    }
    expect(skipped.length).toBeGreaterThan(0);
    expect([...gb.saveSram().slice(0x2000, 0x4000)]).toEqual([...theirs.slice(0x2000, 0x4000)]);
  }, 60_000);

  it("resumes only from a point that holds the stored save", async () => {
    const gb = await fromStart();
    const auto = new AutoSave(gb, { rom, intervalFrames: 60 });
    runUntilSaved(gb, auto, 600);
    frames(gb, 30);
    const sram = gb.saveSram();
    const point = gb.saveState();
    const pc = gb.registers.pc;

    const resumed = await boot(sram);
    expect(loadResumePoint(resumed, point, sram)).toBeUndefined();
    expect(resumed.registers.pc).toBe(pc);

    // A save made after the point (or an imported .sav) makes it stale.
    const newer = sram.slice();
    newer[0x2010] = (newer[0x2010] ?? 0) ^ 0xff;
    expect(loadResumePoint(await boot(newer), point, newer)).toMatch(/changed/);
    // Pictures the game decompressed into SRAM since (a battle, the Pokédex) change no save.
    const pictures = sram.slice();
    pictures[0x0100] = (pictures[0x0100] ?? 0) ^ 0xff;
    expect(loadResumePoint(await boot(pictures), point, pictures)).toBeUndefined();
    // A damaged point is refused.
    expect(loadResumePoint(await boot(sram), point.slice(0, 100), sram)).toBeDefined();
  }, 60_000);
});
