// Quality tiers: patches laid over whatever look is loaded, so a phone keeps the look's colours,
// light and framing but skips the costliest work. Measured on /dev/bench (see docs/PERF.md).

export type Quality = "full" | "mobile";

export const QUALITY_PATCHES: Record<Quality, object> = {
  full: {},
  mobile: {
    ao: { resolution: 0.25 },
    render: { antialias: "fxaa", maxPixelRatio: 1.5 },
  },
};

/** `?quality=full|mobile` wins; otherwise phones and tablets (a coarse pointer, no hover) get mobile. */
export function defaultQuality(): Quality {
  const asked = new URLSearchParams(location.search).get("quality");
  if (asked === "full" || asked === "mobile") return asked;
  return matchMedia("(pointer: coarse) and (hover: none)").matches ? "mobile" : "full";
}
