import { existsSync, readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { decodeText, encodeText, isKeyItem, itemName, monName, pokedexNumber } from "./names.ts";

const ROM_PATH = new URL("../../../../rom/pokeblue.gb", import.meta.url);

describe("game text", () => {
  it("round-trips names", () => {
    expect(decodeText(encodeText("SPARKY"))).toBe("SPARKY");
    expect(encodeText("SPARKY")).toHaveLength(11);
    expect(decodeText(encodeText("MR. MIME"))).toBe("MR. MIME");
  });
});

describe.skipIf(!existsSync(ROM_PATH))("names from the ROM", () => {
  let rom: Uint8Array;
  beforeAll(() => {
    rom = new Uint8Array(readFileSync(ROM_PATH));
  });

  it("reads item names", () => {
    expect(itemName(rom, 0x01)).toBe("MASTER BALL");
    expect(itemName(rom, 0x04)).toBe("POKé BALL");
    expect(itemName(rom, 0x14)).toBe("POTION");
    expect(itemName(rom, 0xc4)).toBe("HM01");
    expect(itemName(rom, 0xc9)).toBe("TM01");
  });

  it("reads species names and Pokédex numbers", () => {
    expect(monName(rom, 0x54)).toBe("PIKACHU");
    expect(monName(rom, 0x99)).toBe("BULBASAUR");
    expect(pokedexNumber(rom, 0x99)).toBe(1);
    expect(pokedexNumber(rom, 0x54)).toBe(25);
    expect(pokedexNumber(rom, 0x1f)).toBe(0); // a MissingNo. slot
  });

  it("knows the key items", () => {
    expect(isKeyItem(rom, 0x06)).toBe(true); // BICYCLE
    expect(isKeyItem(rom, 0x48)).toBe(true); // SILPH SCOPE
    expect(isKeyItem(rom, 0x14)).toBe(false); // POTION
    expect(isKeyItem(rom, 0x04)).toBe(false); // POKé BALL
    expect(isKeyItem(rom, 0xc4)).toBe(true); // HM01
    expect(isKeyItem(rom, 0xc9)).toBe(false); // TM01
  });
});
