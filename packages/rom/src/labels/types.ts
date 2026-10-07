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
  "unused", // no block draws it (or past the end of the tileset graphics); the game never shows it
  // Interiors (p1-labels-interiors). Appended so the index of every label above stays put.
  "floor", // walkable indoor floor, including rugs, doormats and gym floor markings
  "wall-interior", // back walls, and the raised partitions in gyms and the Elite Four rooms
  "void", // the black outside a room's walls
  "furniture", // chairs, stools, beds, bins and other small props
  "table",
  "counter", // shop and Pokécentre counters you talk across
  "shelf", // bookshelves, shop shelving and display cases
  "machine", // PCs, TVs, consoles, the healing machine, lab equipment, cash registers
  "plant", // potted plants
  "picture", // things hung or painted on walls: maps, posters, emblems, blackboards, lamps
  "statue", // gym statues on their plinths
  "rock", // boulders inside gyms (Pewter, Bruno)
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
