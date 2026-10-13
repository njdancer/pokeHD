import { describe, expect, it } from "vitest";
import { cutOut } from "./cutout.ts";
import type { Image } from "./palette.ts";
import type { Region } from "./region.ts";

/** Cuts out one step drawn as 16 rows of shades (' ' . + # = 0–3); returns the kept pixels. */
function cutStep(rows: string[]): string[] {
  const shades = new Uint8Array(256);
  rows.forEach((row, y) => [...row].forEach((c, x) => (shades[y * 16 + x] = " .+#".indexOf(c))));
  const region = { widthTiles: 2, heightTiles: 2, shades } as unknown as Region;
  const image: Image = { width: 16, height: 16, data: new Uint8Array(256 * 4).fill(255) };
  const out = cutOut(image, region, [{ sx: 0, sy: 0, label: "tree" }]);
  return Array.from({ length: 16 }, (_, y) => Array.from({ length: 16 }, (_, x) => (out.data[(y * 16 + x) * 4 + 3] ? "o" : "_")).join(""));
}

const NONE = "_".repeat(16);

describe("cutOut", () => {
  it("clears a dithered floor around a prop but keeps the dither inside its outline", () => {
    // FOREST's small trees stand on shade-1 dots in a checkerboard with shade 0, whose shade-0
    // pixels only touch diagonally.
    const dither = (y: number) => (y % 2 ? " ." : ". ").repeat(8);
    const rows = Array.from({ length: 16 }, (_, y) => dither(y));
    for (let y = 4; y < 12; y++) {
      rows[y] = y === 4 || y === 11 ? `${dither(y).slice(0, 4)}########${dither(y).slice(12)}` : `${dither(y).slice(0, 4)}#${dither(y).slice(5, 11)}#${dither(y).slice(12)}`;
    }
    const out = cutStep(rows);
    // Dots touching the outline stay (they could be part of it); the rest of the floor goes.
    for (const y of [0, 1, 2, 13, 14, 15]) expect(out[y]).toBe(NONE);
    for (let y = 3; y < 13; y++) expect(out[y]!.slice(0, 3) + out[y]!.slice(13)).toBe("______");
    for (let y = 4; y < 12; y++) expect(out[y]!.slice(4, 12)).toBe("oooooooo");
  });

  it("doesn't flood through a light pixel on the outline into the canopy", () => {
    const rows = Array.from({ length: 16 }, () => " ".repeat(16));
    // A gap at the top-right corner, plugged by a shade-1 pixel that touches the outline.
    rows[4] = "    ######.     ";
    for (let y = 5; y < 10; y++) rows[y] = "    #      #    ";
    rows[10] = "    ########    ";
    const out = cutStep(rows);
    expect(out[4]).toBe("____ooooooo_____");
    for (let y = 5; y <= 10; y++) expect(out[y]).toBe("____oooooooo____");
  });
});
