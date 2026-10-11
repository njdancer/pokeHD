// The outdoor world on one grid: every map the player can walk to from Pallet Town without a
// warp, placed by the game's own map connections (the Pokédex menu's Map tab). Positions are in
// blocks (see types.ts for units), shifted so the world's top-left corner is (0, 0).
import type { Direction, MapData, MapId, WorldData } from "./types.ts";

/** One map's place on the stitched grid. */
export interface StitchedMap {
  id: MapId;
  /** Top-left corner, in blocks. */
  x: number;
  y: number;
  widthBlocks: number;
  heightBlocks: number;
}

/** A connection whose far side was already placed somewhere else by an earlier path. */
export interface StitchMismatch {
  from: MapId;
  to: MapId;
  direction: Direction;
  /** Where this connection would put `to`, and where it is. */
  expected: { x: number; y: number };
  actual: { x: number; y: number };
}

export interface StitchedWorld {
  /** In the order they were reached (breadth first from the start map). */
  maps: StitchedMap[];
  byId: ReadonlyMap<MapId, StitchedMap>;
  /** Always starts at (0, 0); the size of the box around every map, in blocks. */
  bounds: { widthBlocks: number; heightBlocks: number };
  /** Connections that disagree with where the map was placed (none in Pokémon Blue). */
  mismatches: StitchMismatch[];
}

/** Where `to` sits when `from` (at x, y) connects to it in `direction`. */
function neighbourAt(from: MapData, at: { x: number; y: number }, to: MapData, direction: Direction, offset: number) {
  switch (direction) {
    case "north":
      return { x: at.x + offset, y: at.y - to.heightBlocks };
    case "south":
      return { x: at.x + offset, y: at.y + from.heightBlocks };
    case "west":
      return { x: at.x - to.widthBlocks, y: at.y + offset };
    case "east":
      return { x: at.x + from.widthBlocks, y: at.y + offset };
  }
}

/**
 * Places every map reachable from `start` (Pallet Town) through map connections, breadth first.
 * Each map is placed once, by the first connection that reaches it; later connections that
 * disagree are listed in `mismatches` rather than moving anything.
 */
export function stitchOverworld(world: Pick<WorldData, "maps">, start: MapId = 0): StitchedWorld {
  const first = world.maps[start];
  if (!first) throw new Error(`No map ${start} to start stitching from`);
  const placed = new Map<MapId, { x: number; y: number }>([[start, { x: 0, y: 0 }]]);
  const order: MapId[] = [start];
  const mismatches: StitchMismatch[] = [];
  for (let i = 0; i < order.length; i++) {
    const id = order[i]!;
    const map = world.maps[id]!;
    const at = placed.get(id)!;
    for (const c of map.connections) {
      const to = world.maps[c.map];
      if (!to) continue;
      const expected = neighbourAt(map, at, to, c.direction, c.offsetBlocks);
      const actual = placed.get(c.map);
      if (!actual) {
        placed.set(c.map, expected);
        order.push(c.map);
      } else if (actual.x !== expected.x || actual.y !== expected.y) {
        mismatches.push({ from: id, to: c.map, direction: c.direction, expected, actual });
      }
    }
  }
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const id of order) {
    const { x, y } = placed.get(id)!;
    const m = world.maps[id]!;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x + m.widthBlocks);
    maxY = Math.max(maxY, y + m.heightBlocks);
  }
  const maps = order.map((id): StitchedMap => {
    const { x, y } = placed.get(id)!;
    const m = world.maps[id]!;
    return { id, x: x - minX, y: y - minY, widthBlocks: m.widthBlocks, heightBlocks: m.heightBlocks };
  });
  for (const m of mismatches) {
    m.expected = { x: m.expected.x - minX, y: m.expected.y - minY };
    m.actual = { x: m.actual.x - minX, y: m.actual.y - minY };
  }
  return {
    maps,
    byId: new Map(maps.map((m) => [m.id, m])),
    bounds: { widthBlocks: maxX - minX, heightBlocks: maxY - minY },
    mismatches,
  };
}

/**
 * A position in one map's steps (as wXCoord/wYCoord and object data give them) on the stitched
 * grid, in steps (2 per block). Null for maps that aren't part of it (interiors, caves).
 */
export function globalStep(stitched: StitchedWorld, map: MapId, x: number, y: number): { x: number; y: number } | null {
  const m = stitched.byId.get(map);
  return m ? { x: m.x * 2 + x, y: m.y * 2 + y } : null;
}

/** The inverse of `globalStep`: which stitched map holds a global step, and where in it. */
export function localStep(stitched: StitchedWorld, x: number, y: number): { map: MapId; x: number; y: number } | null {
  for (const m of stitched.maps) {
    const lx = x - m.x * 2;
    const ly = y - m.y * 2;
    if (lx >= 0 && ly >= 0 && lx < m.widthBlocks * 2 && ly < m.heightBlocks * 2) return { map: m.id, x: lx, y: ly };
  }
  return null;
}

/** Pairs of stitched maps whose rectangles share any block. */
export function stitchOverlaps(stitched: StitchedWorld): [MapId, MapId][] {
  const out: [MapId, MapId][] = [];
  const { maps } = stitched;
  for (let i = 0; i < maps.length; i++) {
    for (let j = i + 1; j < maps.length; j++) {
      const a = maps[i]!;
      const b = maps[j]!;
      if (a.x < b.x + b.widthBlocks && b.x < a.x + a.widthBlocks && a.y < b.y + b.heightBlocks && b.y < a.y + a.heightBlocks) out.push([a.id, b.id]);
    }
  }
  return out;
}
