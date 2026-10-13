import type { TilesetLabelTable } from "./types.ts";

/**
 * FOREST (tileset 3): Viridian Forest and the Safari Zone. Tall grass (0x20) and the rest-house
 * door (0x3a) come from the ROM. The Safari Zone's raised ground (0x2e) can't be walked onto
 * from the low ground (a pair collision in the ROM), so its edges are cliffs.
 */
export const FOREST: TilesetLabelTable = {
  tiles: {
    0x00: "tree", // beside a big tree's trunk: solid, part of the tree's footprint
    0x01: "window",
    0x02: "tree", // the forest's small trees
    0x03: "tree",
    0x04: "tree", // big trees
    0x05: "tree",
    0x06: "tree",
    0x07: "tree",
    0x08: "roof",
    0x09: "roof",
    0x0a: "statue", // the Safari Zone's Pokémon statues
    0x0b: "statue",
    0x0c: "roof",
    0x0e: "cliff",
    0x0f: "cliff",
    0x12: "tree",
    0x13: "tree",
    0x14: "water", // animated by TILEANIM_WATER
    0x15: "tree",
    0x16: "tree",
    0x17: "tree",
    0x18: "roof",
    0x19: "roof",
    0x1a: "statue",
    0x1b: "statue",
    0x1c: "roof",
    0x1d: "cliff",
    // The raised ground's top edge: between low and raised ground, which the ROM's pair collisions
    // keep apart, so it marks the step like the cliff sides do. Only ever the top half of a step.
    0x1e: "cliff",
    0x1f: "cliff",
    0x21: "sign",
    0x22: "sign",
    0x23: "tree",
    0x24: "tree",
    0x25: "tree",
    0x26: "tree",
    0x27: "tree",
    0x28: "wall",
    0x29: "wall",
    0x2a: "wall", // door frame
    0x2b: "wall", // door frame
    0x2c: "wall",
    0x2d: "cliff",
    0x2e: "ground", // raised ground
    0x2f: "cliff",
    0x30: "ground",
    0x31: "sign",
    0x32: "sign",
    0x34: "lawn", // short grass among the tall grass; no encounters
    0x35: "tree",
    0x36: "tree",
    0x37: "ground", // a tuft on the path
    0x38: "wall",
    0x39: "ground",
    0x3b: "wall", // door frame
    0x3c: "wall",
    0x3d: "cliff",
    0x3e: "cliff",
    0x3f: "cliff",
    0x40: "stairs",
    0x41: "stairs",
    0x42: "fence", // the statues' plinth rail
    0x43: "fence",
    0x48: "shore",
    0x49: "shore",
    0x4a: "shore",
    0x4b: "statue", // plinth
    0x4c: "statue",
    0x4d: "shore",
    0x4e: "shore",
    0x50: "ground", // arrows painted on the path
    0x51: "ground",
    0x52: "ground",
    0x53: "ground",
    0x54: "rock", // the Safari Zone's boulders
    0x55: "rock",
    0x56: "rock",
    0x57: "rock",
    0x5e: "lawn", // patterned grass in the Safari Zone, walkable
    0x5f: "ground",
    // No Forest or Safari Zone block draws these.
    0x0d: "unused",
    0x10: "unused",
    0x11: "unused",
    0x33: "unused",
    0x44: "unused",
    0x45: "unused",
    0x46: "unused",
    0x47: "unused",
    0x4f: "unused",
    0x58: "unused",
    0x59: "unused",
    0x5a: "unused",
    0x5b: "unused",
    0x5c: "unused",
    0x5d: "unused",
  },
  blocks: {},
};
