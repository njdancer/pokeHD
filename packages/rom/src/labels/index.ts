import type { Tileset } from "../world/types.ts";
import { CAVERN } from "./cavern.ts";
import { FOREST } from "./forest.ts";
import { GATE } from "./gate.ts";
import { GYM } from "./gym.ts";
import { HOUSE } from "./house.ts";
import { OVERWORLD } from "./overworld.ts";
import { POKECENTER } from "./pokecenter.ts";
import { REDS_HOUSE } from "./reds-house.ts";
import type { Label, TilesetLabelTable } from "./types.ts";

export { LABELS, type Label, type TilesetLabelTable } from "./types.ts";

/**
 * Hand-labelled tilesets, by tileset name. Others are seeded from the ROM only. Tilesets that share
 * graphics and blocks in ROM share a table.
 */
export const LABEL_TABLES: Partial<Record<string, TilesetLabelTable>> = {
  OVERWORLD,
  REDS_HOUSE_1: REDS_HOUSE,
  REDS_HOUSE_2: REDS_HOUSE,
  HOUSE,
  POKECENTER,
  MART: POKECENTER,
  GYM,
  DOJO: GYM,
  FOREST,
  GATE,
  MUSEUM: GATE,
  FOREST_GATE: GATE,
  CAVERN,
};

/** Labels the ROM's own lists imply: doors, tall grass, ledges. */
export function seedLabels(tileset: Tileset): (Label | undefined)[] {
  const out: (Label | undefined)[] = new Array(96).fill(undefined);
  const { semantics } = tileset;
  for (const t of semantics.doors) out[t] = "door";
  for (const l of semantics.ledges) out[l.ledge] = "ledge";
  if (semantics.grass !== null) out[semantics.grass] = "tall-grass";
  return out;
}

/** Per-tile labels: hand table over ROM seeds. `undefined` where neither says anything. */
export function tileLabels(tileset: Tileset): (Label | undefined)[] {
  const hand = LABEL_TABLES[tileset.name]?.tiles ?? {};
  return seedLabels(tileset).map((seed, t) => hand[t] ?? seed);
}

/** Labels for each block's 16 tiles (row-major), with block overrides applied. */
export function blockLabels(tileset: Tileset): (Label | undefined)[][] {
  const tiles = tileLabels(tileset);
  const overrides = LABEL_TABLES[tileset.name]?.blocks ?? {};
  return Array.from({ length: tileset.blockCount }, (_, b) =>
    Array.from({ length: 16 }, (_, i) => overrides[b]?.[i] ?? tiles[tileset.blocks[b * 16 + i]!]),
  );
}
