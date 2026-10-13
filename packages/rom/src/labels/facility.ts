import type { TilesetLabelTable } from "./types.ts";

/**
 * FACILITY (tileset 22): the Power Plant, Pokémon Mansion, Cinnabar and Saffron gyms, Silph Co. 1F–10F
 * and the Rocket Hideout. Doors 0x1b, 0x43 and 0x58 come from the ROM; counter 0x12 is the ROM's own
 * list. The ROM animates 0x14 as water; the only map drawing it is Silph Co.'s lobby, where it's solid.
 */
export const FACILITY: TilesetLabelTable = {
  tiles: {
    0x00: "unused",
    0x01: "floor", // checked floor
    0x02: "counter", // the Silph Co. reception counter
    0x03: "stairs", // up (0x13 is the warp)
    0x04: "stairs",
    0x05: "plant", // potted palms
    0x06: "plant",
    0x07: "plant",
    0x08: "unused",
    0x09: "furniture", // small crates and seats (the seats round Silph Co.'s lobby rug)
    0x0a: "furniture",
    0x0b: "stairs", // down (0x1b is the warp)
    0x0c: "stairs",
    0x0d: "table", // big tables; the machines and counters reuse their tops (see blocks)
    0x0e: "table",
    0x0f: "plant",
    0x10: "unused",
    0x11: "void", // the dark beyond the Pokémon Mansion's broken outer wall
    0x12: "counter",
    0x13: "stairs",
    0x14: "water", // the pool in Silph Co.'s lobby, ringed by seats: solid, and animated as water
    0x15: "plant",
    0x16: "plant",
    0x17: "plant",
    0x18: "unused",
    0x19: "furniture",
    0x1a: "furniture",
    0x1b: "stairs",
    0x1c: "stairs",
    0x1d: "table",
    0x1e: "table",
    0x1f: "plant",
    0x20: "floor", // spinner arrows (Rocket Hideout), and Saffron Gym's teleport pads
    0x21: "floor",
    0x22: "unused",
    0x23: "unused",
    0x24: "unused",
    0x25: "unused",
    0x26: "rock", // rubble
    0x27: "statue", // the statues on plinths (Pokémon Mansion, Cinnabar and Saffron gyms)
    0x28: "furniture", // beds
    0x29: "furniture",
    0x2a: "wall-interior", // the black partitions and their top edges
    0x2b: "wall-interior",
    0x2c: "wall-interior",
    0x2d: "wall-interior",
    0x2e: "wall-interior",
    0x2f: "statue",
    0x30: "floor",
    0x31: "floor",
    0x32: "unused",
    0x33: "void",
    0x34: "stairs",
    0x35: "table",
    0x36: "rock",
    0x37: "statue",
    0x38: "furniture",
    0x39: "furniture",
    0x3a: "wall-interior", // striped back walls
    0x3b: "wall-interior",
    0x3c: "wall-interior",
    0x3d: "statue",
    0x3e: "statue",
    0x3f: "statue",
    0x40: "fence", // the railing along that broken edge
    0x41: "fence",
    0x42: "floor", // the long carpet and its edge (Pokémon Mansion 1F)
    0x43: "stairs",
    0x44: "table",
    0x45: "table",
    0x46: "unused",
    0x47: "unused",
    0x48: "unused",
    0x49: "unused",
    0x4a: "machine", // generators and lab machines
    0x4b: "machine",
    0x4c: "machine",
    0x4d: "machine",
    0x4e: "stairs",
    0x4f: "unused",
    0x50: "fence",
    0x51: "fence",
    0x52: "floor",
    0x53: "rock",
    0x54: "rock",
    0x55: "unused",
    0x56: "door", // elevator doors (0x58 comes from the ROM)
    0x57: "wall-interior",
    0x59: "wall-interior",
    0x5a: "stairs", // Silph Co.'s stairs (0x43 is a warp, a "door" to the ROM)
    0x5b: "stairs",
    0x5c: "unused",
    0x5d: "unused",
    0x5e: "floor", // the square floor pad
    0x5f: "unused",
  },
  blocks: {
    // Machine tops reuse the table's.
    0x60: { 6: "machine", 7: "machine", 10: "machine", 11: "machine", 14: "machine", 15: "machine" },
    0x61: { 4: "machine", 5: "machine", 6: "machine", 7: "machine" },
    0x62: { 4: "machine", 5: "machine", 8: "machine", 9: "machine", 12: "machine", 13: "machine" },
    0x64: { 2: "machine", 3: "machine", 6: "machine", 7: "machine" },
    0x66: { 0: "machine", 1: "machine", 4: "machine", 5: "machine" },
    0x6b: { 6: "machine", 7: "machine" },
    // The reception counter's side run reuses the table's.
    0x23: { 0: "counter", 1: "counter", 4: "counter", 5: "counter", 8: "counter", 9: "counter" },
    0x7f: { 4: "counter", 5: "counter", 8: "counter", 9: "counter", 12: "counter", 13: "counter" },
  },
};
