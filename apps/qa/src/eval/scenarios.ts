// Movement scenarios from the ROM: a real map, a start, and a goal the game's own collision lets
// the player reach, with the shortest route (par) found by breadth-first search over the map's
// tiles and checked by walking it in the emulator. Short goals sit inside the starting text map
// (10×9 steps) and are named by its column and row, the way the player meets them in play
// ("the door at column 6, row 1"); multi-turn goals are off screen, given as steps north/south and
// east/west from the start, so the player has to read the map and keep count across turns.
// Nothing here is game data to keep: scenarios are map IDs and coordinates, regenerated from the
// ROM by seed, and written only under apps/qa/runs/ (gitignored).
import { MAP_NAMES, TILESET_NAMES, type MapData, type Tileset, type WorldData } from "@pokehd/rom";
import type { StateLite } from "../game/screen-read.ts";
import { DEFAULT_VIEW } from "../game/textmap.ts";
import type { Direction, Move } from "../game/types.ts";
import { DIRS } from "../game/walk.ts";
import type { Place, Sim } from "./sim.ts";

export type Area = "outdoor" | "indoor" | "cave";
export type Kind = "short" | "multi" | "marathon";
export type Feature = "straight" | "turn" | "detour" | "ledge" | "heights" | "door" | "people";

export interface Scenario {
  id: string;
  kind: Kind;
  area: Area;
  map: number;
  mapName: string;
  start: Place;
  /** Where an indoor map's exits lead (wLastMap). */
  lastMap?: number;
  goal:
    | { type: "cell"; x: number; y: number }
    | { type: "warp"; x: number; y: number; toMap: number }
    /** Anywhere on a map within these bounds (a marathon's far side). */
    | { type: "region"; map: number; xMin?: number; xMax?: number; yMin?: number; yMax?: number };
  /** What the player is told. */
  text: string;
  /** Shortest route as arrows, checked in the emulator, and its length in joystick steps. */
  route: string;
  par: number;
  /** Turns a perfect player needs: 1 for a short goal; for a multi-turn goal, one per screen or so. */
  parTurns: number;
  features: Feature[];
  /** Most turns the player gets. */
  turnCap: number;
  /** Event flags set first (EVENT_* numbers): the route's trainers already beaten, as a player passing through would have them. */
  events?: number[];
}

const OUTDOOR = new Set(["OVERWORLD", "PLATEAU", "FOREST"]);
export function areaOf(map: MapData): Area {
  const name = TILESET_NAMES[map.tileset]!;
  return OUTDOOR.has(name) ? "outdoor" : name === "CAVERN" ? "cave" : "indoor";
}

const ARROW: Record<Direction, string> = { up: "↑", down: "↓", left: "←", right: "→" };
const ORDER: Direction[] = ["up", "down", "left", "right"];
const WATER_TILE = 0x14;

/** A seeded PRNG (mulberry32), so a seed always gives the same set. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function tileAt(world: WorldData, map: MapData, x: number, y: number): number {
  const tileset = world.tilesets[map.tileset]!;
  const inside = x >= 0 && y >= 0 && x < map.widthBlocks * 2 && y < map.heightBlocks * 2;
  const block = inside ? map.blocks[(y >> 1) * map.widthBlocks + (x >> 1)]! : map.borderBlock;
  return tileset.blocks[block * 16 + (((y & 1) * 2 + 1) * 4 + (x & 1) * 2)]!;
}

function pairBlocked(tileset: Tileset, a: number, b: number): boolean {
  return tileset.semantics.pairCollisions.some((p) => !p.surfing && ((p.tileA === a && p.tileB === b) || (p.tileA === b && p.tileB === a)));
}

interface Graph {
  w: number;
  h: number;
  /** Shortest arrows from the start to each cell (null where unreachable). */
  dist: Int32Array;
  prev: Int32Array;
  prevDir: Int8Array;
  /** Cells reached by a ledge hop on the way. */
  hop: Uint8Array;
}

/**
 * Breadth-first search from the player over steps the game allows: walkable tiles, no step across
 * a pair collision (cave floor heights), ledges hopped only the way they face (one arrow, two
 * cells), no water, no one standing in the way, and warps only as an end (stepping on one leaves).
 */
