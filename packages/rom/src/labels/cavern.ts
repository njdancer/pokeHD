import type { TilesetLabelTable } from "./types.ts";

/**
 * CAVERN (tileset 17): Mt Moon, Rock Tunnel, Diglett's Cave, Victory Road, Seafoam Islands and
 * Cerulean Cave. Two floor shades (light 0x05, dark 0x20) are two heights: the ROM's pair
 * collisions stop you stepping between them, so both are ground and the cliff faces mark the drop.
 * 0x14 animates as water.
 */
export const CAVERN: TilesetLabelTable = {
  tiles: {
    0x00: "unused", // no map draws 0x00, 0x23, 0x30 or 0x32–0x5f (most are past the graphics)
    0x01: "ground", // pale flagstones (Mt Moon B2F paths, Victory Road), with 0x06, 0x24 and 0x27
    0x02: "rock", // grey boulders, with 0x03, 0x12 and 0x13: solid, the walls of Victory Road and Cerulean Cave
    0x03: "rock",
    0x04: "cliff", // corners of the raised floor's rock face
    0x05: "ground", // light (raised) floor
    0x06: "ground",
    0x07: "cliff",
    0x08: "stairs", // ladder down, with 0x09, 0x18 and 0x19
    0x09: "stairs",
    0x0a: "stairs", // ladder up, with 0x0b, 0x1a and 0x1b
    0x0b: "stairs",
    0x0c: "rock", // pale rock piles, with 0x0d, 0x1c and 0x1d (Rock Tunnel, Seafoam, Victory Road)
    0x0d: "rock",
    0x0e: "sign", // the cave signboards (Mt Moon, Rock Tunnel, Seafoam B4F), with 0x0f, 0x1e and 0x1f
    0x0f: "sign",
    0x10: "cliff", // the rock face under raised floor
    0x11: "cliff",
    0x12: "rock",
    0x13: "rock",
    0x14: "water",
    0x15: "stairs", // stone steps cut into the rock face
    0x16: "stairs",
    0x17: "cliff", // the rock face on the right of raised floor
    0x18: "stairs",
    0x19: "stairs",
    0x1a: "stairs",
    0x1b: "stairs",
    0x1c: "rock",
    0x1d: "rock",
    0x1e: "sign",
    0x1f: "sign",
    0x20: "ground", // dark (low) floor
    0x21: "ground", // checked floor (Diglett's Cave, Victory Road)
    0x22: "stairs", // holes down (Seafoam, Victory Road 3F): a warp, like a ladder
    0x23: "unused",
    0x24: "ground",
    0x25: "cliff", // diagonal corners of the rock face
    0x26: "cliff",
    0x27: "ground",
    0x28: "cliff",
    0x29: "ground", // the raised floor's top edge, shadowed
    0x2a: "ground", // the darkest floor: the walkable but walled-off mass behind Victory Road's boulder walls
    0x2b: "ground", // Victory Road's boulder switch, with 0x2c, 0x2d and 0x2e: a floor plate
    0x2c: "ground",
    0x2d: "ground",
    0x2e: "ground",
    0x2f: "stairs", // the back lip of a hole
    0x30: "unused",
    0x31: "cliff", // the rock face on the left of raised floor
    0x32: "unused",
    0x33: "unused",
    0x34: "unused",
    0x35: "unused",
    0x36: "unused",
    0x37: "unused",
    0x38: "unused",
    0x39: "unused",
    0x3a: "unused",
    0x3b: "unused",
    0x3c: "void", // solid black (Mt Moon B1F's unreachable parts)
    0x3d: "unused",
    0x3e: "unused",
    0x3f: "unused",
    0x40: "unused",
    0x41: "unused",
    0x42: "unused",
    0x43: "unused",
    0x44: "unused",
    0x45: "unused",
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
  blocks: {},
};
