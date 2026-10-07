// Knobs every style reads. Defaults are a starting point for Nick to react to, not a decision;
// the dev page exposes them all.
export interface StyleParams {
  /** Front wall height relative to the Game Boy drawing; 1 keeps pixels square. */
  wallScale: number;
  /** Roof ridge rise per unit of half-depth (0.6 ≈ 31°). */
  roofPitch: number;
  /** Roof overhang past the walls, in units (1 unit = 1 step = 16 px). */
  eave: number;
  /** Tree card size; 1 is one step. */
  treeScale: number;
  /** How far upright cards and extruded props lean back from vertical, in degrees. */
  propLean: number;
  /** Thickness of flat voxel props such as fences (hybrid), in units. */
  propDepth: number;
  /** Voxel style: extra height per shade step, in units (darker pixels sit lower). */
  voxelRelief: number;
  /** Hybrid: grass blades per tall-grass tile. */
  grassDensity: number;
  /** Hybrid: grass blade height, in units. */
  grassHeight: number;
  /** Raised height of ledges and cliffs, in units. */
  ledgeHeight: number;
}

export const DEFAULT_STYLE_PARAMS: StyleParams = {
  wallScale: 1.25,
  roofPitch: 0.6,
  eave: 0.12,
  treeScale: 1.35,
  propLean: 20,
  propDepth: 0.25,
  voxelRelief: 0.04,
  grassDensity: 20,
  grassHeight: 0.4,
  ledgeHeight: 0.22,
};