function search(world: WorldData, map: MapData, state: StateLite, avoid: Set<number>): Graph {
  const tileset = world.tilesets[map.tileset]!;
  const sem = tileset.semantics;
  const w = map.widthBlocks * 2;
  const h = map.heightBlocks * 2;
  const dist = new Int32Array(w * h).fill(-1);
  const prev = new Int32Array(w * h).fill(-1);
  const prevDir = new Int8Array(w * h).fill(-1);
  const hop = new Uint8Array(w * h);
  const warps = new Set(map.warps.map((wp) => wp.y * w + wp.x));
  const floor = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= w || y >= h) return false;
    const t = tileAt(world, map, x, y);
    return sem.walkable.includes(t) && !(sem.hasWater && t === WATER_TILE) && !avoid.has(y * w + x);
  };
  const start = state.player.y * w + state.player.x;
  dist[start] = 0;
  const queue = [start];
  for (let qi = 0; qi < queue.length; qi++) {
    const i = queue[qi]!;
    if (warps.has(i) && i !== start) continue;
    const x = i % w;
    const y = Math.floor(i / w);
    const here = tileAt(world, map, x, y);
    ORDER.forEach((dir, di) => {
      const { dx, dy } = DIRS[dir];
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) return;
      const ahead = tileAt(world, map, nx, ny);
      let to = -1;
      const ledge = sem.ledges.find((l) => l.ledge === ahead && l.standingOn === here && l.facing === dir);
      if (ledge) {
        if (floor(nx + dx, ny + dy)) to = (ny + dy) * w + nx + dx;
      } else if (floor(nx, ny) && !pairBlocked(tileset, here, ahead)) {
        to = ny * w + nx;
      }
      if (to < 0 || dist[to] !== -1) return;
      dist[to] = dist[i]! + 1;
      prev[to] = i;
      prevDir[to] = di;
      if (ledge) hop[to] = 1;
      queue.push(to);
    });
  }
  return { w, h, dist, prev, prevDir, hop };
}

function routeTo(g: Graph, target: number): { dirs: Direction[]; cells: number[]; hops: number } {
  const dirs: Direction[] = [];
  const cells: number[] = [];
  let hops = 0;
  for (let i = target; g.prev[i] !== -1; i = g.prev[i]!) {
    // A ledge hop covers two cells, and the joystick counts it as two steps (walk.ts counts cells).
    for (let k = 0; k <= g.hop[i]!; k++) dirs.push(ORDER[g.prevDir[i]!]!);
    cells.push(i);
    hops += g.hop[i]!;
  }
  return { dirs: dirs.reverse(), cells: cells.reverse(), hops };
}

export function toMoves(dirs: readonly Direction[]): Move[] {
  const moves: Move[] = [];
  for (const d of dirs) {
    const last = moves.at(-1);
    if (last?.direction === d) last.tiles++;
    else moves.push({ direction: d, tiles: 1 });
  }
  return moves;
}

/** For an indoor map: the outdoor map whose warps lead into it (directly or through other indoor maps). */
export function outsideOf(world: WorldData, mapId: number): number | undefined {
  const seen = new Set<number>([mapId]);
  let frontier = [mapId];
  for (let depth = 0; depth < 6 && frontier.length; depth++) {
    const next: number[] = [];
    for (const m of world.maps) {
      if (!m || seen.has(m.id)) continue;
      if (!m.warps.some((wp) => typeof wp.to === "number" && frontier.includes(wp.to))) continue;
      if (areaOf(m) === "outdoor") return m.id;
      seen.add(m.id);
      next.push(m.id);
    }
    frontier = next;
  }
  return undefined;
}

const compass = (dx: number, dy: number) =>
  [dy ? `${Math.abs(dy)} step${Math.abs(dy) === 1 ? "" : "s"} ${dy < 0 ? "north" : "south"}` : "", dx ? `${Math.abs(dx)} step${Math.abs(dx) === 1 ? "" : "s"} ${dx < 0 ? "west" : "east"}` : ""]
    .filter(Boolean)
    .join(" and ");

export interface GenerateOptions {
  seed: number;
  /** How many of each kind and area to make. */
  quota: Record<Kind, Record<Area, number>>;
  prefix: string;
}

