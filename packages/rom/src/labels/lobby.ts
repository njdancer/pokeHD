import type { TilesetLabelTable } from "./types.ts";

/**
 * LOBBY (tileset 18): Celadon Department Store, its roof and elevator, the Game Corner and prize room,
 * the Celadon diner, and the Rocket Hideout and Silph Co. elevators. Doors 0x1a and 0x38 come from
 * the ROM; counter 0x15 and 0x36 are the ROM's own list.
 */
export const LOBBY: TilesetLabelTable = {
  tiles: {
    0x00: "unused",
    0x01: "wall-interior", // the store's patterned back wall and its bottom edge
    0x02: "machine", // the pair of terminals on 1F
    0x03: "machine",
    0x04: "floor", // doormat (the exit)
    0x05: "unused",
    0x06: "machine", // the elevator call panel
    0x07: "furniture", // stools and chairs
    0x08: "furniture",
    0x09: "table", // the eight-sided tables (roof, diner)
    0x0a: "door", // dark doorways (the roof's exit; 0x1a comes from the ROM)
    0x0b: "door",
    0x0c: "stairs", // 0x1c is a warp, a "door" to the ROM
    0x0d: "stairs",
    0x0e: "machine", // TVs and consoles for sale (3F)
    0x0f: "machine",
    0x10: "void", // the black above the Game Corner
    0x11: "unused",
    0x12: "machine",
    0x13: "machine",
    0x14: "floor",
    0x15: "counter", // the store and diner counters
    0x16: "machine",
    0x17: "furniture",
    0x18: "furniture",
    0x19: "table",
    0x1b: "door",
    0x1c: "stairs",
    0x1d: "stairs",
    0x1e: "machine",
    0x1f: "machine",
    0x20: "floor", // checked floor
    0x21: "wall-interior",
    0x22: "machine", // vending machines (roof) and slot machines (Game Corner, prize room)
    0x23: "machine",
    0x24: "machine", // the console and doll on 3F's counter
    0x25: "machine",
    0x26: "counter",
    0x27: "counter",
    0x28: "door", // elevator doors (0x38 comes from the ROM)
    0x29: "counter",
    0x2a: "shelf", // store shelving
    0x2b: "shelf",
    0x2c: "shelf",
    0x2d: "shelf",
    0x2e: "picture", // the floor directory signs
    0x2f: "picture",
    0x30: "counter",
    0x31: "counter",
    0x32: "machine",
    0x33: "machine",
    0x34: "machine",
    0x35: "machine",
    0x36: "counter", // the counters' upright runs; the Game Corner's machine banks reuse them (see blocks)
    0x37: "floor", // big checks (roof, diner, elevators); plain 0x37 is also the tables' top and the prize room's back wall (see blocks)
    0x39: "counter",
    0x3a: "shelf",
    0x3b: "shelf",
    0x3c: "shelf",
    0x3d: "shelf",
    0x3e: "machine", // the button panel in the elevators
    0x3f: "machine",
    0x40: "shelf",
    0x41: "shelf",
    0x42: "shelf",
    0x43: "shelf",
    0x44: "fence", // the roof's railings
    0x45: "floor",
    0x46: "table",
    0x47: "table",
    0x48: "picture", // framed pictures
    0x49: "picture",
    0x4a: "unused",
    0x4b: "wall-interior", // the elevator car's walls (Rocket Hideout), and the roof's stairwell
    0x4c: "wall-interior",
    0x4d: "machine", // the foot of the Game Corner's machine banks
    0x4e: "machine",
    0x4f: "wall-interior",
    0x50: "shelf",
    0x51: "shelf",
    0x52: "shelf",
    0x53: "shelf",
    0x54: "fence",
    0x55: "table",
    0x56: "table",
    0x57: "table",
    0x58: "picture",
    0x59: "picture",
    0x5a: "unused",
    0x5b: "wall-interior", // the prize room wall's checked foot
    0x5c: "wall-interior",
    0x5d: "wall-interior",
    0x5e: "unused",
    0x5f: "unused",
  },
  blocks: {
    // Table tops reuse the floor and counter tiles.
    0x1d: { 1: "table", 2: "table", 4: "table", 5: "table", 6: "table", 7: "table", 9: "table", 10: "table" },
    0x2d: { 9: "table", 10: "table", 12: "table", 13: "table", 14: "table", 15: "table" },
    0x31: { 1: "table", 2: "table" },
    // The prize room's back wall is plain 0x37.
    0x3f: { 0: "wall-interior", 1: "wall-interior", 2: "wall-interior", 3: "wall-interior", 4: "wall-interior", 5: "wall-interior", 6: "wall-interior", 7: "wall-interior", 8: "wall-interior", 9: "wall-interior", 10: "wall-interior", 11: "wall-interior" },
    0x40: { 0: "wall-interior", 1: "wall-interior", 2: "wall-interior", 3: "wall-interior", 4: "wall-interior", 5: "wall-interior", 6: "wall-interior", 7: "wall-interior", 8: "wall-interior", 9: "wall-interior", 10: "wall-interior", 11: "wall-interior" },
    // The Game Corner's slot machine banks.
    0x38: { 0: "machine", 1: "machine", 2: "machine", 3: "machine", 4: "machine", 5: "machine", 6: "machine", 7: "machine", 8: "machine", 9: "machine", 10: "machine", 11: "machine" },
    0x39: { 0: "machine", 1: "machine", 2: "machine", 3: "machine", 4: "machine", 5: "machine", 6: "machine", 7: "machine", 8: "machine", 9: "machine", 10: "machine", 11: "machine", 12: "machine", 13: "machine", 14: "machine", 15: "machine" },
    0x3a: { 8: "machine", 9: "machine", 10: "machine", 11: "machine", 12: "machine", 13: "machine", 14: "machine", 15: "machine" },
  },
};
