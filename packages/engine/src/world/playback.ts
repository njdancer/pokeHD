import { MAP_NAMES, type MapData, type MapId, type WorldData } from "@pokehd/rom";
import type { GhostState } from "./ghosts.ts";
import type { LiveActor, LiveState } from "./live.ts";
import { buildRegion } from "./region.ts";
import { initialFacing, type Facing } from "./sprites.ts";

// A stand-in for a recorded emulator session: a scripted walk across connected maps, one state
// per Game Boy frame, shaped like the decoder's output. It lets the live world be built and
// profiled without the emulator; a real recording from the state reader replaces it as a fixture.
// Moves follow the game's timing: a walking step takes 8 frames, the walk animation advances
// every 4, and a door warp fades out and in a third at a time.

export interface ScriptedState extends LiveState {
  player: LiveActor & { facing: Facing };
}

export interface WalkPlan {
  /** Maps to walk across (connected, same tileset); the first holds the start. */
  maps: MapId[];
  start: { map: MapId; x: number; y: number };
  /** The goal cell; if it's a warp, the walk ends by taking it. */
  goal: { map: MapId; x: number; y: number };
}

const STEP_FRAMES = 8;
const FADE_STEP_FRAMES = 8;

export function scriptedWalk(world: WorldData, plan: WalkPlan): ScriptedState[] {
  const region = buildRegion(world, plan.maps[0]!, { include: plan.maps.slice(1), marginBlocks: 0 });
  const tileset = world.tilesets[region.tileset.id]!;
  const walkable = new Set(tileset.semantics.walkable);
  const sw = region.widthTiles / 2;
  const sh = region.heightTiles / 2;
  const origin = (id: MapId) => {
    const m = region.maps.find((p) => p.map.id === id)!;
    return { sx: m.x / 2, sy: m.y / 2 };
  };
  const mapAt = (sx: number, sy: number) =>
    region.maps.find((p) => sx >= p.x / 2 && sy >= p.y / 2 && sx < p.x / 2 + p.map.widthBlocks * 2 && sy < p.y / 2 + p.map.heightBlocks * 2);
  // The game checks the tile under the bottom-left quarter of a step cell.
  const open = (sx: number, sy: number) =>
    sx >= 0 && sy >= 0 && sx < sw && sy < sh && !!mapAt(sx, sy) && walkable.has(region.tiles[(sy * 2 + 1) * region.widthTiles + sx * 2]!);

  const s0 = origin(plan.start.map);
  const g0 = origin(plan.goal.map);
  const start = { sx: s0.sx + plan.start.x, sy: s0.sy + plan.start.y };
  const goal = { sx: g0.sx + plan.goal.x, sy: g0.sy + plan.goal.y };

  // Breadth-first path over walkable cells (ledges count as walls; routes go round them).
  const from = new Map<number, number>();
  const key = (x: number, y: number) => y * sw + x;
  const queue = [key(start.sx, start.sy)];
  from.set(queue[0]!, -1);
  while (queue.length) {
    const k = queue.shift()!;
    if (k === key(goal.sx, goal.sy)) break;
    const x = k % sw;
    const y = Math.floor(k / sw);
    for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]] as const) {
      const nk = key(x + dx, y + dy);
      const isGoal = x + dx === goal.sx && y + dy === goal.sy;
      if (from.has(nk) || !(open(x + dx, y + dy) || isGoal)) continue;
      from.set(nk, k);
      queue.push(nk);
    }
  }
  if (!from.has(key(goal.sx, goal.sy))) throw new Error("no path");
  const path: { sx: number; sy: number }[] = [];
  for (let k = key(goal.sx, goal.sy); k !== -1; k = from.get(k)!) path.unshift({ sx: k % sw, sy: Math.floor(k / sw) });

  const frames: ScriptedState[] = [];
  let facing: Facing = "down";
  let walkFrame = 0;
  const emit = (map: MapData, ox: number, oy: number, player: Omit<ScriptedState["player"], "facing">, fade = 0) =>
    frames.push({
      mapId: map.id,
      player: { ...player, facing, x: player.x - ox, y: player.y - oy },
      npcs: map.npcs.map((n, i) => ({
        slot: i + 1, x: n.x, y: n.y, step: null, animFrame: 0, visible: true, pictureId: n.sprite, facing: initialFacing(n.movement),
      })),
      fade,
    });
  const at = (sx: number, sy: number) => {
    const m = mapAt(sx, sy)!;
    return { map: m.map, ox: m.x / 2, oy: m.y / 2 };
  };
  const idle = (sx: number, sy: number, n: number, fade = 0) => {
    const { map, ox, oy } = at(sx, sy);
    for (let i = 0; i < n; i++) emit(map, ox, oy, { x: sx, y: sy, step: null, animFrame: 0 }, fade);
  };

  idle(start.sx, start.sy, 40);
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1]!;
    const b = path[i]!;
    const dx = b.sx - a.sx;
    const dy = b.sy - a.sy;
    facing = dx > 0 ? "right" : dx < 0 ? "left" : dy > 0 ? "down" : "up";
    const { map, ox, oy } = at(a.sx, a.sy);
    for (let f = 1; f < STEP_FRAMES; f++) {
      emit(map, ox, oy, { x: a.sx, y: a.sy, step: { dx, dy, progress: f / STEP_FRAMES }, animFrame: Math.floor(walkFrame++ / 4) % 4 });
    }
    walkFrame++;
    const end = at(b.sx, b.sy);
    emit(end.map, end.ox, end.oy, { x: b.sx, y: b.sy, step: null, animFrame: Math.floor(walkFrame / 4) % 4 });
  }

  // Take the warp if the goal is one: fade out, change map, fade in.
  const goalMap = world.maps[plan.goal.map]!;
  const warp = goalMap.warps.find((w) => w.x === plan.goal.x && w.y === plan.goal.y);
  if (warp && warp.to !== "last") {
    for (const level of [1 / 3, 2 / 3, 1]) idle(goal.sx, goal.sy, FADE_STEP_FRAMES, level);
    const inside = world.maps[warp.to]!;
    const arrive = inside.warps[warp.toWarp] ?? { x: 0, y: 0 };
    facing = "up";
    const stand = (n: number, fade: number, y = arrive.y) => {
      for (let i = 0; i < n; i++) emit(inside, 0, 0, { x: arrive.x, y, step: null, animFrame: 0 }, fade);
    };
    stand(FADE_STEP_FRAMES * 2, 1);
    for (const level of [2 / 3, 1 / 3]) stand(FADE_STEP_FRAMES, level);
    stand(30, 0);
    // A few steps in, so the interior shows movement too.
    let y = arrive.y;
    for (let s = 0; s < 3; s++, y--) {
      for (let f = 1; f < STEP_FRAMES; f++) {
        emit(inside, 0, 0, { x: arrive.x, y, step: { dx: 0, dy: -1, progress: f / STEP_FRAMES }, animFrame: Math.floor(walkFrame++ / 4) % 4 });
      }
      walkFrame++;
    }
    stand(60, 0, y);
  } else {
    idle(goal.sx, goal.sy, 60);
  }
  return frames;
}

/** Pallet Town (outside Red's house) to Viridian City's Pokémon Center, through Route 1. */
export function palletToViridian(world: WorldData): ScriptedState[] {
  const id = (name: string) => MAP_NAMES.indexOf(name);
  return scriptedWalk(world, {
    maps: [id("PALLET_TOWN"), id("ROUTE_1"), id("VIRIDIAN_CITY")],
    start: { map: id("PALLET_TOWN"), x: 5, y: 6 },
    goal: { map: id("VIRIDIAN_CITY"), x: 23, y: 25 },
  });
}

/** A scripted state's player as a friend's ghost, for playing a recording back as a second player. */
export function asGhost(id: string, name: string, state: ScriptedState): GhostState {
  const { x, y, step, animFrame } = state.player;
  return { id, name, mapId: state.mapId, x, y, step, animFrame };
}
