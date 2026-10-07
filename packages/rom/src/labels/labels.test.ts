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
});
