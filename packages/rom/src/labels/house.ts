import type { TilesetLabelTable } from "./types.ts";

/**
 * HOUSE (tileset 8): Blue's house, the Viridian houses and school, and most other town houses.
 * The door (0x54, the hole in the trashed house's wall in Cerulean) comes from the ROM.
 */
export const HOUSE: TilesetLabelTable = {
  tiles: {
    0x00: "wall-interior",
    0x01: "floor",
    0x02: "furniture",
    0x03: "furniture",
    0x04: "floor", // doormat (the exit)
    0x05: "unused", // no block draws 0x05–0x07, 0x11, 0x15–0x17, 0x32, 0x33, 0x4c–0x4f or 0x5c–0x5f
    0x06: "unused",
    0x07: "unused",
    0x08: "plant",
    0x09: "plant",
    0x0a: "plant",
    0x0b: "plant",
    0x0c: "plant",
    0x0d: "plant",
    0x0e: "shelf",
    0x0f: "shelf",
    0x10: "void", // unused by the maps, but black like the void elsewhere
    0x11: "unused",
    0x12: "furniture",
    0x13: "furniture",
    0x14: "floor", // doormat; a warp tile
    0x15: "unused",
    0x16: "unused",
    0x17: "unused",
    0x18: "plant",
    0x19: "plant",
    0x1a: "plant",
    0x1b: "plant",
    0x1c: "furniture", // knocked-over stool (Cerulean trashed house)
    0x1d: "furniture",
    0x1e: "shelf", // a bookshelf to the ROM
    0x1f: "shelf",
    0x20: "machine", // PC; only in blocks no map uses
    0x21: "machine",
    0x22: "furniture", // debris (trashed house)
    0x23: "door", // the hole in the trashed house's wall, with 0x4a, 0x54 (ROM door) and 0x55
    0x24: "window",
    0x25: "plant",
    0x26: "table",
    0x27: "table",
    0x28: "floor", // footprints and debris on the floor; walkable
    0x29: "table",
    0x2a: "plant", // toppled plant (trashed house)
    0x2b: "plant",
    0x2c: "plant",
    0x2d: "picture", // town map (TownMapText)
    0x2e: "picture",
    0x2f: "table",
    0x30: "shelf",
    0x31: "shelf",
    0x32: "unused",
    0x33: "unused",
    0x34: "window",
    0x35: "plant",
    0x36: "table",
    0x37: "floor",
    0x38: "plant",
    0x39: "table",
    0x3a: "table",
    0x3b: "table",
    0x3c: "table",
    0x3d: "picture",
    0x3e: "picture",
    0x3f: "wall-interior", // cracked wall (trashed house)
    0x40: "machine",
    0x41: "machine",
    0x42: "machine",
    0x43: "machine",
    0x44: "furniture",
    0x45: "furniture",
    0x46: "table", // open book on a table
    0x47: "table",
    0x48: "picture", // blackboard (school)
    0x49: "picture",
    0x4a: "door",
    0x4b: "picture",
    0x4c: "unused",
    0x4d: "unused",
    0x4e: "unused",
    0x4f: "unused",
    0x50: "furniture", // toppled shelf (trashed house)
    0x51: "furniture",
    0x52: "furniture",
    0x53: "furniture",
    0x55: "door",
    0x56: "table",
    0x57: "table",
    0x58: "picture",
    0x59: "picture",
    0x5a: "picture",
    0x5b: "picture",
    0x5c: "unused",
    0x5d: "unused",
    0x5e: "unused",
    0x5f: "unused",
  },
  blocks: {
    // Bookshelf tops reuse the table's top edge.
    0x04: { 0: "shelf", 1: "shelf", 2: "shelf", 3: "shelf" },
    0x09: { 2: "shelf", 3: "shelf" },
    0x1a: { 0: "shelf", 1: "shelf", 2: "shelf", 3: "shelf" },
    // The desk under the PC reuses the bookshelf's base.
    0x10: { 12: "machine", 13: "machine" },
  },
};
