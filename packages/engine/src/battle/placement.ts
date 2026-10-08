import type { MapData, WorldData } from "@pokehd/rom";
import type { Facing } from "../world/sprites.ts";
import type { ArenaGround } from "./layer.ts";

// Where a battle stands in the world: the player's Pokémon where the player stood, the enemy a
// few steps along the most open way, the way the player faces if it's open enough.

/** The water tile the game surfs on (WATER_TILE). */
const WATER_TILE = 0x14;
/** The enemy stands this many steps away when there's room, and no closer than the minimum. */
const ARENA_STEPS = 4;
const MIN_STEPS = 2.5;

const DIRECTIONS: Record<Facing, [number, number]> = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };

/** Ground for the bases and the stage, from the map's tileset. */
export function arenaGround(world: WorldData, map: MapData, onWater: boolean): ArenaGround {
  if (onWater) return "water";
  const name = world.tilesets[map.tileset]?.name ?? "";
  if (name === "OVERWORLD" || name === "PLATEAU") return "grass";
  if (name === "FOREST") return "forest";
  if (name === "CAVERN") return "cave";
  return "floor";
}

/**
 * The two sides' ground positions, map-local in world units (1 per step, cell centres as the
 * overworld draws people), for a player standing at step (x, y).
 */
export function arenaPlacement(
  world: WorldData,
  map: MapData,
  at: { x: number; y: number; facing: Facing },
  onWater = false,
): { player: { x: number; z: number }; enemy: { x: number; z: number }; ground: ArenaGround } {
  const tileset = world.tilesets[map.tileset]!;
  const width = map.widthBlocks * 2;
  const height = map.heightBlocks * 2;
  const open = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return false;
    const block = map.blocks[(y >> 1) * map.widthBlocks + (x >> 1)]!;
    const tile = tileset.blocks[block * 16 + ((y & 1) * 2 + 1) * 4 + (x & 1) * 2]!;
    return tileset.semantics.walkable.includes(tile) || (onWater && tile === WATER_TILE);
  };
  const run = (facing: Facing) => {
    const [dx, dy] = DIRECTIONS[facing];
    let n = 0;
    while (n < ARENA_STEPS && open(at.x + dx * (n + 1), at.y + dy * (n + 1))) n++;
    return n;
  };
  const order: Facing[] = [at.facing, ...(["up", "down", "left", "right"] as const).filter((f) => f !== at.facing)];
  let best = order[0]!;
  let bestRun = run(best);
  for (const f of order) {
    if (bestRun >= 3) break;
    const r = run(f);
    if (r > bestRun) [best, bestRun] = [f, r];
  }
  const steps = Math.max(bestRun, MIN_STEPS);
  const [dx, dy] = DIRECTIONS[best];
  const player = { x: at.x + 0.5, z: at.y + 0.6 };
  return {
    player,
    enemy: { x: player.x + dx * steps, z: player.z + dy * steps },
    ground: arenaGround(world, map, onWater),
  };
}
