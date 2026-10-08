import { existsSync, readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { MAP_NAMES, TILESET_NAMES } from "../generated/names.ts";
import { overworldPalette, readSgbPalettes, SGB_PAL } from "./sgb.ts";

const ROM_PATH = new URL("../../../../rom/pokeblue.gb", import.meta.url);
const map = (name: string) => MAP_NAMES.indexOf(name);
const OVERWORLD = TILESET_NAMES.indexOf("OVERWORLD");
const HOUSE = TILESET_NAMES.indexOf("HOUSE");

describe.skipIf(!existsSync(ROM_PATH))("readSgbPalettes", () => {
  let palettes: ReturnType<typeof readSgbPalettes>;
  beforeAll(() => {
    palettes = readSgbPalettes(new Uint8Array(readFileSync(ROM_PATH)));
  });

  it("reads SuperPalettes (data/sgb/sgb_palettes.asm)", () => {
    // RGB 31,29,31, 25,28,27, 20,26,31, 03,02,02 ; PAL_PALLET
    expect(palettes[SGB_PAL.PALLET]).toEqual([0xffefff, 0xcee7de, 0xa5d6ff, 0x181010]);
    // RGB 31,29,31, 30,18,00, 20,26,31, 03,02,02 ; PAL_VERMILION
    expect(palettes[SGB_PAL.VERMILION]![1]).toBe(0xf79400);
    // RGB 31,29,31, 21,14,09, 18,24,22, 03,02,02 ; PAL_CAVE
    expect(palettes[SGB_PAL.CAVE]![2]).toBe(0x94c6b5);
  });
});

describe("overworldPalette", () => {
  it("gives towns their own palette and routes the shared one", () => {
    expect(overworldPalette(map("PALLET_TOWN"), OVERWORLD)).toBe(SGB_PAL.PALLET);
    expect(overworldPalette(map("SAFFRON_CITY"), OVERWORLD)).toBe(SGB_PAL.SAFFRON);
    expect(overworldPalette(map("ROUTE_1"), OVERWORLD)).toBe(SGB_PAL.ROUTE);
  });

  it("colours buildings like the map outside", () => {
    expect(overworldPalette(map("REDS_HOUSE_1F"), HOUSE, map("PALLET_TOWN"))).toBe(SGB_PAL.PALLET);
    expect(overworldPalette(map("REDS_HOUSE_1F"), HOUSE, map("ROUTE_1"))).toBe(SGB_PAL.ROUTE);
    expect(overworldPalette(map("REDS_HOUSE_1F"), HOUSE)).toBe(SGB_PAL.ROUTE);
  });

  it("special-cases caves, the tower and the Elite Four", () => {
    expect(overworldPalette(map("MT_MOON_1F"), TILESET_NAMES.indexOf("CAVERN"))).toBe(SGB_PAL.CAVE);
    expect(overworldPalette(map("POKEMON_TOWER_1F"), TILESET_NAMES.indexOf("CEMETERY"))).toBe(SGB_PAL.GRAYMON);
    expect(overworldPalette(map("CERULEAN_CAVE_1F"), TILESET_NAMES.indexOf("CAVERN"))).toBe(SGB_PAL.CAVE);
    expect(overworldPalette(map("LORELEIS_ROOM"), TILESET_NAMES.indexOf("GYM"), map("INDIGO_PLATEAU"))).toBe(SGB_PAL.ROUTE);
  });
});
