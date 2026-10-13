// The player's view of the world as text: one character per step (16×16 px square) around them,
// only as far as the screen shows, built from the map data the ROM holds (walls, grass, water,
// doors) and the people standing about. Nothing hidden: no hidden items, nothing off screen.
import { localStep, globalStep, SPRITE_NAMES, type MapData, type StitchedWorld, type WorldData } from "@pokehd/rom";
import type { StateLite } from "./screen-read.ts";

/** How far the map reaches from the player, in steps; about what the portrait HD camera shows. */
export interface View {
  left: number;
  right: number;
  up: number;
  down: number;
}
export const DEFAULT_VIEW: View = { left: 4, right: 4, up: 5, down: 5 };

const LEGEND: Record<string, string> = {
  "@": "you",
  ".": "walkable",
  "#": "blocked",
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

function terrain(world: WorldData, map: MapData, x: number, y: number): string {
  const tileset = world.tilesets[map.tileset]!;
  const sem = tileset.semantics;
  const tile = tileAt(world, map, x, y);
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
  return ".";
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
  const people = new Map<string, string>();
  for (const n of state.npcs) {
    if (n.visible === false) continue;
    people.set(`${n.x},${n.y}`, n.pictureId === POKE_BALL ? "o" : n.pictureId === BOULDER ? "O" : "N");
  }
  const origin = stitched ? globalStep(stitched, map.id, 0, 0) : null;
  const rows: string[] = [];
  const used = new Set<string>();
  for (let dy = -view.up; dy <= view.down; dy++) {
    let row = "";
    for (let dx = -view.left; dx <= view.right; dx++) {
      const x = px + dx;
      const y = py + dy;
      let c: string;
      if (dx === 0 && dy === 0) c = "@";
      else if (people.has(`${x},${y}`)) c = people.get(`${x},${y}`)!;
      else {
        const inside = x >= 0 && y >= 0 && x < map.widthBlocks * 2 && y < map.heightBlocks * 2;
        const other = !inside && origin && stitched ? localStep(stitched, origin.x + x, origin.y + y) : null;
        const there = other ? world.maps[other.map] : null;
        // Off the map with no neighbour there: the edge of the world, which nobody walks past.
        c = other && there ? terrain(world, there, other.x, other.y) : inside ? terrain(world, map, x, y) : "#";
      }
      used.add(c);
      row += c;
    }
    rows.push(row);
  }
  const legend = Object.entries(LEGEND)
    .filter(([c]) => used.has(c))
    .map(([c, what]) => `${c} ${what}`)
    .join(", ");
  return `${rows.join("\n")}\nLegend: ${legend}. You face ${state.player.facing}; north is up.`;
}
