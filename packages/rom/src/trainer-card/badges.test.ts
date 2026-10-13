import { existsSync, readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { readBadges, type BadgePicture } from "./badges.ts";

const ROM_PATH = new URL("../../../../rom/pokeblue.gb", import.meta.url);

// PAL_MEWMON, PAL_BADGE, PAL_REDMON, PAL_YELLOWMON (PalPacket_TrainerCard).
const MEWMON = 0x10, BADGE = 0x22, REDMON = 0x12, YELLOWMON = 0x18;

describe.skipIf(!existsSync(ROM_PATH))("readBadges", () => {
  let badges: BadgePicture[];
  beforeAll(() => {
    badges = readBadges(new Uint8Array(readFileSync(ROM_PATH)));
  });

  it("reads eight 16×16 badges and leader faces", () => {
    expect(badges.map((b) => b.name)).toEqual(["Boulder", "Cascade", "Thunder", "Rainbow", "Soul", "Marsh", "Volcano", "Earth"]);
    for (const b of badges) {
      expect(b.pixels).toHaveLength(256);
      expect(b.face).toHaveLength(256);
      // Every badge has an outline (colour 3) and see-through corners (colour 0).
      expect(b.pixels.includes(3)).toBe(true);
      expect(b.pixels[0]).toBe(0);
      expect(b.pixels).not.toEqual(b.face);
    }
  });

  it("decodes the first tile row of the Boulder Badge's face", () => {
    // GymLeaderFaceAndBadgeTileGraphics starts $1f $3f: bits 00011111 / 00111111.
    expect(Array.from(badges[0]!.face.subarray(0, 8))).toEqual([0, 0, 2, 3, 3, 3, 3, 3]);
  });

  it("colours each badge the way the trainer card's SGB packets do", () => {
    expect(badges[0]!.palettes).toEqual([MEWMON, MEWMON, MEWMON, MEWMON]);
    expect(badges[1]!.palettes).toEqual([BADGE, BADGE, BADGE, BADGE]);
    expect(badges[2]!.palettes).toEqual([YELLOWMON, YELLOWMON, YELLOWMON, YELLOWMON]);
    // The Rainbow Badge: one palette per quarter.
    expect(badges[3]!.palettes).toEqual([MEWMON, REDMON, BADGE, YELLOWMON]);
    expect(badges[4]!.palettes).toEqual([REDMON, REDMON, REDMON, REDMON]);
    expect(badges[7]!.palettes).toEqual([BADGE, BADGE, BADGE, BADGE]);
  });
});
