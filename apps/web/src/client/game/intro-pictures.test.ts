import { describe, expect, it } from "vitest";
import { liftPictures, STAGE_HEIGHT } from "./intro-pictures.ts";

describe("liftPictures", () => {
  it("clears the background reaching the edges, keeping white inside an outline", () => {
    const pixels = new Uint8ClampedArray(160 * STAGE_HEIGHT * 4).fill(255);
    const set = (x: number, y: number, v: number) => pixels.set([v, v, v, 255], (y * 160 + x) * 4);
    // A black ring around (50, 50) with white inside.
    for (let x = 45; x <= 55; x++) for (let y = 45; y <= 55; y++) if (x === 45 || x === 55 || y === 45 || y === 55) set(x, y, 0);
    const out = { data: new Uint8ClampedArray(160 * STAGE_HEIGHT * 4) };
    liftPictures(pixels, out);
    const alpha = (x: number, y: number) => out.data[(y * 160 + x) * 4 + 3];
    expect(alpha(0, 0)).toBe(0);
    expect(alpha(45, 50)).toBe(255);
    expect(alpha(50, 50)).toBe(255);
  });
});