interface Candidate {
  scenario: Omit<Scenario, "route" | "par" | "parTurns">;
  dirs: Direction[];
}

/**
 * Makes scenarios: a random map of the area, a random start the player can stand on, then a goal
 * picked from what the search reaches, favouring goals that need a turn, a detour, a ledge or a
 * change of floor height. Each is walked in the emulator by its route (one joystick turn per 40
 * steps); only those that arrive exactly, with nothing interrupting, are kept.
 */
export async function generate(sim: Sim, opts: GenerateOptions, log: (s: string) => void = () => {}): Promise<Scenario[]> {
  const world = sim.rom.world;
  const random = rng(opts.seed);
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(random() * xs.length)]!;
  const maps = world.maps.filter((m): m is MapData => !!m && MAP_NAMES[m.id] !== undefined && m.warps.length > 0);
  const out: Scenario[] = [];
  const featureCount = new Map<Feature, number>();
  for (const kind of ["short", "multi"] as Kind[]) {
    for (const area of ["outdoor", "indoor", "cave"] as Area[]) {
      const want = opts.quota[kind][area];
      // Multi-turn goals need room: maps at least two screens across one way.
      const pool = maps.filter((m) => areaOf(m) === area && (kind === "short" || m.widthBlocks * 2 >= 20 || m.heightBlocks * 2 >= 18));
      let made = 0;
      for (let attempt = 0; made < want && attempt < want * 60; attempt++) {
        const map = pick(pool);
        const c = candidate(sim, map, kind, area, random, featureCount);
        if (!c) continue;
        const checked = check(sim, c);
        if (!checked) continue;
        const id = `${opts.prefix}-${kind}-${area}-${String(made + 1).padStart(2, "0")}`;
        const scenario = { ...checked, id };
        for (const f of scenario.features) featureCount.set(f, (featureCount.get(f) ?? 0) + 1);
        out.push(scenario);
        made++;
        log(`${id}: ${scenario.mapName} par ${scenario.par} [${scenario.features.join(", ")}] ${scenario.text}`);
      }
      if (made < want) log(`only ${made} of ${want} ${kind} ${area}`);
    }
  }
  return out;
}

