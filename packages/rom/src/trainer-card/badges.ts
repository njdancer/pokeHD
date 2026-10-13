import { decode2bpp } from "../world/parse.ts";
import { romOffset, SYMBOLS } from "../symbols.ts";

// The eight badges as the trainer card draws them (engine/menus/draw_badges.asm): 16×16 pictures
// from GymLeaderFaceAndBadgeTileGraphics, each leader's face (4 tiles) followed by their badge
// (4 tiles), placed top-left, top-right, bottom-left, bottom-right. On a Super Game Boy the card
// colours each badge with an ATTR_BLK packet (BlkPacket_TrainerCard) over the four palettes of
// PalPacket_TrainerCard; the Rainbow Badge gets a different palette per tile.

export const NUM_BADGES = 8;
export const BADGE_NAMES = ["Boulder", "Cascade", "Thunder", "Rainbow", "Soul", "Marsh", "Volcano", "Earth"] as const;

export interface BadgePicture {
  /** 0 = Boulder Badge … 7 = Earth Badge, the bit order of wObtainedBadges. */
  index: number;
  name: (typeof BADGE_NAMES)[number];
  /** 16×16 colour numbers (0 lightest … 3 darkest), row-major. */
  pixels: Uint8Array;
  /** The leader's face that the card shows until the badge is won, same layout. */
  face: Uint8Array;
  /** The SGB palette (PAL_* ID) of each 8×8 quarter: top-left, top-right, bottom-left, bottom-right. */
  palettes: readonly [number, number, number, number];
}

const TILE_BYTES = 16;

/** Four decoded 8×8 tiles (TL, TR, BL, BR) as one 16×16 picture. */
function quad(tiles: Uint8Array): Uint8Array {
  const out = new Uint8Array(256);
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const t = (y >> 3) * 2 + (x >> 3);
      out[y * 16 + x] = tiles[t * 64 + (y & 7) * 8 + (x & 7)]!;
    }
  }
  return out;
}

/** Where DrawBadges puts badge `i`'s top-left tile on the 20×18 screen. */
const badgeCell = (i: number) => ({ x: 3 + 4 * (i % 4), y: 12 + 3 * Math.floor(i / 4) });

/** Each screen tile's palette slot (0–3) after the ATTR_BLK packet at `at`; the rest stay slot 0. */
function attrBlk(rom: Uint8Array, at: number): (x: number, y: number) => number {
  const count = rom[at + 1]!;
  const blocks = Array.from({ length: count }, (_, i) => {
    const b = at + 2 + i * 6;
    return { control: rom[b]!, pals: rom[b + 1]!, x1: rom[b + 2]!, y1: rom[b + 3]!, x2: rom[b + 4]!, y2: rom[b + 5]! };
  });
  return (x, y) => {
    let slot = 0;
    for (const k of blocks) {
      if (x < k.x1 || x > k.x2 || y < k.y1 || y > k.y2) continue;
      const border = x === k.x1 || x === k.x2 || y === k.y1 || y === k.y2;
      if (border && k.control & 2) slot = (k.pals >> 2) & 3;
      else if (!border && k.control & 1) slot = k.pals & 3;
    }
    return slot;
  };
}

export function readBadges(rom: Uint8Array): BadgePicture[] {
  const gfx = romOffset(SYMBOLS.GymLeaderFaceAndBadgeTileGraphics);
  const tiles = decode2bpp(rom.subarray(gfx, gfx + NUM_BADGES * 8 * TILE_BYTES));
  // PAL_SET: a header byte, then four little-endian palette IDs.
  const pal = romOffset(SYMBOLS.PalPacket_TrainerCard);
  const slots = [0, 1, 2, 3].map((s) => rom[pal + 1 + s * 2]! | (rom[pal + 2 + s * 2]! << 8));
  const slotAt = attrBlk(rom, romOffset(SYMBOLS.BlkPacket_TrainerCard));
  return BADGE_NAMES.map((name, index) => {
    const base = index * 8 * 64;
    const { x, y } = badgeCell(index);
    const palettes = [slotAt(x, y), slotAt(x + 1, y), slotAt(x, y + 1), slotAt(x + 1, y + 1)].map((s) => slots[s]!);
    return {
      index,
      name,
      face: quad(tiles.subarray(base, base + 4 * 64)),
      pixels: quad(tiles.subarray(base + 4 * 64, base + 8 * 64)),
      palettes: palettes as unknown as BadgePicture["palettes"],
    };
  });
}
