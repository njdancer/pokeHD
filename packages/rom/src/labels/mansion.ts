import type { TilesetLabelTable } from "./types.ts";

/**
 * MANSION (tileset 19): Celadon Mansion 1F–3F and its roof, and the Celadon chief's house.
 * Doors 0x1a and 0x53 come from the ROM.
 */
export const MANSION: TilesetLabelTable = {
  tiles: {
    0x00: "unused",
    0x01: "floor", // speckled floor
    0x02: "furniture", // chairs
    0x03: "furniture",
    0x04: "floor", // doormat (the exit)
    0x05: "floor",
    0x06: "picture", // the plaque by the penthouse door (roof)
    0x07: "picture",
    0x08: "plant", // potted palms
    0x09: "plant",
    0x0a: "door", // dark doorways (0x1a comes from the ROM)
    0x0b: "door",
    0x0c: "stairs", // 0x1c is a warp, a "door" to the ROM
    0x0d: "stairs",
    0x0e: "unused",
    0x0f: "fence", // the roof's railings
    0x10: "void",
    0x11: "floor", // checked carpet, and its shadowed edge
    0x12: "furniture",
    0x13: "furniture",
    0x14: "floor",
    0x15: "statue", // the ornaments in the display cabinets
    0x16: "picture", // the plaque on the partition (1F, 3F)
    0x17: "picture",
    0x18: "plant",
    0x19: "plant",
    0x1b: "door",
    0x1c: "stairs",
    0x1d: "stairs",
    0x1e: "wall-interior", // the partitions' dark faces
    0x1f: "fence",
    0x20: "void", // the roof's border block: the flat grey drop beyond the roof's edge
    0x21: "fence",
    0x22: "shelf", // cabinets
    0x23: "shelf",
    0x24: "table", // desks
    0x25: "table",
    0x26: "table", // the long tables; the penthouse roof reuses them (see blocks)
    0x27: "table",
    0x28: "shelf", // the display cabinets' sides
    0x29: "table",
    0x2a: "fence",
    0x2b: "fence",
    0x2c: "wall-interior",
    0x2d: "furniture", // a bed
    0x2e: "furniture",
    0x2f: "furniture",
    0x30: "wall-interior",
    0x31: "fence",
    0x32: "shelf",
    0x33: "shelf",
    0x34: "machine", // PCs on desks
    0x35: "machine",
    0x36: "table",
    0x37: "table",
    0x38: "shelf",
    0x39: "table",
    0x3a: "table",
    0x3b: "table",
    0x3c: "table",
    0x3d: "furniture",
    0x3e: "furniture",
    0x3f: "furniture",
    0x40: "table",
    0x41: "table",
    0x42: "machine",
    0x43: "machine",
    0x44: "plant",
    0x45: "plant",
    0x46: "plant",
    0x47: "plant",
    0x48: "wall-interior",
    0x49: "wall-interior",
    0x4a: "wall-interior", // the white tops of the partitions, running north–south
    0x4b: "wall-interior",
    0x4c: "wall-interior", // ... and east–west
    0x4d: "wall-interior",
    0x4e: "wall-interior",
    0x4f: "wall-interior",
    0x50: "wall-interior", // striped back wall
    0x51: "door", // the penthouse door (0x53 comes from the ROM)
    0x52: "door",
    0x54: "door",
    0x55: "table",
    0x56: "table",
    0x57: "statue",
    0x58: "wall-interior",
    0x59: "wall-interior",
    0x5a: "wall-interior",
    0x5b: "wall-interior",
    0x5c: "wall-interior",
    0x5d: "wall-interior",
    0x5e: "unused",
    0x5f: "unused",
  },
  blocks: {
    // The penthouse on the roof: a roof made of the table tiles, and walls of the partition faces.
    0x21: { 2: "roof", 3: "roof", 6: "roof", 7: "roof", 10: "roof", 11: "roof", 14: "roof", 15: "roof" },
    0x22: { 0: "roof", 1: "roof", 2: "roof", 3: "roof", 4: "roof", 5: "roof", 6: "roof", 7: "roof", 8: "roof", 9: "roof", 10: "roof", 11: "roof", 12: "roof", 13: "roof", 14: "roof", 15: "roof" },
    0x25: { 2: "roof", 3: "roof", 6: "roof", 7: "roof", 10: "wall", 11: "wall", 14: "wall", 15: "wall" },
    0x26: { 0: "roof", 1: "roof", 2: "roof", 3: "roof", 4: "roof", 5: "roof", 6: "roof", 7: "roof", 10: "wall", 11: "wall" },
  },
};
