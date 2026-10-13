import type { TilesetLabelTable } from "./types.ts";

/**
 * CLUB (tileset 21): the Bike Shop and the Cable Club's Trade Centre and Colosseum. Counters 0x07 and
 * 0x17 are the ROM's own list.
 */
export const CLUB: TilesetLabelTable = {
  tiles: {
    0x00: "unused",
    0x01: "machine", // bicycles for sale
    0x02: "machine",
    0x03: "wall-interior", // striped back wall
    0x04: "unused",
    0x05: "counter", // the shop and Cable Club counters; the trade table reuses them (see blocks)
    0x06: "wall-interior",
    0x07: "counter",
    0x08: "counter",
    0x09: "machine",
    0x0a: "floor", // doormat (the exit)
    0x0b: "machine",
    0x0c: "machine",
    0x0d: "machine",
    0x0e: "machine", // checked floor under a bicycle's wheels: solid, part of the bike
    0x0f: "floor",
    0x10: "counter",
    0x11: "machine",
    0x12: "machine",
    0x13: "machine",
    0x14: "unused",
    0x15: "machine",
    0x16: "machine",
    0x17: "counter",
    0x18: "counter",
    0x19: "unused",
    0x1a: "floor",
    0x1b: "machine",
    0x1c: "machine",
    0x1d: "machine",
    0x1e: "machine",
    0x1f: "floor",
    0x20: "unused",
    0x21: "unused",
    0x22: "unused",
    0x23: "unused",
    0x24: "unused",
    0x25: "unused",
    0x26: "furniture", // stools
    0x27: "furniture",
    0x28: "floor", // the rings painted round the link tables
    0x29: "floor",
    0x2a: "floor",
    0x2b: "floor",
    0x2c: "floor",
    0x2d: "floor",
    0x2e: "floor",
    0x2f: "floor",
    0x30: "picture", // the link-cable emblem on the back wall
    0x31: "picture",
    0x32: "picture",
    0x33: "picture",
    0x34: "wall-interior", // pillars
    0x35: "wall-interior",
    0x36: "counter",
    0x37: "machine", // the link machine in the Colosseum
    0x38: "machine",
    0x39: "machine",
    0x3a: "machine",
    0x3b: "machine",
    0x3c: "machine",
    0x3d: "machine",
    0x3e: "machine",
    0x3f: "picture", // framed pictures (Trade Centre)
    0x40: "floor",
    0x41: "floor",
    0x42: "picture",
    0x43: "picture",
    0x44: "picture",
    0x45: "picture",
    0x46: "picture",
    0x47: "machine", // Game Boys on the trade table
    0x48: "machine",
    0x49: "machine",
    0x4a: "machine",
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
    // The trade table's base reuses the counter front.
    0x1c: { 4: "table", 5: "table", 6: "table", 7: "table" },
  },
};