function candidate(sim: Sim, map: MapData, kind: Kind, area: Area, random: () => number, featureCount: Map<Feature, number>): Candidate | null {
  const world = sim.rom.world;
  const w = map.widthBlocks * 2;
  const h = map.heightBlocks * 2;
  const tileset = world.tilesets[map.tileset]!;
  const sem = tileset.semantics;
  const lastMap = area === "outdoor" ? undefined : outsideOf(world, map.id);
  // Goals of a kind the set needs: doors about a quarter of the time, ledges outdoors and floor
  // heights in caves when the start offers them; otherwise any, weighted toward rarer features.
  const roll = random();
  const want: Feature | null = roll < 0.25 ? "door" : roll < 0.6 && area === "outdoor" ? "ledge" : roll < 0.6 && area === "cave" ? "heights" : null;
  // For a ledge, start a few steps on the high side of one.
  const ledges: { x: number; y: number; dx: number; dy: number }[] = [];
  if (want === "ledge") {
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const l = sem.ledges.find((e) => e.ledge === tileAt(world, map, x, y));
        if (l) ledges.push({ x, y, ...DIRS[l.facing] });
      }
  }
  // A start: walkable, not a warp, not water.
  let sx = 0;
  let sy = 0;
  for (let i = 0; ; i++) {
    if (i > 200) return null;
    const near = ledges.length ? ledges[Math.floor(random() * ledges.length)]! : null;
    sx = near ? near.x - near.dx * (1 + Math.floor(random() * 4)) + (near.dx ? 0 : Math.floor(random() * 9) - 4) : Math.floor(random() * w);
    sy = near ? near.y - near.dy * (1 + Math.floor(random() * 4)) + (near.dy ? 0 : Math.floor(random() * 9) - 4) : Math.floor(random() * h);
    if (sx < 0 || sy < 0 || sx >= w || sy >= h) continue;
    const t = tileAt(world, map, sx, sy);
    if (sem.walkable.includes(t) && !(sem.hasWater && t === WATER_TILE) && !map.warps.some((wp) => wp.x === sx && wp.y === sy)) break;
  }
  const facing = (["down", "up", "left", "right"] as const)[Math.floor(random() * 4)]!;
  const start: Place = { map: map.id, x: sx, y: sy, facing };
  const state = sim.teleport(start, lastMap);
  if (state.mapId !== map.id || state.player.x !== sx || state.player.y !== sy || state.mode !== "overworld") return null;
  // People block their cell; anyone who wanders blocks the cells around them too, so routes keep clear.
  const avoid = new Set<number>();
  const wanderers: { x: number; y: number }[] = [];
  for (const n of state.npcs) {
    if (n.visible === false) continue;
    avoid.add(n.y * w + n.x);
    const spec = map.npcs[(n.slot ?? 0) - 1];
    if (spec?.movement.kind === "walk") {
      wanderers.push({ x: n.x, y: n.y });
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) avoid.add((n.y + dy) * w + n.x + dx);
    }
  }
  const g = search(world, map, state, avoid);
  const view = DEFAULT_VIEW;
  const inView = (x: number, y: number) => x - sx >= -view.left && x - sx <= view.right && y - sy >= -view.up && y - sy <= view.down;
  const warpAt = new Map(map.warps.map((wp) => [wp.y * w + wp.x, wp]));
  type Option = { cell: number; warp: boolean; dirs: Direction[]; features: Feature[]; weight: number };
  const options: Option[] = [];
  for (let cell = 0; cell < w * h; cell++) {
    const d = g.dist[cell]!;
    if (d <= 0) continue;
    const x = cell % w;
    const y = Math.floor(cell / w);
    const warp = warpAt.get(cell);
    const visible = inView(x, y);
    if (kind === "short" ? !visible || d < 2 || d > 30 : visible || d < 12 || d > 60) continue;
    if (warp && (warp.to === "last" ? lastMap === undefined : !world.maps[warp.to])) continue;
    const route = routeTo(g, cell);
    const features: Feature[] = [];
    const turns = toMoves(route.dirs).length - 1;
    const manhattan = Math.abs(x - sx) + Math.abs(y - sy);
    features.push(turns === 0 ? "straight" : "turn");
    if (route.dirs.length > manhattan) features.push("detour");
    if (route.hops) features.push("ledge");
    const levels = new Set(route.cells.map((i) => tileAt(world, map, i % w, Math.floor(i / w))));
    if (sem.pairCollisions.some((p) => !p.surfing && levels.has(p.tileA)) && sem.pairCollisions.some((p) => !p.surfing && [...levels].some((t) => t !== p.tileA && p.tileB === t))) features.push("heights");
    if (warp) features.push("door");
    if (wanderers.some((n) => route.cells.some((i) => Math.abs((i % w) - n.x) + Math.abs(Math.floor(i / w) - n.y) <= 4))) features.push("people");
    // Rarer features weigh more, and the ones the set has least of so far.
    const rare = (f: Feature) => 1 / (1 + (featureCount.get(f) ?? 0));
    const weight = 1 + features.reduce((s, f) => s + (f === "straight" ? 0.3 : f === "turn" ? 0.5 : 3) * rare(f) * 4, 0);
    options.push({ cell, warp: !!warp, dirs: route.dirs, features, weight });
  }
  if (!options.length) return null;
  const pool = want && options.some((o) => o.features.includes(want)) ? options.filter((o) => o.features.includes(want)) : options;
  let r = random() * pool.reduce((s, o) => s + o.weight, 0);
  const choice = pool.find((o) => (r -= o.weight) <= 0) ?? pool.at(-1)!;
  const gx = choice.cell % w;
  const gy = Math.floor(choice.cell / w);
  const warp = warpAt.get(choice.cell);
  const toMap = warp ? (warp.to === "last" ? lastMap! : warp.to) : -1;
  const col = gx - sx + view.left;
  const row = gy - sy + view.up;
  const exitWord = area === "outdoor" ? "door" : "exit";
  let text: string;
  if (kind === "short") {
    text = warp ? `Go through the ${exitWord} (D) at column ${col}, row ${row} of your text map.` : `Walk to the spot at column ${col}, row ${row} of your text map.`;
  } else {
    const where = compass(gx - sx, gy - sy);
    text = warp
      ? `Go through the ${exitWord} that's ${where} of where you're standing now. It's off your text map to start with, so keep track of where you are as you go.`
      : `Walk to the spot ${where} of where you're standing now. It's off your text map to start with, so keep track of where you are as you go.`;
  }
  const scenario: Candidate["scenario"] = {
    id: "",
    kind,
    area,
    map: map.id,
    mapName: MAP_NAMES[map.id]!,
    start,
    ...(lastMap !== undefined && { lastMap }),
    goal: warp ? { type: "warp", x: gx, y: gy, toMap } : { type: "cell", x: gx, y: gy },
    text,
    features: choice.features,
    turnCap: kind === "short" ? 6 : Math.max(12, Math.ceil(choice.dirs.length / 4)),
  };
  return { scenario, dirs: choice.dirs };
}

