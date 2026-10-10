import type { DayCycle } from "./cycle.ts";
import { mergeLook, type LookParams } from "./params.ts";

// Built-in presets. Each is the JSON the panel's "Copy JSON" produces (trimmed to the fields
// that differ from DEFAULT_LOOK). The shipped look is DEFAULT_CYCLE (see D15).

export const DEFAULT_LOOK: LookParams = {
  time: { phase: 0.35, dusk: 0, drift: true, cycleSeconds: 240, duskSeconds: 30, eveningHold: 30, dawnSeconds: 45, animate: true },
  sun: {
    intensity: 3.2,
    heading: 170,
    swing: 85,
    lowElevation: 9,
    highElevation: 52,
    morningColor: "#ffd8ad",
    middayColor: "#fff4e3",
    eveningColor: "#ffb877",
  },
  sky: {
    zenithMorning: "#5d8fd6",
    zenithEvening: "#4a76c4",
    horizonMorning: "#f3d9b8",
    horizonEvening: "#f5b97a",
    skyLight: 1.1,
    groundColor: "#7a6a4f",
    sunDiscSize: 1.2,
    sunDiscIntensity: 12,
  },
  shadows: {
    enabled: true,
    mapSize: 2048,
    extent: 24,
    bias: -0.0004,
    normalBias: 0.02,
    softness: 2.5,
    spriteShadows: true,
  },
  camera: { fov: 24, pitch: 38, yaw: 0, distance: 30, orbit: false },
  fog: { enabled: true, color: "#cfd9e6", skyTint: 0.6, near: 30, far: 110 },
  ao: { enabled: true, intensity: 0.8, radius: 0.35, thickness: 1, distanceExponent: 1.4, resolution: 0.5 },
  dof: { enabled: true, focusOffset: 0, focalLength: 9, bokehScale: 2.2 },
  tiltShift: { enabled: true, center: 0.45, width: 0.12, feather: 0.3, blur: 4 },
  bloom: { enabled: true, strength: 0.35, radius: 0.5, threshold: 0.85 },
  grade: {
    toneMapping: "agx",
    exposure: 1.1,
    contrast: 1.06,
    saturation: 1.12,
    temperature: 0.08,
    tint: 0,
    lift: 0.01,
    gamma: 1,
    gain: 1,
    shadowTint: "#3b4c78",
    highlightTint: "#ffd9a8",
    splitToneAmount: 0.18,
    placeTint: 0.15,
    lutIntensity: 1,
  },
  vignette: { enabled: true, intensity: 0.35, radius: 0.85, smoothness: 0.6 },
  render: { antialias: "smaa", maxPixelRatio: 2 },
};

const preset = (patch: object): LookParams => mergeLook(DEFAULT_LOOK, patch);

export const BUILT_IN_PRESETS: Record<string, LookParams> = {
  "Diorama": preset({ time: { phase: 0.35, drift: false } }),
  "Golden hour": preset({
    time: { phase: 0.92, drift: false },
    sun: { intensity: 4.2, eveningColor: "#ffa864" },
    sky: { horizonEvening: "#f7a868", skyLight: 1.1, sunDiscIntensity: 20 },
    shadows: { softness: 3.5 },
    fog: { color: "#f2c9a0", skyTint: 0.6, near: 28, far: 120 },
    dof: { focalLength: 7, bokehScale: 3 },
    tiltShift: { width: 0.1, blur: 5 },
    bloom: { strength: 0.6, radius: 0.7, threshold: 0.7 },
    grade: { exposure: 1.35, contrast: 1.06, saturation: 1.15, temperature: 0.16, splitToneAmount: 0.25, highlightTint: "#ffc58a" },
    vignette: { intensity: 0.45 },
  }),
  "Storybook": preset({
    time: { phase: 0.2, drift: false },
    sun: { intensity: 2.6, morningColor: "#ffe6c7" },
    sky: { zenithMorning: "#86b3e8", horizonMorning: "#fbe7cf", skyLight: 1.6, groundColor: "#a49372" },
    shadows: { softness: 5, extent: 22 },
    fog: { color: "#e7ecf2", skyTint: 0.4, near: 35, far: 130 },
    ao: { intensity: 0.5, radius: 0.5 },
    dof: { focalLength: 6, bokehScale: 2.8 },
    tiltShift: { center: 0.42, width: 0.08, feather: 0.35, blur: 6 },
    bloom: { strength: 0.35, radius: 0.8, threshold: 0.8 },
    grade: {
      exposure: 1.15, contrast: 0.97, saturation: 1.05, temperature: 0.05, tint: 0.03, lift: 0.025,
      gamma: 1.08, shadowTint: "#5b6aa0", highlightTint: "#ffe9c9", splitToneAmount: 0.25,
    },
    vignette: { intensity: 0.25, smoothness: 0.9 },
  }),
};

