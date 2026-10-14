// The player's view of the world as text: one character per step (16×16 px square) around them,
// only as far as the screen shows, built from the map data the ROM holds (walls, grass, water,
// doors) and the people standing about. Nothing hidden: no hidden items, nothing off screen.
import { localStep, globalStep, SPRITE_NAMES, type MapData, type StitchedWorld, type Tileset, type WorldData } from "@pokehd/rom";
import type { StateLite } from "./screen-read.ts";

/** How far the map reaches from the player, in steps. */
export interface View {
  left: number;
  right: number;
  up: number;
  down: number;
}
/**
 * The Game Boy's own view: its 160×144 screen is 10 steps wide and 9 tall, with the player drawn
 * on the 5th column and 5th row (tiles 8–9 across and down), so 4 steps show to the left, 5 to the
 * right and 4 above and below. Always this window, centred as the Game Boy's camera is.
 */
export const DEFAULT_VIEW: View = { left: 4, right: 5, up: 4, down: 4 };

const LEGEND: Record<string, string> = {
  "@": "you",
  ".": "walkable",
  "#": "blocked",
  "^": "raised floor (no step straight between ^ and the lower floor, grass or water beside it; use stairs /)",
  "/": "stairs between floor heights",
  '"': "tall grass",
  "~": "water",
  D: "door/stairs/exit",
  N: "person",
  o: "ball on the ground",
  O: "boulder",
  S: "sign",
  v: "ledge (hop down)",
  "<": "ledge (hop left)",
  ">": "ledge (hop right)",
};
const WATER_TILE = 0x14;
const POKE_BALL = SPRITE_NAMES.indexOf("POKE_BALL");
const BOULDER = SPRITE_NAMES.indexOf("BOULDER");

/** The tile the game checks for a step (its lower-left 8×8 tile), or the border block's outside the map. */
function tileAt(world: WorldData, map: MapData, x: number, y: number): number {
  const tileset = world.tilesets[map.tileset]!;
  const inside = x >= 0 && y >= 0 && x < map.widthBlocks * 2 && y < map.heightBlocks * 2;
  const block = inside ? map.blocks[(y >> 1) * map.widthBlocks + (x >> 1)]! : map.borderBlock;
  return tileset.blocks[block * 16 + (((y & 1) * 2 + 1) * 4 + (x & 1) * 2)]!;
}

/**
 * The raised floor of a tileset whose floor has two heights: the one tile in every one of the ROM's
 * land pair collisions (TilePairCollisionsLand: CAVERN's light floor 0x05, the Safari Zone's 0x2e),
 * and the lower tiles it can't be stepped to or from directly. The game refuses a step between such
 * a pair (CheckForTilePairCollisions); the HD view shows the seam as a rock face.
 */
function heights(tileset: Tileset): { raised: number; lower: Set<number> } | null {
  const pairs = tileset.semantics.pairCollisions.filter((p) => !p.surfing);
  const first = pairs[0];
  if (!first) return null;
  const raised = [first.tileA, first.tileB].find((t) => pairs.every((p) => p.tileA === t || p.tileB === t));
  if (raised === undefined) return null;
  return { raised, lower: new Set(pairs.map((p) => (p.tileA === raised ? p.tileB : p.tileA))) };
}

function terrain(world: WorldData, map: MapData, x: number, y: number): string {
  const tileset = world.tilesets[map.tileset]!;
  const sem = tileset.semantics;
  const tile = tileAt(world, map, x, y);
  const levels = heights(tileset);
  const inside = x >= 0 && y >= 0 && x < map.widthBlocks * 2 && y < map.heightBlocks * 2;
  if (inside) {
    if (map.warps.some((w) => w.x === x && w.y === y)) return "D";
    if (map.signs.some((s) => s.x === x && s.y === y)) return "S";
  }
  if (sem.hasWater && tile === WATER_TILE) return "~";
  const ledge = sem.ledges.find((l) => l.ledge === tile);
  if (ledge) return ledge.facing === "down" ? "v" : ledge.facing === "left" ? "<" : ">";
  if (!sem.walkable.includes(tile)) return "#";
  if (sem.grass !== null && tile === sem.grass) return '"';
  if (levels) {
    if (tile === levels.raised) return "^";
    // Floor of neither height beside raised floor (stone steps, Safari Zone stairs) joins the two.
    const beside = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => tileAt(world, map, x + dx!, y + dy!) === levels.raised);
    if (!levels.lower.has(tile) && beside) return "/";
  }
  return ".";
}

