import { describe, expect, it } from "vitest";
import { alignedPixelRatio } from "./quality.ts";

describe("alignedPixelRatio", () => {
  it("gives a 3× phone 1.5, so each rendered pixel is 2×2 screen pixels", () => {
    expect(alignedPixelRatio(3, 2)).toEqual({ ratio: 1.5, step: 2 });
  });

  it("leaves screens at or under the cap at their own ratio", () => {
    expect(alignedPixelRatio(2, 2)).toEqual({ ratio: 2, step: 1 });
    expect(alignedPixelRatio(1, 2)).toEqual({ ratio: 1, step: 1 });
    expect(alignedPixelRatio(1.25, 2)).toEqual({ ratio: 1.25, step: 1 });
  });

  it("divides odd ratios by whole numbers too", () => {
    expect(alignedPixelRatio(2.625, 2)).toEqual({ ratio: 1.3125, step: 2 });
    expect(alignedPixelRatio(3, 1)).toEqual({ ratio: 1, step: 3 });
    expect(alignedPixelRatio(2, 0.75)).toEqual({ ratio: 2 / 3, step: 3 });
  });
});
