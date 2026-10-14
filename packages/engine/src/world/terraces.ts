import { LABELS, type Label } from "@pokehd/rom";
import type { Region } from "./region.ts";

// Cave floors at their heights. The Game Boy draws a cave as terraces seen from the south: a
// raised floor shows its top and, below it, a rock face; the sides of a raised floor are thin
// faces too. The ROM only knows two floor groups (TilePairCollisionsLand: the light floor 0x05
// can't be stepped onto from the dark floors 0x20, 0x21 and 0x2a), and Mt Moon B2F has terraces
// that are all light floor, a rock face with stone steps between them. So the heights here come
// from reading the faces the way the picture means them:
//
// 1. Floor is every walkable tile but the stone steps. Floor tiles joined without crossing a
//    pair collision make one piece of floor.
// 2. Between two pieces met along a column or a row, the tiles in between say which is higher:
//    a rock face (0x10, 0x11, 0x28) or steps (0x15, 0x16) hangs below the higher one, so the
//    piece to the north is a level up; the shadowed top edge (0x29) runs along the north edge of
//    a raised floor, so the piece to the south is (a face then a top edge is two raised floors
//    one behind the other, which says nothing); a left face (0x31) has the raised floor east of
//    it, a right face (0x17) west of it; and light floor meeting dark floor head on is the higher.
// 3. Levels spread from the biggest piece (level 0) through those rules, the surest first; then
//    everything shifts so the lowest floor is level 0.
//
// Heights, in levels: a floor tile is its piece's level. Rock (cliff and rock labels) stands one
// level above the lowest floor near it, so a face between two floors is flush with the upper one,
// and a wall beside a floor stands one level above it. Steps climb across their face from the
// lower floor to the upper one. Anything else (ladders, signs, water, darkness) sits at the level
// of the floor near it.
// Only CAVERN is read this way: its tile IDs are in the rules.

const STEPS = new Set([0x15, 0x16]);
const SOUTH_FACE = new Set([0x10, 0x11, 0x28]);
const TOP_EDGE = 0x29;
const LEFT_FACE = 0x31;
const RIGHT_FACE = 0x17;
const LIGHT_FLOOR = 0x05;
/** Longest run of rock between two floors that still counts as one face between them. */
const MAX_RUN = 8;
/** How far rock looks for floor to stand on, in tiles. */
const SEARCH = 16;

const SOLID: ReadonlySet<number> = new Set((["cliff", "rock"] as Label[]).map((l) => LABELS.indexOf(l)));

export interface Terraces {
  /** Height per region tile, in levels (multiply by the level height), row-major. */
  levels: Float32Array;
  /** The highest floor level. */
  top: number;
}

/** Whether a region's maps are read as terraces (caves). */
export function hasTerraces(region: Region): boolean {
  return region.tileset.name === "CAVERN";
}

