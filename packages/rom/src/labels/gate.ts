import type { TilesetLabelTable } from "./types.ts";

/**
 * GATE, MUSEUM and FOREST_GATE (tilesets 12, 10 and 9, one set of graphics and blocks): the route
 * gates, Viridian Forest gates, Underground Path entrances, Safari Zone gate and rest houses, and
 * Museum 1F/2F. Door 0x3b comes from the ROM; counters 0x17 and 0x32 are the ROM's own list.
 */
export const GATE: TilesetLabelTable = {
  tiles: {
    0x00: "wall-interior", // striped back wall
    0x01: "floor",
    0x02: "furniture", // chair (Museum, Route 11/12 gate 2F)
    0x03: "furniture",
    0x04: "floor", // doormat (the exit)
    0x05: "plant",
    0x06: "plant",
    0x07: "counter", // counter top; also tops the bookshelves (see blocks)
    0x08: "counter",
    0x09: "counter",
    0x0a: "stairs",
    0x0b: "stairs",
    0x0c: "stairs",
    0x0d: "stairs",
    0x0e: "statue", // the badge-check statues (Route 22 gate)
    0x0f: "statue",
    0x10: "void", // black above the counters in Route 16 gate 1F
    0x11: "floor",
    0x12: "furniture",
    0x13: "furniture",
    0x14: "floor", // doormat; walkable
    0x15: "plant",
    0x16: "plant",
    0x17: "counter", // the long counters guards talk across
    0x18: "counter",
    0x19: "shelf", // display case edge (Museum)
    0x1a: "stairs",
    0x1b: "stairs",
    0x1c: "stairs",
    0x1d: "stairs",
    0x1e: "statue",
    0x1f: "statue",
    0x20: "counter", // the desks lining the gates; they share 0x32/0x33 with the counters
    0x21: "counter",
    0x22: "shelf", // a bookshelf to the ROM
    0x23: "shelf",
    0x24: "machine", // binoculars (Route 11/12 gate 2F)
    0x25: "plant",
    0x26: "plant",
    0x27: "shelf", // display cases (Museum): 0x27, 0x28, 0x2c, 0x30, 0x31, 0x3c
    0x28: "shelf",
    0x29: "door", // the frame round 0x3b (Route 22 gate, Viridian Forest gates)
    0x2a: "door",
    0x2b: "door",
    0x2c: "shelf",
    0x2d: "window", // the big windows upstairs in the gates
    0x2e: "shelf", // amber in a display case
    0x2f: "unused", // no block a map uses draws 0x2f, 0x49, 0x4b or 0x5f
    0x30: "shelf",
    0x31: "shelf",
    0x32: "counter", // counter front; reused under statues and display cases (see blocks)
    0x33: "counter",
    0x34: "machine",
    0x35: "plant",
    0x36: "plant",
    0x37: "floor", // carpet runner edge; walkable
    0x38: "floor", // carpet runner
    0x39: "machine",
    0x3a: "window", // also the glass of the Museum's display cases (see blocks)
    0x3c: "shelf", // display case front; walkable to the ROM, but always above a 0x32/0x33 base
    0x3d: "window",
    0x3e: "window", // mullion between the windows
    0x3f: "shelf", // exhibit placard on a display case
    0x40: "statue", // the space shuttle (Museum 2F): 0x40–0x45, 0x50–0x52, 0x54–0x59
    0x41: "statue",
    0x42: "statue",
    0x43: "statue",
    0x44: "statue",
    0x45: "statue",
    0x46: "shelf", // fossils in a display case
    0x47: "shelf",
    0x48: "wall-interior", // upper back wall (Museum, Route 2 and forest gates)
    0x49: "unused",
    0x4a: "wall-interior", // skirting along the back wall
    0x4b: "unused",
    0x4c: "furniture", // round pedestal by the Old Amber (Museum 1F)
    0x4d: "furniture",
    0x4e: "picture",
    0x4f: "picture",
    0x50: "statue",
    0x51: "statue",
    0x52: "statue",
    0x53: "shelf",
    0x54: "statue",
    0x55: "statue",
    0x56: "statue",
    0x57: "statue",
    0x58: "statue",
    0x59: "statue",
    0x5a: "shelf", // the Moon Stone's case (Museum 2F)
    0x5b: "shelf",
    0x5c: "furniture",
    0x5d: "furniture",
    0x5e: "floor", // carpet runner edge; walkable
    0x5f: "unused",
  },
  blocks: {
    // Bookshelf tops reuse the counter's top edge.
    0x16: { 2: "shelf", 3: "shelf" },
    0x17: { 0: "shelf", 1: "shelf" },
    0x4d: { 0: "shelf", 1: "shelf", 2: "shelf", 3: "shelf" },
    // The Route 22 gate statues stand on the counter front.
    0x2c: { 14: "statue", 15: "statue" },
    0x2d: { 12: "statue", 13: "statue" },
    0x2e: { 14: "statue", 15: "statue" },
    0x2f: { 12: "statue", 13: "statue" },
    // The space shuttle's stand.
    0x3f: { 4: "statue", 5: "statue", 6: "statue", 7: "statue" },
    // Museum display cases: glass reuses the window tile, bases reuse the counter front.
    0x40: { 14: "shelf", 15: "shelf" },
    0x41: { 5: "shelf", 6: "shelf", 12: "shelf", 13: "shelf", 14: "shelf", 15: "shelf" },
    0x45: { 13: "shelf", 14: "shelf" },
    0x48: { 6: "shelf", 7: "shelf" },
    0x49: { 4: "shelf", 5: "shelf", 6: "shelf", 7: "shelf" },
    0x4b: { 4: "shelf", 5: "shelf" },
    0x53: { 12: "shelf", 13: "shelf" },
    0x58: { 14: "shelf", 15: "shelf" },
    0x59: { 5: "shelf", 6: "shelf", 12: "shelf", 13: "shelf", 14: "shelf", 15: "shelf" },
    0x5a: { 12: "shelf", 13: "shelf" },
    0x5b: { 4: "shelf", 5: "shelf" },
  },
};
