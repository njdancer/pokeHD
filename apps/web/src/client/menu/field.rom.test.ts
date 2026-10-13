// ROM test for where the field items work, by the game's own tables (QA: the Escape Rope was
// greyed out "Inside caves" in Mt. Moon). Skips without the dev ROM.
import { existsSync, readFileSync } from "node:fs";
import { MAP_NAMES, parseWorld, TILESET_NAMES } from "@pokehd/rom";
import { describe, expect, it } from "vitest";
import { bikeAllowed, escapeRopeWorks } from "./items.ts";
import { fieldOf } from "./live.ts";

const ROM_PATH = new URL("../../../../../rom/pokeblue.gb", import.meta.url);
const id = (name: string) => MAP_NAMES.indexOf(name);

describe.skipIf(!existsSync(ROM_PATH))("field items", () => {
  const rom = () => new Uint8Array(readFileSync(ROM_PATH));

  it("reads the game's tileset lists", () => {
    const r = rom();
    const where = (works: (t: number) => boolean) => new Set(TILESET_NAMES.filter((_, t) => works(t)));
    // data/tilesets/escape_rope_tilesets.asm and bike_riding_tilesets.asm
    expect(where((t) => escapeRopeWorks(r, id("PALLET_TOWN"), t))).toEqual(new Set(["FOREST", "CEMETERY", "CAVERN", "FACILITY", "INTERIOR"]));
    expect(where((t) => bikeAllowed(r, id("PALLET_TOWN"), t))).toEqual(new Set(["OVERWORLD", "FOREST", "UNDERGROUND", "SHIP_PORT", "CAVERN"]));
  });

  it("lets the Escape Rope work in caves and dungeons, not in towns or Agatha's room", () => {
    const r = rom();
    const w = parseWorld(r);
    const rope = (name: string) => fieldOf(r, w, { map: id(name), transport: "walk" }).escapeRope;
    for (const name of ["MT_MOON_1F", "MT_MOON_B2F", "VIRIDIAN_FOREST", "POKEMON_TOWER_3F", "SILPH_CO_1F", "SEAFOAM_ISLANDS_B1F"]) expect(rope(name), name).toBe(true);
    for (const name of ["PALLET_TOWN", "ROUTE_23", "VIRIDIAN_POKECENTER", "MT_MOON_POKECENTER", "AGATHAS_ROOM"]) expect(rope(name), name).toBe(false);
  });

  it("lets the bike out where IsBikeRidingAllowed does, never while surfing", () => {
    const r = rom();
    const w = parseWorld(r);
    const bike = (name: string, transport: "walk" | "surf" = "walk") => fieldOf(r, w, { map: id(name), transport }).bike;
    for (const name of ["PALLET_TOWN", "ROUTE_23", "INDIGO_PLATEAU", "MT_MOON_B2F", "VIRIDIAN_FOREST"]) expect(bike(name), name).toBe(true);
    for (const name of ["VIRIDIAN_POKECENTER", "SILPH_CO_1F", "POKEMON_TOWER_3F"]) expect(bike(name), name).toBe(false);
    expect(bike("PALLET_TOWN", "surf")).toBe(false);
  });
});
