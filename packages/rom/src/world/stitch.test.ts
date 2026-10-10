import { existsSync, readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { MAP_NAMES } from "../generated/names.ts";
import { parseWorld } from "./parse.ts";
import { globalStep, localStep, stitchOverlaps, stitchOverworld, type StitchedWorld } from "./stitch.ts";
import type { Connection, MapData, WorldData } from "./types.ts";

const ROM_PATH = new URL("../../../../rom/pokeblue.gb", import.meta.url);
const mapId = (name: string) => MAP_NAMES.indexOf(name);

/** A bare map with just a size and connections. */
function map(id: number, widthBlocks: number, heightBlocks: number, connections: Connection[]): MapData {
  return {
    id,
    name: `MAP_${id}`,
    tileset: 0,
    widthBlocks,
    heightBlocks,
    blocks: new Uint8Array(widthBlocks * heightBlocks),
    borderBlock: 0,
    connections,
    warps: [],
    signs: [],
    npcs: [],
  };
}

describe("stitchOverworld", () => {
  it("places neighbours on each side by their offsets", () => {
    const maps = [
      map(0, 10, 9, [
        { direction: "north", map: 1, offsetBlocks: -2 },
        { direction: "east", map: 2, offsetBlocks: 3 },
        { direction: "west", map: 3, offsetBlocks: 0 },
        { direction: "south", map: 4, offsetBlocks: 1 },
      ]),
      map(1, 4, 5, []),
      map(2, 6, 2, []),
      map(3, 7, 9, []),
      map(4, 3, 3, []),
      map(5, 9, 9, []), // not connected: left out
    ];
    const s = stitchOverworld({ maps });
    // The west map is 7 wide and the north map 5 tall, so map 0 lands at (7, 5).
    const at = (id: number) => s.byId.get(id)!;
    expect([at(0).x, at(0).y]).toEqual([7, 5]);
    expect([at(1).x, at(1).y]).toEqual([5, 0]);
    expect([at(2).x, at(2).y]).toEqual([17, 8]);
    expect([at(3).x, at(3).y]).toEqual([0, 5]);
    expect([at(4).x, at(4).y]).toEqual([8, 14]);
    expect(s.byId.has(5)).toBe(false);
    expect(s.bounds).toEqual({ widthBlocks: 23, heightBlocks: 17 });
    expect(s.mismatches).toEqual([]);
    expect(globalStep(s, 0, 3, 4)).toEqual({ x: 17, y: 14 });
    expect(localStep(s, 17, 14)).toEqual({ map: 0, x: 3, y: 4 });
    expect(globalStep(s, 5, 0, 0)).toBeNull();
  });

  it("reports connections that disagree instead of moving a map", () => {
    const maps: WorldData["maps"] = [
      map(0, 2, 2, [{ direction: "east", map: 1, offsetBlocks: 0 }]),
      map(1, 2, 2, [{ direction: "west", map: 0, offsetBlocks: 1 }]),
    ];
    const s = stitchOverworld({ maps });
    expect(s.mismatches).toEqual([{ from: 1, to: 0, direction: "west", expected: { x: 0, y: 1 }, actual: { x: 0, y: 0 } }]);
  });
});

describe.skipIf(!existsSync(ROM_PATH))("stitchOverworld on the ROM", () => {
  let s: StitchedWorld;
  const at = (name: string) => s.byId.get(mapId(name))!;

  beforeAll(() => {
    s = stitchOverworld(parseWorld(new Uint8Array(readFileSync(ROM_PATH))));
  });

  it("puts Route 1 directly north of Pallet Town", () => {
    const pallet = at("PALLET_TOWN");
    const route1 = at("ROUTE_1");
    expect(route1.x).toBe(pallet.x);
    expect(route1.y + route1.heightBlocks).toBe(pallet.y);
    // Route 2 runs north into Pewter City five blocks to its left (offset -5).
    expect(at("PEWTER_CITY").x).toBe(at("ROUTE_2").x - 5);
  });

  it("reaches every town and route, and nothing else", () => {
    const names = s.maps.map((m) => MAP_NAMES[m.id]!);
    const towns = ["VIRIDIAN_CITY", "PEWTER_CITY", "CERULEAN_CITY", "VERMILION_CITY", "LAVENDER_TOWN", "CELADON_CITY", "SAFFRON_CITY", "FUCHSIA_CITY", "CINNABAR_ISLAND", "INDIGO_PLATEAU"];
    for (const town of towns) expect(names).toContain(town);
    for (let route = 1; route <= 25; route++) expect(names).toContain(`ROUTE_${route}`);
    // The ten above, Pallet Town and 25 routes.
    expect(s.maps).toHaveLength(36);
  });

  it("agrees with every connection, with no two maps overlapping", () => {
    expect(s.mismatches).toEqual([]);
    expect(stitchOverlaps(s)).toEqual([]);
    expect(s.bounds).toEqual({ widthBlocks: 170, heightBlocks: 180 });
    for (const m of s.maps) {
      expect(m.x).toBeGreaterThanOrEqual(0);
      expect(m.y).toBeGreaterThanOrEqual(0);
    }
  });

  it("converts a step in Viridian City to the world and back", () => {
    const g = globalStep(s, mapId("VIRIDIAN_CITY"), 23, 25)!;
    expect(localStep(s, g.x, g.y)).toEqual({ map: mapId("VIRIDIAN_CITY"), x: 23, y: 25 });
    // Walking off Pallet Town's top edge is the bottom row of Route 1.
    const top = globalStep(s, mapId("PALLET_TOWN"), 10, -1)!;
    expect(localStep(s, top.x, top.y)).toEqual({ map: mapId("ROUTE_1"), x: 10, y: 35 });
  });
});
