import { existsSync, readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { MAP_NAMES } from "../generated/names.ts";
import { decode2bpp, parseWorld } from "./parse.ts";
import type { MapData, WorldData } from "./types.ts";

const ROM_PATH = new URL("../../../../rom/pokeblue.gb", import.meta.url);
const mapId = (name: string) => MAP_NAMES.indexOf(name);

describe("decode2bpp", () => {
  it("combines the low and high bit planes", () => {
    // Row 0: lo 0b10100000, hi 0b11000000 → pixels 3, 2, 1, 0 …
    const tile = new Uint8Array(16);
    tile[0] = 0b10100000;
    tile[1] = 0b11000000;
    expect(Array.from(decode2bpp(tile).subarray(0, 4))).toEqual([3, 2, 1, 0]);
  });
});

describe.skipIf(!existsSync(ROM_PATH))("parseWorld", () => {
  let world: WorldData;
  const map = (name: string) => world.maps[mapId(name)] as MapData;

  beforeAll(() => {
    world = parseWorld(new Uint8Array(readFileSync(ROM_PATH)));
  });

  it("parses every used map slot and skips unused ones", () => {
    expect(world.maps).toHaveLength(248);
    expect(world.maps[0x0b]).toBeNull();
    expect(world.maps.filter(Boolean)).toHaveLength(MAP_NAMES.filter(Boolean).length);
  });

  it("parses Pallet Town", () => {
    const pallet = map("PALLET_TOWN");
    expect(pallet.tileset).toBe(world.tilesets.findIndex((t) => t.name === "OVERWORLD"));
    expect([pallet.widthBlocks, pallet.heightBlocks]).toEqual([10, 9]);
    expect(pallet.connections).toEqual([
      { direction: "north", map: mapId("ROUTE_1"), offsetBlocks: 0 },
      { direction: "south", map: mapId("ROUTE_21"), offsetBlocks: 0 },
    ]);
    expect(pallet.borderBlock).toBe(0x0b);
    expect(pallet.warps[0]).toEqual({ x: 5, y: 5, to: mapId("REDS_HOUSE_1F"), toWarp: 0 });
    expect(pallet.signs).toHaveLength(4);
    expect(pallet.npcs[0]).toMatchObject({ kind: "person", x: 8, y: 5, movement: { kind: "stay", facing: "none" } });
    expect(pallet.npcs[1]!.movement).toEqual({ kind: "walk", range: "any" });
  });

  it("decodes non-zero offsets, items, trainers and static battles", () => {
    // Route 2 north to Pewter City, offset -5 (data/maps/headers/Route2.asm).
    expect(map("ROUTE_2").connections).toContainEqual({ direction: "north", map: mapId("PEWTER_CITY"), offsetBlocks: -5 });
    expect(map("VIRIDIAN_FOREST").npcs.some((n) => n.kind === "item")).toBe(true);
    expect(map("VIRIDIAN_FOREST").npcs.some((n) => n.kind === "trainer")).toBe(true);
    expect(map("POWER_PLANT").npcs).toContainEqual(expect.objectContaining({ kind: "pokemon", level: 40 }));
    expect(map("REDS_HOUSE_1F").warps[0]!.to).toBe("last");
  });

  it("keeps every map inside its tileset's blockset", () => {
    for (const m of world.maps) {
      if (!m) continue;
      const blockCount = world.tilesets[m.tileset]!.blockCount;
      expect(Math.max(...m.blocks, m.borderBlock), m.name).toBeLessThan(blockCount);
    }
  });

  it("reads tileset semantics", () => {
    const overworld = world.tilesets[0]!;
    expect(overworld.tiles).toHaveLength(96 * 64);
    expect(overworld.animation).toBe("water-flower");
    expect(overworld.semantics.grass).toBe(0x52);
    expect(overworld.semantics.doors).toEqual([0x1b, 0x58]);
    expect(overworld.semantics.walkable).toContain(0x2c);
    expect(overworld.semantics.ledges).toContainEqual({ facing: "down", standingOn: 0x2c, ledge: 0x37 });
    expect(overworld.semantics.cutTrees[0]).toEqual({ block: 0x32, replacement: 0x6d });
    expect(overworld.semantics.hasWater).toBe(true);
    const facility = world.tilesets.find((t) => t.name === "FACILITY")!;
    expect(facility.semantics.spinners).toEqual([0x20, 0x21, 0x30, 0x31]);
    expect(facility.semantics.warpPads).toEqual([0x20]);
    expect(facility.semantics.holes).toEqual([0x11]);
    const mart = world.tilesets.find((t) => t.name === "MART")!;
    expect(mart.semantics.counters).toEqual([0x18, 0x19, 0x1e]);
    expect(mart.tiles).toBe(world.tilesets.find((t) => t.name === "POKECENTER")!.tiles);
  });

  it("reads sprite sheets byte for byte as the disassembly's graphics", () => {
    const gfx = (name: string) => new URL(`../../../../vendor/pokered/gfx/sprites/${name}.2bpp`, import.meta.url);
    const check = (sheet: { tiles: Uint8Array }, name: string) => {
      if (!existsSync(gfx(name))) return;
      const want = decode2bpp(new Uint8Array(readFileSync(gfx(name))));
      expect(Array.from(sheet.tiles.subarray(0, want.length))).toEqual(Array.from(want));
    };
    expect(world.sprites).toHaveLength(0x49);
    expect(world.sprites[0]).toBeNull();
    const red = world.sprites[0x01]!;
    expect(red.still).toBe(false);
    expect(red.tiles).toHaveLength(24 * 64);
    check(red, "red");
    check(world.sprites[0x03]!, "oak");
    check(world.bikeSprite, "red_bike");
    const ball = world.sprites[0x3d]!;
    expect(ball.still).toBe(true);
    expect(ball.tiles).toHaveLength(4 * 64);
    check(ball, "poke_ball");
    // Oak's lab: the three starters' balls on the table.
    const lab = map("OAKS_LAB");
    expect(lab.npcs.filter((n) => n.sprite === 0x3d).length).toBeGreaterThanOrEqual(3);
  });
});
