import { blockLabels, LABELS, type Label, type MapData, type MapId, type Tileset, type WorldData } from "@pokehd/rom";

// A region is several connected maps stitched onto one tile grid, with border blocks filling
// the gaps, so a style can build one continuous piece of world. All styles start from this.
//
// World units: 1 unit = 1 player step (16 px), matching the look-dev placeholder. Map x runs
// along +X, map y (south) along +Z, so the camera looks north by default. 1 tile = 0.5 units.

export const PX_PER_UNIT = 16;
export const TILE_UNITS = 0.5;

/** `LABELS` index per tile; this marks tiles nothing labels. */
export const NO_LABEL = 255;

export interface PlacedMap {
  map: MapData;
  /** Map origin in region tiles. */
  x: number;
  y: number;
}

export interface Region {
  widthTiles: number;
  heightTiles: number;
  /** Tile ID per tile, row-major. */
  tiles: Uint8Array;
  /** `LABELS` index per tile, row-major; `NO_LABEL` where unlabelled or not drawn. */
  labels: Uint8Array;
  /** 1 where the tile is drawn, 0 where another chunk owns it (see `RegionOptions.drawBorder`). */
  present: Uint8Array;
  /** DMG shade (0 lightest … 3 darkest) per pixel, row-major, `widthTiles * 8` wide. */
  shades: Uint8Array;
  maps: PlacedMap[];
  /** The tileset every map in the region shares. */
  tileset: Tileset;
  /** Where the root map's origin sits, in region tiles: subtract to get root-map coordinates. */
  rootX: number;
  rootY: number;
}

export interface RegionOptions {
  /** Maps to stitch, reached from the root through connections. Defaults to the root alone. */
  include?: MapId[];
  /** Border blocks added on every side. */
  marginBlocks?: number;
  /**
   * Whether to draw the border block at (bx, by), in blocks relative to the root map. Lets
   * neighbouring chunks, each built from its own map, share the border without overlapping.
   * Map blocks are always drawn.
   */
  drawBorder?: (bx: number, by: number) => boolean;
}

/** Map origins in blocks, relative to the root, following connections between included maps. */
export function placeMaps(world: WorldData, root: MapId, include: MapId[] = []): { map: MapData; bx: number; by: number }[] {
  const wanted = new Set([root, ...include]);
  const rootMap = world.maps[root];
  if (!rootMap) throw new Error(`no map ${root}`);
  const placed = new Map<MapId, { map: MapData; bx: number; by: number }>([[root, { map: rootMap, bx: 0, by: 0 }]]);
  const queue = [root];
  while (queue.length) {
    const from = placed.get(queue.shift()!)!;
    for (const c of from.map.connections) {
      const to = world.maps[c.map];
      if (!to || !wanted.has(c.map) || placed.has(c.map)) continue;
      const { bx, by, map } = from;
      const at =
        c.direction === "north" ? { bx: bx + c.offsetBlocks, by: by - to.heightBlocks }
        : c.direction === "south" ? { bx: bx + c.offsetBlocks, by: by + map.heightBlocks }
        : c.direction === "west" ? { bx: bx - to.widthBlocks, by: by + c.offsetBlocks }
        : { bx: bx + map.widthBlocks, by: by + c.offsetBlocks };
      placed.set(c.map, { map: to, ...at });
      queue.push(c.map);
    }
  }
  return [...placed.values()];
}

export function buildRegion(world: WorldData, root: MapId, options: RegionOptions = {}): Region {
  const margin = options.marginBlocks ?? 2;
  const placed = placeMaps(world, root, options.include);
  const minX = Math.min(...placed.map((p) => p.bx)) - margin;
  const minY = Math.min(...placed.map((p) => p.by)) - margin;
  const maxX = Math.max(...placed.map((p) => p.bx + p.map.widthBlocks)) + margin;
  const maxY = Math.max(...placed.map((p) => p.by + p.map.heightBlocks)) + margin;
  const wb = maxX - minX;
  const hb = maxY - minY;

  // Block per region block; gaps take the root map's border block. All maps here share a tileset.
  const rootMap = placed[0]!.map;
  const tileset = world.tilesets[rootMap.tileset]!;
  if (placed.some((p) => p.map.tileset !== rootMap.tileset)) throw new Error("region maps must share a tileset");
  const grid = new Uint8Array(wb * hb).fill(rootMap.borderBlock);
  const drawn = new Uint8Array(wb * hb);
  const drawBorder = options.drawBorder ?? (() => true);
  for (let y = 0; y < hb; y++) for (let x = 0; x < wb; x++) drawn[y * wb + x] = drawBorder(x + minX, y + minY) ? 1 : 0;
  for (const { map, bx, by } of placed) {
    for (let y = 0; y < map.heightBlocks; y++) {
      for (let x = 0; x < map.widthBlocks; x++) {
        grid[(by - minY + y) * wb + bx - minX + x] = map.blocks[y * map.widthBlocks + x]!;
        drawn[(by - minY + y) * wb + bx - minX + x] = 1;
      }
    }
  }

  const widthTiles = wb * 4;
  const heightTiles = hb * 4;
  const tiles = new Uint8Array(widthTiles * heightTiles);
  const labels = new Uint8Array(widthTiles * heightTiles).fill(NO_LABEL);
  const present = new Uint8Array(widthTiles * heightTiles);
  const shades = new Uint8Array(widthTiles * heightTiles * 64);
  const perBlock = blockLabels(tileset);
  const pxWidth = widthTiles * 8;
  for (let ty = 0; ty < heightTiles; ty++) {
    for (let tx = 0; tx < widthTiles; tx++) {
      const block = grid[(ty >> 2) * wb + (tx >> 2)]!;
      present[ty * widthTiles + tx] = drawn[(ty >> 2) * wb + (tx >> 2)]!;
      const i = (ty & 3) * 4 + (tx & 3);
      const tile = tileset.blocks[block * 16 + i]!;
      const label = perBlock[block]?.[i];
      tiles[ty * widthTiles + tx] = tile;
      if (label && present[ty * widthTiles + tx]) labels[ty * widthTiles + tx] = LABELS.indexOf(label);
      for (let p = 0; p < 64; p++) {
        shades[(ty * 8 + (p >> 3)) * pxWidth + tx * 8 + (p & 7)] = tileset.tiles[tile * 64 + p]!;
      }
    }
  }

  return {
    widthTiles,
    heightTiles,
    tiles,
    labels,
    present,
    shades,
    maps: placed.map((p) => ({ map: p.map, x: (p.bx - minX) * 4, y: (p.by - minY) * 4 })),
    tileset,
    rootX: -minX * 4,
    rootY: -minY * 4,
  };
}

export function labelAt(region: Region, tx: number, ty: number): Label | undefined {
  if (tx < 0 || ty < 0 || tx >= region.widthTiles || ty >= region.heightTiles) return undefined;
  return LABELS[region.labels[ty * region.widthTiles + tx]!];
}
