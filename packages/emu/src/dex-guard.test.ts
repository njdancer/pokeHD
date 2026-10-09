// ROM test for the Pokédex guard: the game opening its Pokédex list or a data page is reported,
// the player's buttons don't reach it meanwhile, and closing leaves the game's own Pokédex the
// usual way. Skips without the dev ROM.
import { existsSync, readFileSync } from "node:fs";
import { SYMBOLS, type RomSymbol } from "@pokehd/rom";
import { beforeAll, describe, expect, it } from "vitest";
import { Button, GameBoy } from "./core.ts";
import { DexGuard, type DexOpened } from "./dex-guard.ts";
import { SafePoint, type Step } from "./gifts/safepoint.ts";
import { playIntro } from "./testing.ts";

const ROM_PATH = new URL("../../../rom/pokeblue.gb", import.meta.url);
const WASM_PATH = new URL("./generated/sameboy.wasm", import.meta.url);

const call = (routine: RomSymbol): Step => ({
  routine: "Bankswitch",
  registers: () => ({ bc: routine.bank << 8, hl: routine.address }),
});

describe.skipIf(!existsSync(ROM_PATH))("Pokédex guard", () => {
  let rom: Uint8Array;
  let wasm: Uint8Array;
  let inWorld: Uint8Array;

  beforeAll(async () => {
    rom = new Uint8Array(readFileSync(ROM_PATH));
    wasm = readFileSync(WASM_PATH);
    const gb = await GameBoy.create({ rom, wasmBinary: wasm });
    playIntro(gb);
    inWorld = gb.saveState();
  }, 60_000);

  const run = async (step: Step, before?: (gb: GameBoy) => void) => {
    const gb = await GameBoy.create({ rom, wasmBinary: wasm });
    gb.loadState(inWorld);
    before?.(gb);
    const events: (DexOpened | "closed")[] = [];
    const guard = new DexGuard(gb, { rom, onOpen: (o) => events.push(o), onClosed: () => events.push("closed") });
    const safe = SafePoint.of(gb);
    safe.enqueue({ scratch: [], steps: [step] });
    let openFrames = 0;
    for (let frame = 0; frame < 3000 && !events.includes("closed"); frame++) {
      // The player presses Down and A throughout; none of it may reach the game's Pokédex.
      guard.setButtons(frame % 8 < 2 ? (frame % 16 < 8 ? Button.Down : Button.A) : 0);
      if (guard.open && ++openFrames === 240) guard.close();
      guard.frame();
      gb.runFrame();
    }
    guard.setButtons(0);
    for (let i = 0; i < 600 && safe.pending > 0; i++) gb.runFrame();
    return { gb, events, safe };
  };

  it("reports the Pokédex list opening and leaves it when closed", async () => {
    const { events, safe } = await run(call(SYMBOLS.ShowPokedexMenu));
    expect(events).toEqual([{ kind: "menu" }, "closed"]);
    expect(safe.pending).toBe(0);
  }, 60_000);

  it("reports a data page with its species", async () => {
    // Bulbasaur's internal index is $99.
    const { events, safe } = await run(call(SYMBOLS.ShowPokedexData), (gb) => gb.write(SYMBOLS.wPokedexNum.address, 0x99));
    expect(events).toEqual([{ kind: "data", species: 0x99 }, "closed"]);
    expect(safe.pending).toBe(0);
  }, 60_000);
});
