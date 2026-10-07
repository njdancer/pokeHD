import type { MapData, Tileset, WorldData } from "@pokehd/rom";

// Tests only: a tiny overworld built from the real OVERWORLD label table.
// A one-block tileset: tile 0 ground (shade 0), tile 1 tree, tile 2 roof, tile 3 wall.
export function fakeWorld(): WorldData {
  const tileset = {
    id: 0,
    name: "OVERWORLD",
    blocks: new Uint8Array(16 * 4),
    blockCount: 4,
    tiles: new Uint8Array(96 * 64).fill(1),
    animation: "none",
    semantics: { walkable: [0x00], grass: null, counters: [], doors: [], warps: [], warpCarpets: [], bookshelves: [], pairCollisions: [], ledges: [], warpPads: [], holes: [], spinners: [], cutTrees: [], hasWater: false },
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
  // Sprite 1: a blank walking sheet.
  const sheet = { id: 1, still: false, tiles: new Uint8Array(24 * 64) };
  return {
    tilesets: [tileset],
    sprites: [null, sheet],
    bikeSprite: { ...sheet, id: 0 },
    maps: [
      map(0, "A", [0, 2, 0, 0], 2, [{ direction: "north", map: 1, offsetBlocks: -1 }]),
      map(1, "B", [0, 0, 0], 3, [{ direction: "south", map: 0, offsetBlocks: 1 }]),
      map(2, "C", [0], 1, []),
    ],
  };
}

