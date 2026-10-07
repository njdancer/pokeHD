import type { TilesetLabelTable } from "./types.ts";

/**
 * GYM and DOJO (tilesets 7 and 5, one set of graphics and blocks): Oak's lab, the Fighting Dojo,
 * eight gyms and the Elite Four rooms. 0x03 and 0x14 animate as flower and water.
 */
export const GYM: TilesetLabelTable = {
  tiles: {
    0x00: "unused", // no map draws 0x00, 0x15, 0x28 or 0x3a
    0x01: "shore", // the pool's lip (Cerulean)
    0x02: "statue",
    0x03: "flower",
    0x04: "shore", // the pool's edge (Cerulean)
    0x05: "wall-interior", // back wall
    0x06: "floor", // doormat (the exit)
    0x07: "rock", // boulders (Pewter, Bruno)
    0x08: "rock",
    0x09: "floor", // stone tiles (Cerulean deck, Hall of Fame)
    0x0a: "floor",
    0x0b: "furniture", // bins (Vermilion)
    0x0c: "furniture",
    0x0d: "shelf",
    0x0e: "shelf",
    0x0f: "wall-interior", // the black top of walls and partitions, and the mass beyond them (Lance's room)
    0x10: "wall-interior",
    0x11: "floor",
    0x12: "statue",
    0x13: "statue",
    0x14: "water",
    0x15: "unused",
    0x16: "floor",
    0x17: "rock",
    0x18: "rock",
    0x19: "floor",
    0x1a: "floor",
    0x1b: "furniture",
    0x1c: "furniture",
    0x1d: "shelf", // a bookshelf to the ROM
    0x1e: "shelf",
    0x1f: "floor", // Fuchsia's invisible walls: drawn as floor, and blocking
    0x20: "door", // Elite Four doors
    0x21: "door",
    0x22: "statue",
    0x23: "statue",
    0x24: "wall-interior", // partition walls (Viridian, Vermilion, the Dojo, the Elite Four)
    0x25: "wall-interior",
    0x26: "wall-interior",
    0x27: "wall-interior",
    0x28: "unused",
    0x29: "table", // Oak's desks
    0x2a: "table",
    0x2b: "lawn", // Celadon's garden ground
    0x2c: "tree", // bushes (Celadon)
    0x2d: "tree",
    0x2e: "tree",
    0x2f: "tree",
    0x30: "door",
    0x31: "door",
    0x32: "statue",
    0x33: "statue",
    0x34: "picture", // Oak's posters and the Dojo's scrolls
    0x35: "wall-interior",
    0x36: "machine", // Oak's PC and the Hall of Fame machine
    0x37: "machine",
    0x38: "statue",
    0x39: "table",
    0x3a: "unused",
    0x3b: "table",
    0x3c: "floor", // spinner arrows (Viridian), with 0x3d, 0x4c, 0x4d and the stop tile 0x3f
    0x3d: "floor",
    0x3e: "wall-interior",
    0x3f: "floor",
    0x40: "tree", // the Cut tree (Celadon)
    0x41: "tree",
    0x42: "wall-interior",
    0x43: "picture",
    0x44: "wall-interior",
    0x45: "picture", // wall lamps (Vermilion)
    0x46: "picture",
    0x47: "wall-interior",
    0x48: "stairs", // stairs to the Champion (Lance)
    0x49: "stairs",
    0x4a: "stairs",
    0x4b: "stairs",
    0x4c: "floor",
    0x4d: "floor",
    0x4e: "table",
    0x4f: "table",
    0x50: "tree",
    0x51: "tree",
    0x52: "picture",
    0x53: "picture",
    0x54: "wall-interior",
    0x55: "machine",
    0x56: "wall-interior",
    0x57: "wall-interior",
    0x58: "table", // under Oak's desks
    0x59: "table",
    0x5a: "table",
    0x5b: "machine",
    0x5c: "machine",
    0x5d: "machine",
    0x5e: "machine",
    0x5f: "machine",
  },
  blocks: {
    // The bookshelf tops reuse the desk's top edge.
    0x26: { 2: "shelf", 3: "shelf" },
    0x68: { 0: "shelf", 1: "shelf", 2: "shelf", 3: "shelf" },
    // The Hall of Fame machine stands on the desk's base.
    0x37: { 0: "machine", 1: "machine", 2: "machine", 3: "machine" },
  },
};
