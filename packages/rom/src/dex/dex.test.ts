import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { MAP_NAMES } from "../generated/names.ts";
import { dexEntries, dexPicture, townMap, townMapPlace, trainerClasses, wildAreas } from "./dex.ts";

const ROM_PATH = new URL("../../../../rom/pokeblue.gb", import.meta.url);
const romAvailable = existsSync(ROM_PATH);

describe.skipIf(!romAvailable)("the Pokédex's data", () => {
  const rom = romAvailable ? new Uint8Array(readFileSync(ROM_PATH)) : new Uint8Array();
  const entries = romAvailable ? dexEntries(rom) : [];

  it("reads every entry in Pokédex order", () => {
    expect(entries).toHaveLength(151);
    const bulbasaur = entries[0]!;
    expect(bulbasaur).toMatchObject({ dex: 1, species: 0x99, name: "BULBASAUR", category: "SEED", heightFeet: 2, heightInches: 4, weightTenths: 150, types: ["GRASS", "POISON"] });
    expect(bulbasaur.stats).toEqual({ hp: 45, attack: 49, defense: 49, speed: 45, special: 65 });
    expect(bulbasaur.pages[0]![0]).toBe("A strange seed was");
    expect(entries[24]).toMatchObject({ name: "PIKACHU", types: ["ELECTRIC"], category: "MOUSE" });
    expect(entries[150]).toMatchObject({ name: "MEW", category: "NEW SPECIE", types: ["PSYCHIC"] });
    expect(entries[111]!.pages.length).toBe(2); // Rhydon's entry runs to a second page
  });

  it("decompresses front pictures", () => {
    for (const e of [entries[0]!, entries[150]!, entries[143]!]) {
      const pic = dexPicture(rom, e.picture);
      expect(pic.width).toBeGreaterThanOrEqual(5);
      expect(pic.width).toBeLessThanOrEqual(7);
    }
  });

  it("finds where wild Pokémon live", () => {
    const route1 = wildAreas(rom).find((a) => a.map === MAP_NAMES.indexOf("ROUTE_1"))!;
    expect(route1.grassRate).toBe(25);
    expect(new Set(route1.grass.map((s) => entries.find((e) => e.species === s.species)?.name))).toEqual(new Set(["PIDGEY", "RATTATA"]));
  });

  it("reads trainer classes and the town map", () => {
    const classes = trainerClasses(rom);
    expect(classes[0]!.name).toBe("YOUNGSTER");
    expect(classes.find((c) => c.name === "BROCK")).toBeTruthy();
    expect(dexPicture(rom, classes[0]!.picture).width).toBe(7);
    expect(townMapPlace(rom, 0)).toEqual({ x: 2, y: 11, name: "PALLET TOWN" });
    expect(townMapPlace(rom, MAP_NAMES.indexOf("OAKS_LAB")).name).toBe("PALLET TOWN");
    expect(townMapPlace(rom, MAP_NAMES.indexOf("VIRIDIAN_FOREST")).name).toBe("VIRIDIAN FOREST");
    const map = townMap(rom);
    expect(map.tiles).toHaveLength(16);
    expect(new Set(map.cells).size).toBeGreaterThan(5);
  });
});
