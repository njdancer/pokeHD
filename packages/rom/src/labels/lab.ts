import type { TilesetLabelTable } from "./types.ts";

/**
 * LAB (tileset 20): the Cinnabar Lab rooms, the Safari Zone warden's house and secret house, and the
 * Fuchsia meeting room. Door 0x34 comes from the ROM.
 */
export const LAB: TilesetLabelTable = {
  tiles: {
    0x00: "unused",
    0x01: "floor", // checked floor
    0x02: "table", // desks
    0x03: "table",
    0x04: "machine", // PCs on desks
    0x05: "machine",
    0x06: "table",
    0x07: "table",
    0x08: "table",
    0x09: "table",
    0x0a: "machine", // lab machines
    0x0b: "machine",
    0x0c: "floor", // the striped floor under the fossil machines
    0x0d: "floor",
    0x0e: "furniture",
    0x0f: "furniture",
    0x10: "picture", // the framed picture on the back wall
    0x11: "picture",
    0x12: "table",
    0x13: "table",
    0x14: "machine",
    0x15: "machine",
    0x16: "furniture", // chairs and stools
    0x17: "furniture",
    0x18: "picture", // the signs over the lab's doors; the Warden's display case reuses them (see blocks)
    0x19: "picture",
    0x1a: "machine",
    0x1b: "machine",
    0x1c: "shelf",
    0x1d: "shelf",
    0x1e: "furniture",
    0x1f: "furniture",
    0x20: "picture",
    0x21: "picture",
    0x22: "wall-interior", // striped back wall; counters reuse it as their front (see blocks)
    0x23: "wall-interior",
    0x24: "shelf",
    0x25: "shelf",
    0x26: "floor",
    0x27: "floor", // doormat (the exit)
    0x28: "shelf", // bookshelves
    0x29: "shelf",
    0x2a: "table", // the counters' ends
    0x2b: "table",
    0x2c: "plant", // potted palms
    0x2d: "plant",
    0x2e: "plant",
    0x2f: "plant",
    0x30: "picture", // the mounted specimens on the meeting room's wall
    0x31: "picture",
    0x32: "rock", // boulders (Warden's house)
    0x33: "rock",
    0x35: "door",
    0x36: "void",
    0x37: "floor",
    0x38: "unused",
    0x39: "unused",
    0x3a: "table",
    0x3b: "machine",
    0x3c: "plant",
    0x3d: "plant",
    0x3e: "plant",
    0x3f: "plant",
    0x40: "table", // big tables, with papers on them
    0x41: "table",
    0x42: "table",
    0x43: "rock",
    0x44: "rock",
    0x45: "machine", // the fossil machines
    0x46: "machine",
    0x47: "shelf",
    0x48: "table",
    0x49: "table",
    0x4a: "machine",
    0x4b: "machine",
    0x4c: "door", // the lab's doors (0x34 comes from the ROM)
    0x4d: "door",
    0x4e: "unused",
    0x4f: "unused",
    0x50: "table",
    0x51: "table",
    0x52: "table",
    0x53: "table",
    0x54: "table",
    0x55: "machine",
    0x56: "machine",
    0x57: "shelf", // the Warden's display case
    0x58: "shelf",
    0x59: "shelf",
    0x5a: "machine",
    0x5b: "machine",
    0x5c: "unused",
    0x5d: "unused",
    0x5e: "unused",
    0x5f: "unused",
  },
  blocks: {
    // The Warden's display case reuses the door signs, back wall and counter ends.
    0x20: { 9: "shelf", 10: "shelf", 12: "shelf", 13: "shelf", 14: "shelf", 15: "shelf" },
    // Counter fronts reuse the back wall.
    0x34: { 12: "table", 13: "table", 14: "table" },
    0x36: { 13: "table", 14: "table", 15: "table" },
    0x37: { 12: "table", 13: "table", 14: "table", 15: "table" },
  },
};
