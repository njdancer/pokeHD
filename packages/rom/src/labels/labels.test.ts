import { existsSync, readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { parseWorld } from "../world/parse.ts";
import type { Tileset, WorldData } from "../world/types.ts";
import { blockLabels, LABEL_TABLES, seedLabels, tileLabels } from "./index.ts";

const ROM_PATH = new URL("../../../../rom/pokeblue.gb", import.meta.url);

describe.skipIf(!existsSync(ROM_PATH))("labels", () => {
  let world: WorldData;
  let overworld: Tileset;
  beforeAll(() => {
    world = parseWorld(new Uint8Array(readFileSync(ROM_PATH)));
    overworld = world.tilesets.find((t) => t.name === "OVERWORLD")!;
  });

  it("labels every OVERWORLD tile (Pallet Town, Route 1, Viridian City)", () => {
    const names = ["PALLET_TOWN", "ROUTE_1", "VIRIDIAN_CITY"];
    for (const m of world.maps.filter((m) => m && names.includes(m.name))) expect(m!.tileset).toBe(overworld.id);
    const labels = tileLabels(overworld);
    expect(labels.map((l, t) => (l ? null : t)).filter((t) => t !== null)).toEqual([]);
  });

  it("seeds doors, tall grass and ledges from the ROM", () => {
    const seeds = seedLabels(overworld);
    expect(seeds[0x1b]).toBe("door");
    expect(seeds[0x52]).toBe("tall-grass");
    expect(seeds[0x37]).toBe("ledge");
  });

  it("doesn't hand-label a tile the ROM already seeds, except on purpose", () => {
    const seeds = seedLabels(overworld);
    const clashes = Object.keys(LABEL_TABLES.OVERWORLD!.tiles)
      .map(Number)
      .filter((t) => seeds[t] !== undefined);
    expect(clashes).toEqual([0x58]); // the cave-mouth warp, a "door" to the ROM
  });

  it("applies block overrides over tile labels", () => {
    const blocks = blockLabels(overworld);
    expect(overworld.blocks[0x06 * 16 + 14]).toBe(0x37);
    expect(blocks[0x06]![14]).toBe("cliff");
    expect(blocks[0x07]![14]).toBe("ledge");
  });

  it("only overrides tiles that are labelled differently already", () => {
    const tiles = tileLabels(overworld);
    for (const [b, positions] of Object.entries(LABEL_TABLES.OVERWORLD!.blocks)) {
      for (const [i, label] of Object.entries(positions!)) {
        expect(tiles[overworld.blocks[Number(b) * 16 + Number(i)]!], `block ${b} tile ${i}`).not.toBe(label);
      }
    }
  });

  // p1-state's door warps reach these from Pallet Town, Route 1 and Viridian City.
  const INTERIORS: [string, string[]][] = [
    ["REDS_HOUSE_1", ["REDS_HOUSE_1F"]],
    ["REDS_HOUSE_2", ["REDS_HOUSE_2F"]],
    ["HOUSE", ["BLUES_HOUSE", "VIRIDIAN_SCHOOL_HOUSE", "VIRIDIAN_NICKNAME_HOUSE"]],
    ["DOJO", ["OAKS_LAB"]],
    ["POKECENTER", ["VIRIDIAN_POKECENTER"]],
    ["MART", ["VIRIDIAN_MART"]],
    ["GYM", ["VIRIDIAN_GYM"]],
    // Past Viridian: the forest, the gates and museum, and the caves.
    ["FOREST", ["VIRIDIAN_FOREST", "SAFARI_ZONE_CENTER"]],
    ["GATE", ["ROUTE_2_GATE", "ROUTE_22_GATE"]],
    ["FOREST_GATE", ["VIRIDIAN_FOREST_SOUTH_GATE", "VIRIDIAN_FOREST_NORTH_GATE"]],
    ["MUSEUM", ["MUSEUM_1F", "MUSEUM_2F"]],
    ["CAVERN", ["MT_MOON_1F", "ROCK_TUNNEL_1F", "VICTORY_ROAD_1F", "SEAFOAM_ISLANDS_B4F", "DIGLETTS_CAVE"]],
    // The rest of the game.
    ["SHIP", ["SS_ANNE_1F", "SS_ANNE_BOW", "SS_ANNE_KITCHEN", "SS_ANNE_CAPTAINS_ROOM"]],
    ["SHIP_PORT", ["VERMILION_DOCK"]],
    ["CEMETERY", ["POKEMON_TOWER_1F", "POKEMON_TOWER_7F", "AGATHAS_ROOM"]],
    ["INTERIOR", ["BILLS_HOUSE", "POKEMON_FAN_CLUB", "SILPH_CO_11F"]],
    ["LOBBY", ["CELADON_MART_1F", "CELADON_MART_ROOF", "GAME_CORNER", "CELADON_DINER", "ROCKET_HIDEOUT_ELEVATOR"]],
    ["MANSION", ["CELADON_MANSION_1F", "CELADON_MANSION_ROOF", "CELADON_CHIEF_HOUSE"]],
    ["LAB", ["CINNABAR_LAB", "CINNABAR_LAB_FOSSIL_ROOM", "WARDENS_HOUSE", "FUCHSIA_MEETING_ROOM"]],
    ["CLUB", ["BIKE_SHOP", "TRADE_CENTER", "COLOSSEUM"]],
    ["FACILITY", ["POWER_PLANT", "POKEMON_MANSION_1F", "SAFFRON_GYM", "SILPH_CO_1F", "ROCKET_HIDEOUT_B1F"]],
    ["PLATEAU", ["INDIGO_PLATEAU", "ROUTE_23"]],
    ["UNDERGROUND", ["UNDERGROUND_PATH_NORTH_SOUTH", "UNDERGROUND_PATH_WEST_EAST"]],
  ];

  it.each(INTERIORS)("labels every %s tile", (name, maps) => {
    const tileset = world.tilesets.find((t) => t.name === name)!;
    for (const m of maps) expect(world.maps.find((x) => x?.name === m)!.tileset, m).toBe(tileset.id);
    const labels = tileLabels(tileset);
    expect(labels.map((l, t) => (l ? null : t)).filter((t) => t !== null)).toEqual([]);
  });

  it("labels every tile these maps draw, after block overrides", () => {
    for (const [name, maps] of INTERIORS) {
      const tileset = world.tilesets.find((t) => t.name === name)!;
      const blocks = blockLabels(tileset);
      for (const m of maps) {
        for (const b of world.maps.find((x) => x?.name === m)!.blocks) {
          expect(blocks[b]!.every(Boolean), `${m} block ${b}`).toBe(true);
        }
      }
    }
  });

  it("only labels tiles unused when no map draws them", () => {
    for (const [name] of INTERIORS) {
      const tileset = world.tilesets.find((t) => t.name === name)!;
      // Every map on these graphics, whichever tileset ID it names.
      const shared = new Set(world.tilesets.filter((t) => t.tiles === tileset.tiles).map((t) => t.id));
      const drawn = new Set<number>();
      for (const m of world.maps) {
        if (!m || !shared.has(m.tileset)) continue;
        for (const b of m.blocks) for (const t of tileset.blocks.subarray(b * 16, b * 16 + 16)) drawn.add(t);
      }
      const labels = tileLabels(tileset);
      const wrong = labels.map((l, t) => (l === "unused" && drawn.has(t) ? t : null)).filter((t) => t !== null);
      expect(wrong, name).toEqual([]);
    }
  });

  const REST = ["SHIP", "SHIP_PORT", "CEMETERY", "INTERIOR", "LOBBY", "MANSION", "LAB", "CLUB", "FACILITY", "PLATEAU", "UNDERGROUND"];

  it("hand-labels every tileset", () => {
    expect(world.tilesets.filter((t) => !LABEL_TABLES[t.name]).map((t) => t.name)).toEqual([]);
  });

  it("only overrides interior tiles that are labelled differently already", () => {
    for (const name of ["REDS_HOUSE_1", "HOUSE", "POKECENTER", "GYM", "FOREST", "GATE", "CAVERN", ...REST]) {
      const tileset = world.tilesets.find((t) => t.name === name)!;
      const tiles = tileLabels(tileset);
      for (const [b, positions] of Object.entries(LABEL_TABLES[name]!.blocks)) {
        for (const [i, label] of Object.entries(positions!)) {
          expect(tiles[tileset.blocks[Number(b) * 16 + Number(i)]!], `${name} block ${b} tile ${i}`).not.toBe(label);
        }
      }
    }
  });

  it("shares a table between tilesets that share graphics", () => {
    for (const [a, b] of [["REDS_HOUSE_1", "REDS_HOUSE_2"], ["POKECENTER", "MART"], ["GYM", "DOJO"], ["GATE", "MUSEUM"], ["GATE", "FOREST_GATE"]] as const) {
      const ta = world.tilesets.find((t) => t.name === a)!;
      const tb = world.tilesets.find((t) => t.name === b)!;
      expect(tb.tiles).toBe(ta.tiles);
      expect(LABEL_TABLES[b]).toBe(LABEL_TABLES[a]);
    }
  });
});