export function terraces(region: Region): Terraces {
  const w = region.widthTiles;
  const h = region.heightTiles;
  const n = w * h;
  const { tiles } = region;
  const walkable = new Set(region.tileset.semantics.walkable);
  const blocked = new Set<number>();
  for (const p of region.tileset.semantics.pairCollisions) {
    if (p.surfing) continue;
    blocked.add(p.tileA * 256 + p.tileB);
    blocked.add(p.tileB * 256 + p.tileA);
  }
  const isFloor = (i: number) => walkable.has(tiles[i]!) && !STEPS.has(tiles[i]!);

  // 1. Pieces of floor.
  const piece = new Int32Array(n).fill(-1);
  const sizes: number[] = [];
  for (let start = 0; start < n; start++) {
    if (piece[start] !== -1 || !isFloor(start)) continue;
    const id = sizes.length;
    let size = 0;
    const stack = [start];
    piece[start] = id;
    while (stack.length) {
      const i = stack.pop()!;
      size++;
      const x = i % w;
      for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, i - w, i + w]) {
        if (j < 0 || j >= n || piece[j] !== -1 || !isFloor(j)) continue;
        if (blocked.has(tiles[i]! * 256 + tiles[j]!)) continue;
        piece[j] = id;
        stack.push(j);
      }
    }
    sizes.push(size);
  }

  // 2. Rules between pieces: `hi` is a level above `lo`. Lower `rank` is surer.
  const found = new Map<string, { hi: number; lo: number; rank: number }>();
  const rule = (hi: number, lo: number, rank: number) => {
    if (hi !== lo) found.set(`${hi}>${lo}@${rank}`, { hi, lo, rank });
  };
  /** Walks the run of non-floor tiles from floor tile `i` along `step`; the floor beyond, and what the run held. */
  const across = (i: number, step: number, x: number, dx: number) => {
    const held = new Set<number>();
    let j = i + step;
    let jx = x + dx;
    for (let k = 0; k < MAX_RUN; k++, j += step, jx += dx) {
      if (j < 0 || j >= n || jx < 0 || jx >= w) return null;
      if (piece[j] !== -1) return k === 0 ? { far: j, held, direct: true } : { far: j, held, direct: false };
      held.add(tiles[j]!);
    }
    return null;
  };
  for (let i = 0; i < n; i++) {
    if (piece[i] === -1) continue;
    const x = i % w;
    // South: this piece is north of the run.
    const s = across(i, w, x, 0);
    if (s) {
      const north = piece[i]!;
      const south = piece[s.far]!;
      if (s.direct) directRule(tiles[i]!, tiles[s.far]!, north, south);
      else if ([...s.held].some((t) => STEPS.has(t))) rule(north, south, 0);
      else {
        const face = [...s.held].some((t) => SOUTH_FACE.has(t));
        // A face then a top edge: two raised floors drawn one behind the other, no floor between
        // them to say which is higher, so neither is.
        if (face && !s.held.has(TOP_EDGE)) rule(north, south, 1);
        else if (!face && s.held.has(TOP_EDGE)) rule(south, north, 3);
      }
    }
    // East: this piece is west of the run.
    const e = across(i, 1, x, 1);
    if (e) {
      const west = piece[i]!;
      const east = piece[e.far]!;
      if (e.direct) directRule(tiles[i]!, tiles[e.far]!, west, east);
      else if (e.held.has(LEFT_FACE) && !e.held.has(RIGHT_FACE)) rule(east, west, 2);
      else if (e.held.has(RIGHT_FACE) && !e.held.has(LEFT_FACE)) rule(west, east, 2);
    }
  }
  function directRule(a: number, b: number, pa: number, pb: number) {
    if (!blocked.has(a * 256 + b)) return;
    if (a === LIGHT_FLOOR) rule(pa, pb, 4);
    else if (b === LIGHT_FLOOR) rule(pb, pa, 4);
  }

  // 3. Spread the levels, surest rules first.
  const rules = [...found.values()].sort((a, b) => a.rank - b.rank);
  const level = new Array<number | undefined>(sizes.length).fill(undefined);
  const order = sizes.map((_, i) => i).sort((a, b) => sizes[b]! - sizes[a]!);
  for (const seed of order) {
    if (level[seed] !== undefined) continue;
    level[seed] = 0;
    for (let changed = true; changed; ) {
      changed = false;
      for (const r of rules) {
        const hi = level[r.hi];
        const lo = level[r.lo];
        if (hi !== undefined && lo === undefined) level[r.lo] = hi - 1;
        else if (lo !== undefined && hi === undefined) level[r.hi] = lo + 1;
        else continue;
        changed = true;
        break; // back to the surest rule
      }
    }
  }
  const min = Math.min(0, ...level.map((l) => l ?? 0));
  const pieceLevel = level.map((l) => (l ?? 0) - min);

  // Heights per tile.
  const levels = new Float32Array(n);
  // Distance (through non-floor tiles) to the nearest floor, and the lowest floor level within
  // two tiles of that distance.
  const dist = new Int32Array(n).fill(-1);
  const low = new Float32Array(n).fill(Infinity);
  let frontier: number[] = [];
  for (let i = 0; i < n; i++) {
    if (piece[i] === -1) continue;
    dist[i] = 0;
    low[i] = pieceLevel[piece[i]!]!;
    frontier.push(i);
  }
  // Breadth first, carrying every floor level reached within the slack.
  const seen = new Map<number, Map<number, number>>(); // tile → level → distance first reached
  for (const i of frontier) seen.set(i, new Map([[low[i]!, 0]]));
  for (let d = 1; d <= SEARCH && frontier.length; d++) {
    const next: number[] = [];
    for (const i of frontier) {
      const x = i % w;
      for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, i - w, i + w]) {
        if (j < 0 || j >= n || piece[j] !== -1) continue;
        let m = seen.get(j);
        if (!m) {
          m = new Map();
          seen.set(j, m);
          dist[j] = d;
        }
        let grew = false;
        for (const [lv, at] of seen.get(i)!) {
          if (at + 1 > dist[j]! + 2 || (m.get(lv) ?? Infinity) <= at + 1) continue;
          m.set(lv, at + 1);
          grew = true;
        }
        if (grew) next.push(j);
      }
    }
    frontier = [...new Set(next)];
  }
  for (const [i, m] of seen) {
    if (piece[i] !== -1) continue;
    low[i] = Math.min(...[...m].filter(([, at]) => at <= dist[i]! + 2).map(([lv]) => lv));
  }

  let top = 0;
  for (let i = 0; i < n; i++) {
    if (piece[i] !== -1) {
      levels[i] = pieceLevel[piece[i]!]!;
      top = Math.max(top, levels[i]!);
      continue;
    }
    const base = Number.isFinite(low[i]!) ? low[i]! : 0;
    if (STEPS.has(tiles[i]!)) {
      levels[i] = stepsLevel(i) ?? base;
    } else {
      levels[i] = SOLID.has(region.labels[i]!) ? base + 1 : base;
    }
  }
  /** Steps climb from the floor below their face to the floor above it, a tile at a time. */
  function stepsLevel(i: number): number | undefined {
    let up = i - w;
    let above = 1;
    while (up >= 0 && piece[up] === -1 && above <= MAX_RUN) {
      up -= w;
      above++;
    }
    let down = i + w;
    let below = 1;
    while (down < n && piece[down] === -1 && below <= MAX_RUN) {
      down += w;
      below++;
    }
    if (up < 0 || down >= n || piece[up] === -1 || piece[down] === -1) return undefined;
    const hi = pieceLevel[piece[up]!]!;
    const lo = pieceLevel[piece[down]!]!;
    return lo + ((hi - lo) * below) / (above + below);
  }
  return { levels, top };
}

/**
 * The floor height (in levels) under a player standing on step (sx, sy) of a map whose origin is
 * at region tile (rootX, rootY): the tile the game checks, the bottom-left of the step's four, or
 * on steps the middle of the two rows.
 */
export function stepLevel(t: Terraces, region: Pick<Region, "widthTiles" | "heightTiles" | "tiles">, rootX: number, rootY: number, sx: number, sy: number): number {
  const tx = rootX + sx * 2;
  const ty = rootY + sy * 2 + 1;
  if (tx < 0 || ty < 1 || tx >= region.widthTiles || ty >= region.heightTiles) return 0;
  const i = ty * region.widthTiles + tx;
  if (STEPS.has(region.tiles[i]!)) return (t.levels[i]! + t.levels[i - region.widthTiles]!) / 2;
  return t.levels[i]!;
}
