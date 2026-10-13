import { describe, expect, it } from "vitest";
import { LABEL_RAMPS } from "./palette.ts";

const luma = (rgb: number) => 0.2126 * ((rgb >> 16) & 255) + 0.7152 * ((rgb >> 8) & 255) + 0.0722 * (rgb & 255);

describe("label ramps", () => {
  // QA #32: the mountain tops' fill tile (0x11) is mostly shade 0, and a raised cliff's north rim
  // faces away from the camera, so the cliff's lightest shade is nearly all that shows. It used to
  // match the path's sand and a solid mountain read as open ground.
  it("keeps solid rock clearly darker than the ground you walk on", () => {
    for (const open of ["ground", "shore", "lawn"] as const) {
      expect(luma(LABEL_RAMPS[open][0]) - luma(LABEL_RAMPS.cliff[0]), open).toBeGreaterThan(40);
    }
  });
});
