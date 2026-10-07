import type { TilesetLabelTable } from "./types.ts";

/**
 * REDS_HOUSE_1 and REDS_HOUSE_2 (tilesets 1 and 4, one set of graphics and blocks): both floors
 * of Red's house, and the Copycat's house in Saffron.
 */
export const REDS_HOUSE: TilesetLabelTable = {
  tiles: {
    0x00: "wall-interior",
    0x01: "floor",
    0x02: "furniture",
    0x03: "furniture",
    0x04: "floor", // doormat (the exit)
    0x05: "unused", // no block draws 0x05, 0x11, 0x15 or 0x48–0x5f
    0x06: "machine", // TV
    0x07: "machine",
    0x08: "plant",
    0x09: "plant",
    0x0a: "stairs", // stairs down
    0x0b: "stairs",
    0x0c: "stairs", // stairs up
    0x0d: "stairs",
    0x0e: "machine", // games console
    0x0f: "machine",
    0x10: "void", // unused by the maps, but black like the void elsewhere
    0x11: "unused",
    0x12: "furniture",
    0x13: "furniture",
    0x14: "floor", // doormat; a warp tile
    0x15: "unused",
    0x16: "machine",
    0x17: "machine",
    0x18: "plant",
    0x19: "plant",
    0x1a: "stairs",
    0x1b: "stairs",
    0x1c: "stairs",
    0x1d: "stairs",
    0x1e: "machine",
    0x1f: "machine",
    0x20: "machine", // PC
    0x21: "machine",
    0x22: "shelf",
    0x23: "shelf",
    0x24: "window",
    0x25: "window",
    0x26: "table",
    0x27: "table",
    0x28: "table",
    0x29: "table",
    0x2a: "table",
    0x2b: "table",
    0x2c: "table",
    0x2d: "furniture", // bed
    0x2e: "furniture",
    0x2f: "furniture",
    0x30: "shelf",
    0x31: "shelf",
    0x32: "shelf", // a bookshelf to the ROM (BookOrSculptureText)
    0x33: "shelf",
    0x34: "window",
    0x35: "window",
    0x36: "table",
    0x37: "table", // food on the dining table
    0x38: "table",
    0x39: "table",
    0x3a: "table",
    0x3b: "table",
    0x3c: "table",
    0x3d: "furniture",
    0x3e: "furniture",
    0x3f: "furniture",
    0x40: "machine",
    0x41: "machine",
    0x42: "machine",
    0x43: "machine",
    0x44: "plant",
    0x45: "plant",
    0x46: "plant",
    0x47: "plant",
    0x48: "unused",
    0x49: "unused",
    0x4a: "unused",
    0x4b: "unused",
    0x4c: "unused",
    0x4d: "unused",
    0x4e: "unused",
    0x4f: "unused",
    0x50: "unused",
    0x51: "unused",
    0x52: "unused",
    0x53: "unused",
    0x54: "unused",
    0x55: "unused",
    0x56: "unused",
    0x57: "unused",
    0x58: "unused",
    0x59: "unused",
    0x5a: "unused",
    0x5b: "unused",
    0x5c: "unused",
    0x5d: "unused",
    0x5e: "unused",
    0x5f: "unused",
  },
  blocks: {
    // The bookshelf's top reuses the dining table's top edge.
    0x04: { 0: "shelf", 1: "shelf", 2: "shelf", 3: "shelf" },
    // The desk under the PC upstairs reuses the bookshelf's base.
    0x10: { 12: "machine", 13: "machine" },
  },
};
