// The world renderer (Track D): ROM map data to 3D, in the styles under comparison (p0-styles).
export { buildRegion, placeMaps, PX_PER_UNIT, TILE_UNITS, type Region, type RegionOptions } from "./region.ts";
export { DEFAULT_STYLE_PARAMS, type StyleParams } from "./params.ts";
export { buildStyle, STYLES, type StyleId } from "./styles.ts";
export { createStyledWorld, regionFocuses, type Focus, type StyledWorld } from "./content.ts";

/** Camera framings every style is judged from; values for the engine's `look.params.camera`. */
export const VIEW_PRESETS = {
  /** Close to the Game Boy's straight-down framing. */
  overhead: { pitch: 62, yaw: 0, distance: 34, fov: 24 },
  /** The locked look's own framing (D15): lower, long lens. */
  hd2d: { pitch: 38, yaw: 0, distance: 30, fov: 24 },
  /** Street level, to judge how buildings and trees hold up from the side. */
  low: { pitch: 14, yaw: 28, distance: 16, fov: 34 },
} as const;
export type ViewPreset = keyof typeof VIEW_PRESETS;
