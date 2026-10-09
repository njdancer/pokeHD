// Quality tiers: patches laid over whatever look is loaded, so a phone keeps the look's colours,
// light and framing but skips the costliest work that's hard to see on a small, dense screen.
// Resolution isn't part of a tier: dynamic resolution (./governor.ts) lowers it only when frames
// run long. Measured on /dev/bench (see docs/PERF.md).

export type Quality = "full" | "mobile";

export const QUALITY_PATCHES: Record<Quality, object> = {
  full: {},
  mobile: {
    ao: { resolution: 0.25 },
    render: { antialias: "fxaa" },
  },
};

/** `?quality=full|mobile` wins; otherwise phones and tablets (a coarse pointer, no hover) get mobile. */
export function defaultQuality(): Quality {
  const asked = new URLSearchParams(location.search).get("quality");
  if (asked === "full" || asked === "mobile") return asked;
  return matchMedia("(pointer: coarse) and (hover: none)").matches ? "mobile" : "full";
}

/**
 * The render pixel ratio for a screen: the largest whole fraction of the device's ratio (3, 1.5,
 * 1, ...) within `max`, so each rendered pixel covers a whole number of screen pixels (2×2 on a
 * 3× iPhone, rather than 1.5×1.5 at a plain 2× cap). `step` is that whole number.
 */
export function alignedPixelRatio(deviceRatio: number, max: number): { ratio: number; step: number } {
  const step = Math.max(1, Math.ceil(deviceRatio / max - 1e-6));
  return { ratio: deviceRatio / step, step };
}
