// The WorldData model: everything the renderer needs about the overworld, parsed from ROM bytes.
// Formats are documented in vendor/pokered (data/maps, data/tilesets, macros/scripts/maps.asm).
//
// Units, used throughout:
// - tile: 8×8 px, the Game Boy's unit of graphics.
// - block: 4×4 tiles (32 px), the unit map layouts are stored in.
// - step: 2×2 tiles (16 px), one player step. Warps, signs and NPCs are positioned in steps,
//   from the map's top-left corner. A block is 2×2 steps.
// Field names carry their unit where it isn't obvious (`widthBlocks`, `offsetBlocks`).

/** Map IDs are the game's own (0 = Pallet Town … 247). */
export type MapId = number;
/** Tileset IDs are the game's own (0 = OVERWORLD … 23 = PLATEAU). */
export type TilesetId = number;

export interface WorldData {
  /** Indexed by map ID. `null` for the unused slots the game skips (e.g. 0x0b, 0x69–0x73). */
  maps: (MapData | null)[];
  /** Indexed by tileset ID. Tilesets that share graphics in ROM share the same arrays here. */
  tilesets: Tileset[];
}

export interface MapData {
  id: MapId;
  /** Constant name from the disassembly, e.g. "PALLET_TOWN"; a committed label, not ROM data. */
  name: string;
  tileset: TilesetId;
  widthBlocks: number;
  heightBlocks: number;
  /** Block IDs into the tileset's blockset, row-major, `widthBlocks * heightBlocks` long. */
  blocks: Uint8Array;
  /** Block drawn outside the map where there's no connection (the "border block"). */
  borderBlock: number;
  /** At most one per direction. */
  connections: Connection[];
  warps: Warp[];
  signs: Sign[];
  npcs: Npc[];
}

export type Direction = "north" | "south" | "west" | "east";

export interface Connection {
  direction: Direction;
  map: MapId;
  /**
   * Where the neighbour sits along the shared edge, in blocks, relative to this map's origin:
   * x for north/south, y for west/east. 0 = aligned; negative = it starts before ours.
   * (The `connection` macro's 4th argument; the ROM stores derived window pointers, which the
   * parser converts back.)
   */
  offsetBlocks: number;
}

export interface Warp {
  /** Position in steps. */
  x: number;
  y: number;
  /** Destination map, or "last" for warps back to wherever the player came from (map −1). */
  to: MapId | "last";
  /** Index into the destination map's `warps` (0-based). */
  toWarp: number;
}

export interface Sign {
  x: number;
  y: number;
  /** Text ID in the map's text pointer table; kept so presence/UI can refer to it. */
  textId: number;
}

export type NpcMovement =
  /** Standing still. "none" keeps whatever way the sprite last faced; "any" turns at random. */
  | { kind: "stay"; facing: "down" | "up" | "left" | "right" | "none" | "any" }
  | { kind: "walk"; range: "any" | "up-down" | "left-right" }
  /** A Strength boulder. */
  | { kind: "boulder" };

export interface NpcBase {
  /** Position in steps. */
  x: number;
  y: number;
  /** Sprite ID (SPRITE_* constant); sprite sheets are extracted separately. */
  sprite: number;
  movement: NpcMovement;
  textId: number;
}

export type Npc =
  | (NpcBase & { kind: "person" })
  | (NpcBase & { kind: "item"; item: number })
  | (NpcBase & { kind: "trainer"; trainerClass: number; trainerNumber: number })
  /** A static battle (Power Plant Voltorb, Zapdos, Mewtwo): trainer flag with a species < 200. */
  | (NpcBase & { kind: "pokemon"; species: number; level: number });

export type TileAnimation = "none" | "water" | "water-flower";

export interface Tileset {
  id: TilesetId;
  /** Constant name, e.g. "OVERWORLD". */
  name: string;
  /**
   * 4×4-tile metatiles: `blockCount * 16` tile IDs, block-major then row-major
   * (`blocks[b * 16 + ty * 4 + tx]`).
   */
  blocks: Uint8Array;
  blockCount: number;
  /**
   * Decoded 2bpp graphics, one byte (0–3) per pixel: `tiles[t * 64 + py * 8 + px]`.
   * Always 96 tiles (MAP_TILESET_SIZE); the game loads exactly that many to VRAM. No colour here:
   * palettes come from the SGB/CGB data separately.
   */
  tiles: Uint8Array;
  animation: TileAnimation;
  semantics: TilesetSemantics;
}

/**
 * Per-tileset tile and block lists the game's code checks. These seed the hand-made semantic
 * labels (p0-labels); they don't replace them. Tile IDs are 0–95 (0x00–0x5f).
 */
export interface TilesetSemantics {
  /** Tiles the player can stand on (`*_Coll` lists; everything else blocks movement). */
  walkable: number[];
  /** Tall grass that triggers encounters, if any. */
  grass: number | null;
  /** Tiles you talk across (shop counters), up to 3. */
  counters: number[];
  doors: number[];
  /** Tiles that warp the player when stepped on. */
  warps: number[];
  /** Warp tiles that need the player to walk off the edge in a direction (mats, stairs). */
  warpCarpets: { facing: "down" | "up" | "left" | "right"; tiles: number[] }[];
  /** Tiles that print text when faced (bookshelves, statues, PCs, elevator panels). */
  bookshelves: number[];
  /** Pairs of walkable tiles the player can't step between (elevation changes). */
  pairCollisions: { tileA: number; tileB: number; surfing: boolean }[];
  /** Ledges: standing on `standingOn` facing `facing`, the tile ahead `ledge` hops you down. */
  ledges: { facing: "down" | "left" | "right"; standingOn: number; ledge: number }[];
  warpPads: number[];
  holes: number[];
  /** Spinner floor tiles (Viridian Gym, Rocket Hideout). */
  spinners: number[];
  /** Blocks containing a Cut tree, and the block that replaces each after cutting. */
  cutTrees: { block: number; replacement: number }[];
  /** Whether the game allows surfing on this tileset's water. */
  hasWater: boolean;
}
