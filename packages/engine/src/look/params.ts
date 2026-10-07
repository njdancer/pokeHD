// Every tunable of the look, as plain JSON-safe data. Presets are just `LookParams` objects;
// the look-dev panel is generated from `LOOK_SCHEMA`, so a new parameter needs one entry here
// and one line where it's consumed.

export type ToneMappingName = "agx" | "aces" | "neutral" | "reinhard";
export type AntialiasName = "none" | "fxaa" | "smaa";

export interface LookParams {
  time: {
    /** 0 = morning (sun low in the east), 1 = evening (low in the west). Never night (D16). */
    phase: number;
    drift: boolean;
    /** Seconds from morning to evening while drifting. */
    cycleSeconds: number;
    /** Seconds the evening holds before the clock wraps to morning behind a fade. */
    eveningHold: number;
    /** Pause the placeholder sprites to compare presets on an identical frame. */
    animate: boolean;
  };
  sun: {
    intensity: number;
    /** Compass heading of the sun at midday, degrees. 180 = due south of the scene. */
    heading: number;
    /** How far the sun swings either side of `heading` between morning and evening, degrees. */
    swing: number;
    lowElevation: number;
    highElevation: number;
    morningColor: string;
    middayColor: string;
    eveningColor: string;
  };
  sky: {
    zenithMorning: string;
    zenithEvening: string;
    horizonMorning: string;
    horizonEvening: string;
    /** Hemisphere light: sky-coloured fill from above, ground bounce from below. */
    skyLight: number;
    groundColor: string;
    sunDiscSize: number;
    sunDiscIntensity: number;
  };
  shadows: {
    enabled: boolean;
    mapSize: number;
    /** Half-width of the orthographic shadow frustum in world units. */
    extent: number;
    bias: number;
    normalBias: number;
    softness: number;
    /** Sun-facing proxies let billboards cast full-width shadows whatever the camera angle. */
    spriteShadows: boolean;
  };
  camera: {
    fov: number;
    pitch: number;
    yaw: number;
    distance: number;
    orbit: boolean;
  };
  fog: {
    enabled: boolean;
    color: string;
    /** Blend the fog towards the current horizon colour. */
    skyTint: number;
    near: number;
    far: number;
  };
  ao: {
    enabled: boolean;
    intensity: number;
    radius: number;
    thickness: number;
    distanceExponent: number;
    resolution: number;
  };
  dof: {
    enabled: boolean;
    /** Focus distance relative to the camera target (the player), world units. */
    focusOffset: number;
    focalLength: number;
    bokehScale: number;
  };
  tiltShift: {
    enabled: boolean;
    /** Screen-space height (0 bottom, 1 top) of the sharp band's centre. */
    center: number;
    width: number;
    feather: number;
    blur: number;
  };
  bloom: {
    enabled: boolean;
    strength: number;
    radius: number;
    threshold: number;
  };
  grade: {
    toneMapping: ToneMappingName;
    exposure: number;
    contrast: number;
    saturation: number;
    /** Warm (+) / cool (−) white balance. */
    temperature: number;
    /** Magenta (+) / green (−). */
    tint: number;
    lift: number;
    gamma: number;
    gain: number;
    shadowTint: string;
    highlightTint: string;
    splitToneAmount: number;
    lutIntensity: number;
  };
  vignette: {
    enabled: boolean;
    intensity: number;
    radius: number;
    smoothness: number;
  };
  render: {
    antialias: AntialiasName;
    /** Device-pixel-ratio cap. 1440p on a Retina Mac is already 2560×1440 at 1×. */
    maxPixelRatio: number;
  };
}

type Group = keyof LookParams;

export type FieldSpec =
  | { kind: "number"; min: number; max: number; step?: number; label?: string }
  | { kind: "boolean"; label?: string }
  | { kind: "color"; label?: string }
  | { kind: "options"; options: Record<string, string | number>; label?: string };

/**
 * Fields whose change alters the node graph or GPU resources, so the pipeline is rebuilt
 * (debounced) rather than a uniform updated.
 */
export const STRUCTURAL: ReadonlySet<string> = new Set([
  "shadows.enabled",
  "shadows.mapSize",
  "fog.enabled",
  "ao.enabled",
  "ao.resolution",
  "dof.enabled",
  "tiltShift.enabled",
  "tiltShift.blur",
  "bloom.enabled",
  "grade.toneMapping",
  "vignette.enabled",
  "render.antialias",
]);

const n = (min: number, max: number, step?: number, label?: string): FieldSpec => ({
  kind: "number",
  min,
  max,
  ...(step === undefined ? {} : { step }),
  ...(label === undefined ? {} : { label }),
});
const b: FieldSpec = { kind: "boolean" };
const c: FieldSpec = { kind: "color" };

