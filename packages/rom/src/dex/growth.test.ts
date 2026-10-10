import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { growth } from "./growth.ts";

const ROM_PATH = new URL("../../../../rom/pokeblue.gb", import.meta.url);
const romAvailable = existsSync(ROM_PATH);

describe.skipIf(!romAvailable)("how Pokémon grow", () => {
  const rom = romAvailable ? new Uint8Array(readFileSync(ROM_PATH)) : new Uint8Array();

  it("reads evolutions and level-up moves", () => {
    // Bulbasaur ($99): Ivysaur ($09) at 16; Leech Seed at 7.
    const bulbasaur = growth(rom, 0x99);
    expect(bulbasaur.evolutions).toEqual([{ how: "level", level: 16, species: 0x09 }]);
    expect(bulbasaur.learnset[0]).toEqual({ level: 7, move: 0x49 });
    // Pikachu ($54): Raichu ($55) with a Thunder Stone ($21).
    expect(growth(rom, 0x54).evolutions).toEqual([{ how: "item", item: 0x21, species: 0x55 }]);
    // Kadabra ($26) by trade, to Alakazam ($95).
    expect(growth(rom, 0x26).evolutions).toEqual([{ how: "trade", species: 0x95 }]);
  });
});
