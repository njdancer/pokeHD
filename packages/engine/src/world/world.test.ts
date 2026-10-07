import { describe, expect, it } from "vitest";
import type { MapData, Tileset, WorldData } from "@pokehd/rom";
import { findBuildings, findTrees } from "./analyse.ts";
import { meshHeightfield } from "./heightfield.ts";
import { buildRegion, placeMaps } from "./region.ts";

const flat = { origin: [0, 0, 0], ax: [1, 0, 0], ay: [0, 0, 1], ah: [0, 1, 0], uv: () => [0, 0] as const } as const;

describe("meshHeightfield", () => {
  it("merges a flat run into one top quad and walls only its outline", () => {
    const m = meshHeightfield({ ...flat, width: 4, height: 1, heights: new Float32Array([1, 1, 1, 1]), base: 0 });
    // 1 top + 2 long walls + 2 end walls.
    expect(m.indices.length / 6).toBe(5);
  });

  it("winds every face outward", () => {
    const m = meshHeightfield({ ...flat, width: 2, height: 2, heights: new Float32Array([1, 0.5, 0.25, NaN]), base: 0 });
    for (let t = 0; t < m.indices.length; t += 3) {
      const [a, b, c] = [m.indices[t]!, m.indices[t + 1]!, m.indices[t + 2]!].map((i) => [0, 1, 2].map((k) => m.positions[i * 3 + k]!));
      const e1 = a!.map((v, k) => b![k]! - v);
      const e2 = a!.map((v, k) => c![k]! - v);
      const n = [e1[1]! * e2[2]! - e1[2]! * e2[1]!, e1[2]! * e2[0]! - e1[0]! * e2[2]!, e1[0]! * e2[1]! - e1[1]! * e2[0]!];
      const expected = [0, 1, 2].map((k) => m.normals[m.indices[t]! * 3 + k]!);
      expect(n[0]! * expected[0]! + n[1]! * expected[1]! + n[2]! * expected[2]!).toBeGreaterThan(0);
    }
  });
});

// A one-block tileset: tile 0 ground (shade 0), tile 1 tree, tile 2 roof, tile 3 wall.
function fakeWorld(): WorldData {
  const tileset = {
    id: 0,
    name: "OVERWORLD",
    blocks: new Uint8Array(16 * 4),
    blockCount: 4,
    tiles: new Uint8Array(96 * 64).fill(1),
    animation: "none",
    semantics: { walkable: [], grass: null, counters: [], doors: [], warps: [], warpCarpets: [], bookshelves: [], pairCollisions: [], ledges: [], warpPads: [], holes: [], spinners: [], cutTrees: [], hasWater: false },
  } as Tileset;
  // Block 0: ground (OVERWORLD tile 0x00). Block 1: all tree (0x2a). Block 2: roof (0x05) over wall (0x0f).
  tileset.blocks.fill(0x00, 0, 16);
  tileset.blocks.fill(0x2a, 16, 32);
  tileset.blocks.fill(0x05, 32, 40);
  tileset.blocks.fill(0x0f, 40, 48);
  const map = (id: number, name: string, blocks: number[], w: number, connections: MapData["connections"]): MapData => ({
    id, name, tileset: 0, widthBlocks: w, heightBlocks: blocks.length / w, blocks: new Uint8Array(blocks),
    borderBlock: 1, connections, warps: [], signs: [], npcs: [],
  });
  return {
    tilesets: [tileset],
    maps: [
      map(0, "A", [0, 2, 0, 0], 2, [{ direction: "north", map: 1, offsetBlocks: 1 }]),
      map(1, "B", [0, 0, 0], 3, [{ direction: "south", map: 0, offsetBlocks: -1 }]),
    ],
  };
}

describe("regions", () => {
  it("places connected maps by their offsets", () => {
    expect(placeMaps(fakeWorld(), 0, [1]).map((p) => [p.map.name, p.bx, p.by])).toEqual([["A", 0, 0], ["B", 1, -1]]);
  });

  it("stitches maps into one tile grid with border blocks around them", () => {
    const r = buildRegion(fakeWorld(), 0, { include: [1], marginBlocks: 1 });
    expect([r.widthTiles, r.heightTiles]).toEqual([(4 + 2) * 4, (3 + 2) * 4]);
    expect([r.rootX, r.rootY]).toEqual([4, 8]);
    // The margin is the border block: all trees, one per step.
    expect(findTrees(r).length).toBeGreaterThan(0);
  });

  it("finds a building and reads its bottom rows as the front wall", () => {
    const r = buildRegion(fakeWorld(), 0, { marginBlocks: 0 });
    expect(findBuildings(r)).toEqual([{ x0: 4, y0: 0, x1: 8, y1: 4, facadeRows: 2 }]);
  });
});