/** Whether a place meets the scenario's goal. */
export function reached(s: Pick<Scenario, "goal">, state: StateLite): boolean {
  if (s.goal.type === "warp") return state.mapId === s.goal.toMap;
  if (s.goal.type === "region") return inRegion(s.goal, state.mapId, state.player.x, state.player.y);
  return state.player.x === s.goal.x && state.player.y === s.goal.y && state.mode === "overworld";
}

/**
 * Walks the route in the emulator, 40 steps a turn, as a perfect player would. A warp that only
 * fires on a push off the map's edge (indoor exit mats) gets that extra arrow. Returns the
 * scenario with its checked route and par, or null if the walk doesn't arrive cleanly.
 */
function check(sim: Sim, c: Candidate): Omit<Scenario, "id"> | null {
  const s = c.scenario;
  const attempt = (dirs: Direction[]): boolean => {
    sim.teleport(s.start, s.lastMap);
    for (let i = 0; i < dirs.length; i += 40) {
      const r = sim.joystick(toMoves(dirs.slice(i, i + 40)));
      if (r.textSeen) return false;
      if (s.goal.type === "warp") {
        if (reached(s, sim.state())) return i + 40 >= dirs.length;
        if (r.stop && r.stop !== "map") return false;
      } else if (r.stop || r.walked < Math.min(40, dirs.length - i)) {
        return false;
      }
    }
    return reached(s, sim.state());
  };
  let dirs = c.dirs;
  let ok = attempt(dirs);
  if (!ok && s.goal.type === "warp") {
    for (const extra of [dirs.at(-1)!, ...ORDER]) {
      if (attempt([...dirs, extra])) {
        dirs = [...dirs, extra];
        ok = true;
        break;
      }
    }
  }
  if (!ok) return null;
  const par = dirs.length;
  return { ...s, route: toMoves(dirs).map((m) => ARROW[m.direction].repeat(m.tiles)).join(""), par, parTurns: s.kind === "short" ? 1 : Math.max(2, Math.ceil(par / 10)) };
}

type Region = Extract<Scenario["goal"], { type: "region" }>;
function inRegion(g: Region, map: number, x: number, y: number): boolean {
  return map === g.map && x >= (g.xMin ?? -Infinity) && x <= (g.xMax ?? Infinity) && y >= (g.yMin ?? -Infinity) && y <= (g.yMax ?? Infinity);
}

/**
 * The shortest route in steps across maps: a search on each map from where the player stands or
 * lands, and every warp it reaches leading on to the warp it's paired with (one more step for an
 * exit mat, which needs a push). Nobody in the way, so it's a floor on what a player needs.
 */
