import type { TilesetLabelTable } from "./types.ts";

/**
 * INTERIOR (tileset 16): Bill's house, the Pokémon Fan Club and Silph Co. 11F.
 */
export const INTERIOR: TilesetLabelTable = {
  tiles: {
    0x00: "unused",
    0x01: "machine",
    0x02: "machine",
    0x03: "door", // the elevator (0x04 is the warp)
    0x04: "door",
    0x05: "stairs", // 0x15 is the warp
    0x06: "stairs",
    0x07: "machine", // Bill's Cell Separator and its pipe
    0x08: "machine",
    0x09: "machine",
    0x0a: "machine",
    0x0b: "table", // desks
    0x0c: "table",
    0x0d: "machine", // PCs on desks
    0x0e: "machine",
    0x0f: "floor", // the floor's shadowed edge under the back wall
    0x10: "wall-interior", // striped back wall
    0x11: "statue", // the statue on the big table
    0x12: "statue",
    0x13: "picture", // framed pictures
    0x14: "picture",
    0x15: "stairs",
    0x16: "stairs",
    0x17: "machine",
    0x18: "machine",
    0x19: "machine",
    0x1a: "machine",
    0x1b: "table",
    0x1c: "table",
    0x1d: "machine",
    0x1e: "machine",
    0x1f: "floor",
    0x20: "machine",
    0x21: "statue",
    0x22: "statue",
    0x23: "picture",
    0x24: "picture",
    0x25: "machine",
    0x26: "machine",
    0x27: "machine",
    0x28: "machine",
    0x29: "machine",
    0x2a: "machine",
    0x2b: "table",
    0x2c: "table",
    0x2d: "wall-interior", // Silph Co.'s black partitions and their top edges
    0x2e: "wall-interior",
    0x2f: "wall-interior",
    0x30: "machine",
    0x31: "furniture", // the sofa
    0x32: "furniture",
    0x33: "furniture",
    0x34: "wall-interior", // the Fan Club's plain back wall and its skirting
    0x35: "machine",
    0x36: "machine",
    0x37: "machine", // the base of a round machine against the back wall
    0x38: "machine",
    0x39: "machine",
    0x3a: "machine",
    0x3b: "furniture", // chairs
    0x3c: "furniture",
    0x3d: "furniture",
    0x3e: "furniture",
    0x3f: "table",
    0x40: "table", // the big eight-sided table
    0x41: "furniture",
    0x42: "furniture",
    0x43: "furniture",
    0x44: "wall-interior",
    0x45: "floor",
    0x46: "floor", // doormat (the exit)
    0x47: "floor",
    0x48: "table",
    0x49: "table",
    0x4a: "table",
    0x4b: "table",
    0x4c: "table",
    0x4d: "table",
    0x4e: "table",
    0x4f: "table",
    0x50: "machine",
    0x51: "table",
    0x52: "table",
    0x53: "floor", // the teleport pad (Silph Co. 11F)
    0x54: "floor",
    0x55: "floor",
    0x56: "floor",
    0x57: "wall-interior",
    0x58: "wall-interior", // the partitions' striped faces; desks reuse them (see blocks)
    0x59: "wall-interior",
    0x5a: "wall-interior",
    0x5b: "wall-interior",
    0x5c: "wall-interior",
    0x5d: "unused",
    0x5e: "unused",
    0x5f: "unused",
  },
  blocks: {
    // Desks and the statue's plinth reuse the partition faces.
    0x02: { 8: "table", 9: "table" },
    0x38: { 10: "table", 11: "table" },
    0x10: { 15: "statue" },
    0x11: { 12: "statue" },
  },
};
