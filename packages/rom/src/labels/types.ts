/** What a tile depicts, for the HD renderer. Kept small on purpose: Nick reviews every entry. */
export const LABELS = [
  "ground", // bare walkable ground and paths
  "lawn", // short decorative grass you can walk on
  "tall-grass", // encounter grass
  "flower",
  "tree",
  "cliff", // raised rock and plateau faces you can't climb
  "ledge", // one-way hops down
  "stairs",
  "water",
  "shore", // water's edge
  "bridge", // bridges and piers
  "roof",
  "wall",
  "window",
  "door",
  "lettering", // text on buildings (GYM, POKé, MART)
  "fence", // fences and bollards
  "sign",
  "cave", // cave mouths
  "unused", // past the end of the tileset graphics; the game never shows it
] as const;

export type Label = (typeof LABELS)[number];

/** Hand labels for one tileset. Seeds from the ROM fill anything not listed in `tiles`. */
export interface TilesetLabelTable {
  /** Tile ID → label, for tiles the ROM's lists don't cover (or cover wrongly for rendering). */
  tiles: Partial<Record<number, Label>>;
  /**
   * Block ID → (tile position 0–15 in the block, row-major) → label. For tiles that mean
   * different things in different blocks, e.g. a ledge edge that's really a mountain base.
   * Block overrides beat tile labels.
   */
  blocks: Partial<Record<number, Partial<Record<number, Label>>>>;
}