// Dusk (D40): the sun has gone, so there are no direct shadows; the sky light carries the scene
// in low, warm tones. Morning and evening colours match, so the clock can jump the sun back to
// the east under it unseen.
const DUSK_SKY = { zenith: "#5a6292", horizon: "#e9a07a" };
BUILT_IN_PRESETS["Dusk"] = preset({
  time: { phase: 1, drift: false },
  sun: { intensity: 0, morningColor: "#ff9a62", middayColor: "#ff9a62", eveningColor: "#ff9a62" },
  sky: {
    zenithMorning: DUSK_SKY.zenith, zenithEvening: DUSK_SKY.zenith,
    horizonMorning: DUSK_SKY.horizon, horizonEvening: DUSK_SKY.horizon,
    skyLight: 2.3, groundColor: "#8c5f4a", sunDiscIntensity: 0,
  },
  shadows: { softness: 3.5 },
  fog: { color: "#c98f78", skyTint: 0.5, near: 28, far: 115 },
  dof: { focalLength: 7, bokehScale: 3 },
  tiltShift: { width: 0.1, blur: 5 },
  bloom: { strength: 0.45, radius: 0.7, threshold: 0.75 },
  grade: {
    exposure: 1.15, contrast: 1.02, saturation: 1.0, temperature: 0.2, tint: 0.03, lift: 0.015,
    shadowTint: "#4a3f78", highlightTint: "#ffb98a", splitToneAmount: 0.3,
  },
  vignette: { intensity: 0.5 },
});

// Indoors and caves have no day cycle (D40). Rooms take the midday look; caves are darker and
// cooler, lit by a dim cold light from overhead, with the dark closing in at the edges.
BUILT_IN_PRESETS["Cave"] = preset({
  time: { phase: 0.5, drift: false },
  sun: { intensity: 1.3, morningColor: "#a9b8d6", middayColor: "#a9b8d6", eveningColor: "#a9b8d6" },
  sky: {
    zenithMorning: "#10131b", zenithEvening: "#10131b", horizonMorning: "#1d1e26", horizonEvening: "#1d1e26",
    skyLight: 1.0, groundColor: "#4a3c30", sunDiscIntensity: 0,
  },
  shadows: { softness: 4 },
  fog: { color: "#15171e", skyTint: 0, near: 30, far: 75 },
  bloom: { strength: 0.3, threshold: 0.9 },
  grade: {
    exposure: 1.0, contrast: 1.1, saturation: 0.88, temperature: -0.1, tint: 0, lift: 0,
    shadowTint: "#1f2c50", highlightTint: "#e6d6b8", splitToneAmount: 0.3,
  },
  vignette: { intensity: 0.65, radius: 0.75, smoothness: 0.7 },
});

/** The chosen look (D15): golden mornings and evenings around a Diorama midday. */
export const DEFAULT_CYCLE_NAMES = { morning: "Golden hour", midday: "Diorama", evening: "Golden hour", dusk: "Dusk" } as const;

export const DEFAULT_CYCLE: DayCycle = {
  morning: BUILT_IN_PRESETS[DEFAULT_CYCLE_NAMES.morning]!,
  midday: BUILT_IN_PRESETS[DEFAULT_CYCLE_NAMES.midday]!,
  evening: BUILT_IN_PRESETS[DEFAULT_CYCLE_NAMES.evening]!,
  dusk: BUILT_IN_PRESETS[DEFAULT_CYCLE_NAMES.dusk]!,
};

/** The fixed look for caves (D40). */
export const CAVE_LOOK: LookParams = BUILT_IN_PRESETS["Cave"]!;
