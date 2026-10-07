import type { TilesetLabelTable } from "./types.ts";

/**
 * POKECENTER and MART (tilesets 6 and 2, one set of graphics and blocks): every Pokécentre and
 * Poké Mart, and the Indigo Plateau lobby. Counters 0x18, 0x19 and 0x1e are the ROM's own list.
 */
export const POKECENTER: TilesetLabelTable = {
  tiles: {
    0x00: "void",
    0x01: "floor",
    0x02: "picture", // the POKé emblem on the back wall
    0x03: "picture",
    0x04: "counter",
    0x05: "counter",
    0x06: "machine",
    0x07: "machine",
    0x08: "counter",
    0x09: "machine",
    0x0a: "counter", // a Poké Ball on the counter
    0x0b: "floor",
    0x0c: "floor", // doormat (the exit)
    0x0d: "machine",
    0x0e: "counter",
    0x0f: "counter",
    0x10: "counter", // the counter's side
    0x11: "floor",
    0x12: "picture",
    0x13: "picture",
    0x14: "counter",
    0x15: "counter",
    0x16: "machine",
    0x17: "shelf",
    0x18: "counter",
    0x19: "counter",
    0x1a: "floor",
    0x1b: "floor",
    0x1c: "floor",
    0x1d: "shelf",
    0x1e: "counter",
    0x1f: "counter",
    0x20: "plant",
    0x21: "plant",
    0x22: "plant",
    0x23: "plant",
    0x24: "furniture", // bench
    0x25: "furniture",
    0x26: "furniture",
    0x27: "furniture",
    0x28: "wall-interior", // the back wall; the game also draws the space behind the counters with it
    0x29: "counter",
    0x2a: "furniture",
    0x2b: "furniture",
    0x2c: "shelf", // glass-fronted fridge (Mart)
    0x2d: "shelf",
    0x2e: "shelf",
    0x2f: "shelf",
    0x30: "plant",
    0x31: "plant",
    0x32: "plant",
    0x33: "plant",
    0x34: "furniture",
    0x35: "furniture",
    0x36: "floor", // floor in a shadow
    0x37: "unused", // no block draws 0x37 or 0x3d
    0x38: "counter",
    0x39: "floor",
    0x3a: "machine", // healing machine
    0x3b: "machine",
    0x3c: "floor",
    0x3d: "unused",
    0x3e: "shelf",
    0x3f: "shelf",
    0x40: "shelf",
    0x41: "shelf",
    0x42: "machine", // PC
    0x43: "shelf",
    0x44: "shelf",
    0x45: "shelf",
    0x46: "machine",
    0x47: "shelf",
    0x48: "machine",
    0x49: "machine",
    0x4a: "machine",
    0x4b: "machine",
    0x4c: "machine",
    0x4d: "machine",
    0x4e: "lettering", // SALE
    0x4f: "lettering",
    0x50: "shelf",
    0x51: "shelf",
    0x52: "machine",
    0x53: "shelf",
    0x54: "shelf", // a bookshelf to the ROM (PokemonStuffText)
    0x55: "shelf",
    0x56: "machine",
    0x57: "shelf",
    0x58: "machine",
    0x59: "machine", // cash register
    0x5a: "counter", // counter top
    0x5b: "counter",
    0x5c: "door", // doorway to the Cable Club (0x5e warps)
    0x5d: "door",
    0x5e: "door",
    0x5f: "door",
  },
  blocks: {
    // The Mart's display cases reuse the healing machine's screen.
    0x09: { 8: "shelf", 9: "shelf", 10: "shelf", 11: "shelf" },
    0x12: { 8: "shelf", 9: "shelf", 10: "shelf", 11: "shelf" },
    // The Mart's fridges reuse the counter top.
    0x13: { 0: "shelf", 1: "shelf", 2: "shelf", 3: "shelf" },
  },
};