export function parAcross(world: WorldData, start: Place, lastMap: number, goal: Region): number | null {
  type Node = { map: number; x: number; y: number; cost: number; last: number };
  const best = new Map<string, number>();
  const queue: Node[] = [{ map: start.map, x: start.x, y: start.y, cost: 0, last: lastMap }];
  let answer: number | null = null;
  while (queue.length) {
    queue.sort((a, b) => a.cost - b.cost);
    const n = queue.shift()!;
    if (answer !== null && n.cost >= answer) break;
    const key = `${n.map},${n.x},${n.y}`;
    if ((best.get(key) ?? Infinity) <= n.cost) continue;
    best.set(key, n.cost);
    const map = world.maps[n.map];
    if (!map) continue;
    const state: StateLite = { mode: "overworld", mapId: n.map, fade: 0, player: { x: n.x, y: n.y, facing: "down", step: null }, npcs: [] };
    const g = search(world, map, state, new Set());
    const sem = world.tilesets[map.tileset]!.semantics;
    for (let cell = 0; cell < g.w * g.h; cell++) {
      const d = g.dist[cell]!;
      if (d < 0) continue;
      const x = cell % g.w;
      const y = Math.floor(cell / g.w);
      if (inRegion(goal, n.map, x, y)) answer = Math.min(answer ?? Infinity, n.cost + d);
    }
    map.warps.forEach((w) => {
      const d = g.dist[w.y * g.w + w.x]!;
      if (d < 0 || (d === 0 && n.cost > 0)) return;
      const to = w.to === "last" ? n.last : w.to;
      const there = world.maps[to];
      const landing = there?.warps[w.toWarp];
      if (!there || !landing) return;
      const tile = tileAt(world, map, w.x, w.y);
      const push = sem.doors.includes(tile) || sem.warps.includes(tile) ? 0 : 1;
      // wLastMap follows only the game's "outside" maps (CheckIfInOutsideMap: OVERWORLD, PLATEAU).
      const outdoors = ["OVERWORLD", "PLATEAU"].includes(TILESET_NAMES[map.tileset]!);
      queue.push({ map: to, x: landing.x, y: landing.y, cost: n.cost + d + push, last: outdoors ? n.map : n.last });
    });
  }
  return answer;
}

/** Long routes through a whole dungeon, from outside one side to outside the other. */
export function marathons(world: WorldData): Scenario[] {
  const id = (name: string) => MAP_NAMES.indexOf(name);
  // EVENT_BEAT_* flags (constants/event_constants.asm): every trainer on the way already beaten,
  // so nobody stops the walk (battles are off in the eval, and a trainer's challenge would loop).
  const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
  const specs: { id: string; area: Area; start: Place; lastMap: number; goal: Region; text: string; turnCap: number; events: number[] }[] = [
    {
      id: "marathon-mt-moon",
      area: "cave",
      start: { map: id("ROUTE_4"), x: 16, y: 8, facing: "up" },
      lastMap: id("ROUTE_4"),
      goal: { type: "region", map: id("ROUTE_4"), xMin: 24 },
      text: "Get through Mt Moon to the far side: in at its entrance (the D 3 steps north and 2 steps east of you), through the cave's floors, and out of its other exit onto Route 4 east of the mountain, toward Cerulean City. Keep track of where you've been as you go.",
      turnCap: 120,
      // MT_MOON_1_TRAINER_0–6, MT_MOON_EXIT_SUPER_NERD, MT_MOON_3_TRAINER_0–3.
      events: [...range(0x571, 0x577), ...range(0x579, 0x57d)],
    },
    {
      id: "marathon-viridian-forest",
      area: "outdoor",
      start: { map: id("ROUTE_2"), x: 3, y: 46, facing: "up" },
      lastMap: id("ROUTE_2"),
      goal: { type: "region", map: id("ROUTE_2"), yMax: 11 },
      text: "Get through Viridian Forest to the north: in at the gate just north of you, through the forest, and out of the north gate onto Route 2 beyond it, toward Pewter City. Keep track of where you've been as you go.",
      turnCap: 80,
      // VIRIDIAN_FOREST_TRAINER_0–2.
      events: range(0x562, 0x564),
    },
  ];
  return specs.map((m) => {
    const par = parAcross(world, m.start, m.lastMap, m.goal) ?? 0;
    return {
      id: m.id,
      kind: "marathon",
      area: m.area,
      map: m.start.map,
      mapName: MAP_NAMES[m.start.map]!,
      start: m.start,
      lastMap: m.lastMap,
      goal: m.goal,
      text: m.text,
      route: "",
      par,
      parTurns: Math.max(4, Math.ceil(par / 10)),
      features: ["turn", "detour", "door"],
      turnCap: m.turnCap,
      events: m.events,
    };
  });
}