export const LOOK_SCHEMA: { [G in Group]: { [K in keyof LookParams[G]]: FieldSpec } } = {
  time: {
    phase: n(0, 1, 0.001),
    drift: b,
    cycleSeconds: n(10, 1200, 1, "day (s)"),
    eveningHold: n(0, 300, 1, "evening hold (s)"),
    animate: b,
  },
  sun: {
    intensity: n(0, 10, 0.01),
    heading: n(0, 360, 1),
    swing: n(0, 120, 1),
    lowElevation: n(5, 60, 0.5),
    highElevation: n(15, 85, 0.5),
    morningColor: c,
    middayColor: c,
    eveningColor: c,
  },
  sky: {
    zenithMorning: c,
    zenithEvening: c,
    horizonMorning: c,
    horizonEvening: c,
    skyLight: n(0, 5, 0.01),
    groundColor: c,
    sunDiscSize: n(0, 5, 0.01),
    sunDiscIntensity: n(0, 50, 0.1),
  },
  shadows: {
    enabled: b,
    mapSize: { kind: "options", options: { "1024": 1024, "2048": 2048, "4096": 4096 } },
    extent: n(5, 80, 0.5),
    bias: n(-0.005, 0.005, 0.00001),
    normalBias: n(0, 0.2, 0.001),
    softness: n(0, 10, 0.1),
    spriteShadows: b,
  },
  camera: {
    fov: n(5, 90, 0.5),
    pitch: n(5, 89, 0.5),
    yaw: n(-180, 180, 0.5),
    distance: n(4, 120, 0.1),
    orbit: b,
  },
  fog: { enabled: b, color: c, skyTint: n(0, 1, 0.01), near: n(0, 200, 0.5), far: n(1, 400, 0.5) },
  ao: {
    enabled: b,
    intensity: n(0, 1, 0.01),
    radius: n(0.01, 2, 0.01),
    thickness: n(0.1, 10, 0.1),
    distanceExponent: n(1, 4, 0.01),
    resolution: { kind: "options", options: { quarter: 0.25, half: 0.5, full: 1 } },
  },
  dof: {
    enabled: b,
    focusOffset: n(-20, 20, 0.05),
    focalLength: n(0.5, 60, 0.1),
    bokehScale: n(0, 10, 0.01),
  },
  tiltShift: {
    enabled: b,
    center: n(0, 1, 0.005),
    width: n(0, 0.5, 0.005),
    feather: n(0.01, 0.6, 0.005),
    blur: n(1, 12, 1, "blur (σ)"),
  },
  bloom: { enabled: b, strength: n(0, 3, 0.01), radius: n(0, 1, 0.01), threshold: n(0, 2, 0.01) },
  grade: {
    toneMapping: { kind: "options", options: { AgX: "agx", ACES: "aces", Neutral: "neutral", Reinhard: "reinhard" } },
    exposure: n(0.1, 4, 0.01),
    contrast: n(0.5, 1.6, 0.005),
    saturation: n(0, 2, 0.005),
    temperature: n(-1, 1, 0.005),
    tint: n(-1, 1, 0.005),
    lift: n(-0.2, 0.2, 0.001),
    gamma: n(0.5, 2, 0.005),
    gain: n(0.5, 1.5, 0.005),
    shadowTint: c,
    highlightTint: c,
    splitToneAmount: n(0, 1, 0.005),
    lutIntensity: n(0, 1, 0.01, "LUT mix"),
  },
  vignette: { enabled: b, intensity: n(0, 1, 0.01), radius: n(0.1, 1.5, 0.01), smoothness: n(0.01, 1.5, 0.01) },
  render: {
    antialias: { kind: "options", options: { none: "none", FXAA: "fxaa", SMAA: "smaa" } },
    maxPixelRatio: n(0.5, 2, 0.25, "max pixel ratio"),
  },
};

/** Deep-copies `base` and overlays any matching fields from `patch` (unknown keys ignored). */
export function mergeLook(base: LookParams, patch: unknown): LookParams {
  const out = structuredClone(base);
  if (!patch || typeof patch !== "object") return out;
  const p = patch as Record<string, Record<string, unknown>>;
  for (const group of Object.keys(out) as Group[]) {
    const src = p[group];
    if (!src || typeof src !== "object") continue;
    const dst = out[group] as unknown as Record<string, unknown>;
    for (const key of Object.keys(dst)) {
      if (typeof src[key] === typeof dst[key]) dst[key] = src[key];
    }
  }
  return out;
}
