import { describe, expect, it } from "vitest";
import { alignedPixelRatio, isTouchDevice, QUALITY_PATCHES } from "./quality.ts";

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

describe("isTouchDevice", () => {
  const env = (coarse: boolean, maxTouchPoints: number, userAgent: string) => ({
    matchMedia: () => ({ matches: coarse }),
    navigator: { maxTouchPoints, userAgent },
  });
  const MAC = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Safari/605.1.15";

  it("takes a phone or a plain iPad by its pointer", () => {
    expect(isTouchDevice(env(true, 5, MAC))).toBe(true);
  });

  it("takes an iPad with a trackpad, which hovers and says it's a Mac", () => {
    expect(isTouchDevice(env(false, 5, MAC))).toBe(true);
  });

  it("leaves a Mac alone", () => {
    expect(isTouchDevice(env(false, 0, MAC))).toBe(false);
  });
});

describe("the mobile tier's pixel cap", () => {
  const max = (QUALITY_PATCHES.mobile as { render: { maxPixelRatio: number } }).render.maxPixelRatio;

  it("keeps a 3× iPhone at 1.5", () => {
    expect(alignedPixelRatio(3, max)).toEqual({ ratio: 1.5, step: 2 });
  });

  it("renders a 2× iPad at 1×, each pixel 2×2 on screen", () => {
    expect(alignedPixelRatio(2, max)).toEqual({ ratio: 1, step: 2 });
  });
});