/** Where people and balls stand, by cell: the symbol drawn there (both cells of someone mid-step). */
function peopleAt(state: StateLite): Map<string, string> {
  const people = new Map<string, string>();
  for (const n of state.npcs) {
    if (n.visible === false) continue;
    const c = n.pictureId === POKE_BALL ? "o" : n.pictureId === BOULDER ? "O" : "N";
    people.set(`${n.x},${n.y}`, c);
    const step = n.step as { dx?: number; dy?: number } | null;
    if (step && (step.dx || step.dy)) people.set(`${n.x + (step.dx ?? 0)},${n.y + (step.dy ?? 0)}`, c);
  }
  return people;
}

/** The terrain symbol at step (x, y) of `map`, across a connection outdoors; off the world it's "#". */
function cellAt(world: WorldData, stitched: StitchedWorld | null, map: MapData, x: number, y: number): string {
  const inside = x >= 0 && y >= 0 && x < map.widthBlocks * 2 && y < map.heightBlocks * 2;
  if (inside) return terrain(world, map, x, y);
  const origin = stitched ? globalStep(stitched, map.id, 0, 0) : null;
  const other = origin && stitched ? localStep(stitched, origin.x + x, origin.y + y) : null;
  const there = other ? world.maps[other.map] : null;
  // Off the map with no neighbour there: the edge of the world, which nobody walks past.
  return other && there ? terrain(world, there, other.x, other.y) : "#";
}

/**
 * The map around the player, `view` steps each way, with a legend of the symbols it uses and the
 * way the player faces. Outdoors, neighbouring maps across a connection show as the screen shows
 * them (`stitched` from `stitchOverworld`).
 */
export function buildTextMap(world: WorldData, stitched: StitchedWorld | null, state: StateLite, view: View = DEFAULT_VIEW): string {
  const map = world.maps[state.mapId];
  if (!map) return "(no map to show)";
  const { x: px, y: py } = state.player;
  const people = peopleAt(state);
  // Columns numbered across the top and rows down the side (last digit), from the window's
  // top-left, to line the map up with a screenshot.
  const rows: string[] = [`  ${Array.from({ length: view.left + view.right + 1 }, (_, i) => i % 10).join("")}`];
  const used = new Set<string>();
  for (let dy = -view.up; dy <= view.down; dy++) {
    let row = `${(dy + view.up) % 10} `;
    for (let dx = -view.left; dx <= view.right; dx++) {
      const x = px + dx;
      const y = py + dy;
      const c = dx === 0 && dy === 0 ? "@" : (people.get(`${x},${y}`) ?? cellAt(world, stitched, map, x, y));
      used.add(c);
      row += c;
    }
    rows.push(row);
  }
  const legend = Object.entries(LEGEND)
    .filter(([c]) => used.has(c))
    .map(([c, what]) => `${c} ${what}`)
    .join(", ");
  return `${rows.join("\n")}\nLegend: ${legend}. You're at column ${view.left}, row ${view.up}, facing ${state.player.facing}; north is up.`;
}

const BLOCKERS: Record<string, string> = {
  "#": "a wall",
  N: "someone",
  O: "a boulder",
  o: "an item ball",
  S: "a sign",
  "~": "water",
};
const LEDGE_HOPS: Record<string, [number, number]> = { v: [0, 1], "<": [-1, 0], ">": [1, 0] };

/**
 * What's in the way one step `dir` from the player, as the text map shows it ("a wall",
 * "someone", "a drop between floor heights"), or null when that step looks open (then whatever
 * stopped them isn't on the map: someone who has since walked off, say).
 */
export function blockerAt(world: WorldData, stitched: StitchedWorld | null, state: StateLite, dir: { dx: number; dy: number }): string | null {
  const map = world.maps[state.mapId];
  if (!map) return null;
  const x = state.player.x + dir.dx;
  const y = state.player.y + dir.dy;
  const there = peopleAt(state).get(`${x},${y}`) ?? cellAt(world, stitched, map, x, y);
  const blocker = BLOCKERS[there];
  if (blocker) return blocker;
  // A ledge only lets you hop the way it faces.
  const hop = LEDGE_HOPS[there];
  if (hop && (hop[0] !== dir.dx || hop[1] !== dir.dy)) return "a ledge";
  // The game refuses a step straight between raised floor and the lower floor (pair collisions).
  const here = cellAt(world, stitched, map, state.player.x, state.player.y);
  if ((here === "^") !== (there === "^") && ![here, there].some((c) => c === "/" || c === "D")) return "a drop between floor heights (use the stairs /)";
  return null;
}
