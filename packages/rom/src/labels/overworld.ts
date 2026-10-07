import type { TilesetLabelTable } from "./types.ts";

/**
 * OVERWORLD (tileset 0): Pallet Town, Route 1, Viridian City and every other town and route.
 * Doors, tall grass and ledges come from the ROM (see seedLabels); everything else is here.
 */
export const OVERWORLD: TilesetLabelTable = {
  tiles: {
    0x00: "ground",
    0x01: "cliff",
    0x02: "cliff",
    0x03: "flower", // animated by TILEANIM_WATER_FLOWER
    0x04: "bridge", // Vermilion pier planks
    0x05: "roof",
    0x06: "roof",
    0x07: "roof",
    0x08: "roof",
    0x09: "roof",
    0x0a: "window",
    0x0b: "wall", // door frame
    0x0c: "wall", // door frame
    0x0e: "fence", // bollard top
    0x0f: "wall",
    0x10: "fence",
    0x11: "cliff",
    0x12: "roof",
    0x13: "cliff",
    0x14: "water", // animated by TILEANIM_WATER; the engine's surfable water tile
    0x15: "roof",
    0x16: "roof",
    0x17: "roof",
    0x18: "roof",
    0x19: "roof",
    0x1a: "wall",
    0x1c: "wall", // door frame
    0x1e: "cliff",
    0x1f: "wall",
    0x20: "fence",
    0x21: "fence", // fence post
    0x22: "wall",
    0x23: "ground",
    0x24: "cliff",
    0x25: "roof",
    0x26: "roof",
    0x28: "roof",
    0x29: "roof",
    0x2a: "tree",
    0x2b: "tree",
    0x2c: "lawn",
    0x2d: "tree",
    0x2e: "tree",
    0x2f: "lettering",
    0x30: "lawn",
    0x31: "shore", // pier posts along the water
    0x32: "shore",
    0x33: "shore",
    0x34: "cliff",
    0x35: "cliff",
    0x38: "roof",
    0x39: "ground",
    0x3a: "tree",
    0x3b: "tree",
    0x3c: "bridge",
    0x3d: "tree",
    0x3e: "tree",
    0x3f: "lettering",
    0x40: "tree",
    0x41: "tree",
    0x42: "lettering",
    0x43: "lettering",
    0x44: "lettering",
    0x45: "lettering",
    0x46: "sign",
    0x47: "sign",
    0x48: "cave",
    0x49: "cave",
    0x4a: "wall",
    0x4b: "window",
    0x4c: "roof",
    0x4d: "roof",
    0x4e: "wall",
    0x4f: "wall",
    0x50: "tree",
    0x51: "tree",
    0x53: "roof",
    0x54: "shore",
    0x55: "fence", // bollard base
    0x56: "sign",
    0x57: "sign",
    0x58: "cave", // also a door in the ROM: the warp into caves
    0x59: "cave",
    0x5a: "roof",
    0x5b: "ground",
    0x5c: "wall",
    0x5d: "wall",
    0x5e: "unused",
    0x5f: "unused",
  },
  blocks: {
    // Mountain bases reuse the down-ledge tile but can't be hopped.
    0x06: { 10: "cliff", 11: "cliff", 14: "cliff", 15: "cliff" },
    0x2a: { 8: "cliff" },
    0x2b: { 11: "cliff" },
    // Short steps cut into ledges reuse the bridge tile.
    0x2f: { 14: "stairs", 15: "stairs" },
    0x4a: { 14: "stairs", 15: "stairs" },
    0x5c: { 12: "stairs", 13: "stairs" },
  },
};
