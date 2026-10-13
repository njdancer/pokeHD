import type { TilesetLabelTable } from "./types.ts";

/**
 * PLATEAU (tileset 23): Route 23 and the Indigo Plateau outside the League. An outdoor tileset, so it
 * uses the overworld labels. Door 0x1b and tall grass 0x45 come from the ROM; 0x14 animates as water.
 */
export const PLATEAU: TilesetLabelTable = {
  tiles: {
    0x00: "unused",
    0x01: "unused",
    0x02: "unused",
    0x03: "cliff", // the terraced cliffs of Route 23 (and the League's roof)
    0x04: "unused",
    0x05: "fence", // the stone posts along the fences
    0x06: "fence",
    0x07: "tree",
    0x08: "tree",
    0x09: "sign",
    0x0a: "sign",
    0x0b: "door", // the League's doors (0x1b comes from the ROM)
    0x0c: "door",
    0x0d: "cliff", // cliff faces and their foot; the League's front wall reuses them (see blocks)
    0x0e: "cliff",
    0x0f: "cliff",
    0x10: "statue", // the ornaments on the posts
    0x11: "unused",
    0x12: "statue",
    0x13: "unused",
    0x14: "water",
    0x15: "fence",
    0x16: "fence",
    0x17: "tree",
    0x18: "tree",
    0x19: "sign",
    0x1a: "sign",
    0x1c: "door",
    0x1d: "rock",
    0x1e: "unused",
    0x1f: "shore",
    0x20: "cliff", // the white tops of the raised ground and pillars
    0x21: "cliff",
    0x22: "rock", // boulders
    0x23: "ground", // pale speckled ground
    0x24: "unused",
    0x25: "statue",
    0x26: "statue",
    0x27: "unused",
    0x28: "statue",
    0x29: "statue",
    0x2a: "rock",
    0x2b: "rock",
    0x2c: "ground", // the checked path to the League
    0x2d: "ground",
    0x2e: "cliff",
    0x2f: "cliff",
    0x30: "fence",
    0x31: "fence",
    0x32: "shore",
    0x33: "shore",
    0x34: "unused",
    0x35: "unused",
    0x36: "unused",
    0x37: "unused",
    0x38: "unused",
    0x39: "unused",
    0x3a: "unused",
    0x3c: "unused",
    0x3d: "roof", // the Route 22 gate's roof, seen from Route 23 (solid), and its top edge
    0x3e: "roof",
    0x3f: "unused",
    0x40: "cliff", // the paved square's side edges
    0x41: "cliff",
    0x42: "unused",
    0x43: "unused",
    0x44: "cliff",
    0x45: "tall-grass",
    0x46: "unused",
    0x47: "unused",
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
    // The League building's front wall, round its doors.
    0x1d: { 0: "wall", 1: "wall", 2: "wall", 3: "wall", 4: "wall", 5: "wall", 6: "wall", 7: "wall", 8: "wall", 9: "wall", 12: "wall", 13: "wall" },
    0x1e: { 0: "wall", 1: "wall", 2: "wall", 3: "wall", 4: "wall", 5: "wall", 6: "wall", 7: "wall", 10: "wall", 11: "wall", 14: "wall", 15: "wall" },
  },
};
