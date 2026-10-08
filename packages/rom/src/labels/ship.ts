import type { TilesetLabelTable } from "./types.ts";

/**
 * SHIP (tileset 13): the S.S. Anne's decks, cabins, kitchen, captain's room and bow, and two houses that
 * borrow it. Door 0x1e comes from the ROM. The black between the corridors and cabins is the walls'
 * tops, as in the gyms. 0x14 animates as water (the sea off the bow).
 */
export const SHIP: TilesetLabelTable = {
  tiles: {
    0x00: "unused",
    0x01: "wall-interior", // the black mass beyond the corridors and between cabins
    0x02: "window", // portholes
    0x03: "window",
    0x04: "floor", // deck planks
    0x05: "wall-interior", // the walls' top edges
    0x06: "wall-interior",
    0x07: "table", // round tables and their legs
    0x08: "table",
    0x09: "table", // the long tables, with plates
    0x0a: "table",
    0x0b: "table",
    0x0c: "table",
    0x0d: "floor", // checked cabin floor
    0x0e: "door", // the cabin doors (0x1e comes from the ROM)
    0x0f: "door",
    0x10: "wall-interior", // cabin back walls with their rail
    0x11: "wall-interior",
    0x12: "wall-interior",
    0x13: "wall-interior",
    0x14: "water", // the sea off the bow
    0x15: "wall-interior",
    0x16: "wall-interior",
    0x17: "table",
    0x18: "table",
    0x19: "table",
    0x1a: "table",
    0x1b: "unused",
    0x1c: "table",
    0x1d: "floor",
    0x1f: "door",
    0x20: "wall-interior",
    0x21: "wall-interior",
    0x22: "wall-interior",
    0x23: "floor", // deck shadow under the rails
    0x24: "wall-interior", // the bulkhead under the dining room
    0x25: "wall-interior",
    0x26: "wall-interior",
    0x27: "stairs", // stairs between decks (0x37 is the warp)
    0x28: "stairs",
    0x29: "stairs", // the stairs down below deck (0x39 is the warp)
    0x2a: "stairs",
    0x2b: "shelf", // the cabinet that prints text
    0x2c: "table",
    0x2d: "fence", // bollards on the bow
    0x2e: "fence", // the bow's bulwark
    0x2f: "fence",
    0x30: "wall-interior",
    0x31: "wall-interior",
    0x32: "wall-interior",
    0x33: "wall-interior",
    0x34: "floor", // the dark step along the cabin fronts
    0x35: "machine", // the kitchen's stove
    0x36: "shelf",
    0x37: "stairs",
    0x38: "stairs",
    0x39: "stairs",
    0x3a: "stairs",
    0x3b: "table",
    0x3c: "table",
    0x3d: "fence",
    0x3e: "fence",
    0x3f: "fence",
    0x40: "table", // a kitchen table, with a big round tray
    0x41: "table",
    0x42: "furniture", // the captain's chair
    0x43: "furniture",
    0x44: "table", // an open book on the captain's desk
    0x45: "table",
    0x46: "furniture", // beds
    0x47: "furniture",
    0x48: "furniture", // bins
    0x49: "furniture",
    0x4a: "floor", // the cabin doorways off the corridors (warps)
    0x4b: "unused",
    0x4c: "unused",
    0x4d: "unused",
    0x4e: "unused",
    0x4f: "unused",
    0x50: "table",
    0x51: "table",
    0x52: "unused",
    0x53: "unused",
    0x54: "furniture",
    0x55: "furniture",
    0x56: "furniture",
    0x57: "furniture",
    0x58: "furniture",
    0x59: "furniture",
    0x5a: "unused",
    0x5b: "unused",
    0x5c: "unused",
    0x5d: "unused",
    0x5e: "unused",
    0x5f: "unused",
  },
  blocks: {},
};
