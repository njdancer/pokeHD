// Plays the game from power-on into battles and saves an emulator state at the start of each, for
// the battle dev page (/dev/battle) and look comparisons: `node tools/record-battles.ts`. States
// hold game RAM, so they go to rom/fixtures/ (gitignored) like the ROM itself.
//   battle-rival.state  the first rival battle in Oak's lab (trainer, indoors)
//   battle-wild.state   a wild Pokémon in Route 1's grass (outdoors)
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { Button, GameBoy } from "../packages/emu/src/core.ts";
import { playIntro } from "../packages/emu/src/testing.ts";
import { MAP_NAMES, parseWorld, SYMBOLS } from "../packages/rom/src/index.ts";

const ROM = readFileSync(new URL("../rom/pokeblue.gb", import.meta.url));
const OUT = new URL("../rom/fixtures/", import.meta.url);
const map = (name: string) => MAP_NAMES.indexOf(name);
const PALLET_TOWN = map("PALLET_TOWN");
const ROUTE_1 = map("ROUTE_1");
const REDS_HOUSE_1F = map("REDS_HOUSE_1F");
const OAKS_LAB = map("OAKS_LAB");

const gb = await GameBoy.create({
  rom: ROM,
  wasmBinary: readFileSync(new URL("../packages/emu/src/generated/sameboy.wasm", import.meta.url)),
});
const world = parseWorld(ROM);
const read = (name: keyof typeof SYMBOLS) => gb.read(SYMBOLS[name].address);
const where = () => [read("wCurMap"), read("wXCoord"), read("wYCoord")] as [number, number, number];
const frame = (buttons = 0) => {
  gb.setButtons(buttons);
  gb.runFrame();
};
const mash = (i: number, button = Button.A) => frame(i % 8 < 2 ? button : 0);
const save = (name: string) => {
  mkdirSync(OUT, { recursive: true });
  writeFileSync(new URL(name, OUT), gb.saveState());
  console.log(`saved ${name} at ${where()}`);
};

function walk(button: number, done: (map: number, x: number, y: number) => boolean): void {
  for (let i = 0; !(done(...where()) && read("wWalkCounter") === 0); i++) {
    if (i > 1200) throw new Error(`Stuck at ${where()}`);
    frame(button);
  }
  frame();
  frame();
}

function untilFree(frames = 60, limit = 20_000): void {
  const free = () => read("hWY") >= 144 && read("wJoyIgnore") === 0 && read("wWalkCounter") === 0;
  for (let i = 0, run = 0; run < frames; i++) {
    if (i > limit) throw new Error(`Never free at ${where()}`);
    frame(run === 0 && i % 8 < 2 ? Button.A : 0);
    run = free() ? run + 1 : 0;
  }
}

function showsYes(): boolean {
  const tiles = gb.readBytes(SYMBOLS.wTileMap.address, 20 * 18);
  return tiles.some((t, i) => t === 0x98 && tiles[i + 1] === 0x84 && tiles[i + 2] === 0x92);
}

/** Mashes A until the battle is over and the player can move again. */
function finishBattle(): void {
  for (let i = 0; read("wIsInBattle") !== 0; i++) {
    if (i > 20_000) throw new Error("The battle never ended");
    mash(i);
  }
  untilFree(60);
}

/** Steps along a shortest walkable path to (x, y) in the current map. */
function goTo(x: number, y: number): void {
  const [id] = where();
  const m = world.maps[id]!;
  const tileset = world.tilesets[m.tileset]!;
  const w = m.widthBlocks * 2;
  const h = m.heightBlocks * 2;
  const walkable = (cx: number, cy: number) => {
    if (cx < 0 || cy < 0 || cx >= w || cy >= h) return false;
    if (m.warps.some((warp) => warp.x === cx && warp.y === cy)) return false;
    const block = m.blocks[(cy >> 1) * m.widthBlocks + (cx >> 1)]!;
    return tileset.semantics.walkable.includes(tileset.blocks[block * 16 + ((cy & 1) * 2 + 1) * 4 + (cx & 1) * 2]!);
  };
  const start = where();
  const key = (cx: number, cy: number) => cy * w + cx;
  const came = new Map<number, number>([[key(start[1], start[2]), -1]]);
  const queue: [number, number][] = [[start[1], start[2]]];
  while (queue.length) {
    const [cx, cy] = queue.shift()!;
    for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]] as const) {
      const n: [number, number] = [cx + dx, cy + dy];
      if (!walkable(...n) || came.has(key(...n))) continue;
      came.set(key(...n), key(cx, cy));
      queue.push(n);
    }
  }
  if (!came.has(key(x, y))) throw new Error(`No path to ${x},${y} from ${start}`);
  const path: number[] = [];
  for (let k = key(x, y); k !== -1; k = came.get(k)!) path.unshift(k);
  for (let i = 1; i < path.length; i++) {
    const [px, py] = [path[i - 1]! % w, Math.floor(path[i - 1]! / w)];
    const [nx, ny] = [path[i]! % w, Math.floor(path[i]! / w)];
    const button = nx > px ? Button.Right : nx < px ? Button.Left : ny > py ? Button.Down : Button.Up;
    walk(button, (_, cx, cy) => (cx === nx && cy === ny) || read("wIsInBattle") !== 0);
    if (read("wIsInBattle") !== 0) return;
  }
}

playIntro(gb);
untilFree(10);
walk(Button.Right, (_, x) => x === 5);
walk(Button.Up, (_, __, y) => y === 1);
walk(Button.Right, (m) => m === REDS_HOUSE_1F);
walk(Button.Down, (_, __, y) => y === 7);
walk(Button.Left, (_, x) => x === 3);
walk(Button.Down, (m) => m === PALLET_TOWN);
walk(Button.Right, (_, x) => x === 10);
walk(Button.Up, () => read("hWY") < 144);
untilFree(120);
if (where()[0] !== OAKS_LAB) throw new Error(`Expected Oak's lab, at ${where()}`);
walk(Button.Down, (_, __, y) => y === 4);
walk(Button.Right, (_, x) => x === 7);
for (let i = 0; i < 8; i++) frame(Button.Up);
for (let i = 0, answers = 0; answers < 2; i++) {
  if (i > 3000) throw new Error("No yes/no prompt");
  if (!showsYes()) {
    mash(i);
    continue;
  }
  for (let f = 0; f < 10; f++) frame();
  for (let f = 0; f < 2; f++) frame(answers === 0 ? Button.A : Button.B);
  for (let f = 0; f < 30; f++) frame();
  answers++;
}
untilFree(120);
walk(Button.Left, (_, x) => x === 5);
// The rival stops the player on the way out; save as the battle begins.
for (let i = 0; read("wIsInBattle") === 0; i++) {
  if (i > 3000) throw new Error("No battle");
  mash(i, i % 16 < 8 ? Button.A : Button.Down);
}
save("battle-rival.state");
finishBattle();

// Out of the lab and north to Route 1's first patch of grass, then pace in it until something
// jumps out.
for (let i = 0; where()[0] !== PALLET_TOWN; i++) {
  if (i > 3000) throw new Error(`Couldn't leave the lab, at ${where()}`);
  const [, x] = where();
  frame(x > 5 ? Button.Left : x < 4 ? Button.Right : Button.Down);
}
for (let i = 0; i < 120; i++) frame();
untilFree(10);
goTo(10, 0);
walk(Button.Up, (m) => m === ROUTE_1);
for (let i = 0; i < 60; i++) frame();
untilFree(10);
const route1 = world.maps[ROUTE_1]!;
const grassTile = world.tilesets[route1.tileset]!.semantics.grass;
const grass: [number, number][] = [];
for (let y = 0; y < route1.heightBlocks * 2; y++) {
  for (let x = 0; x < route1.widthBlocks * 2; x++) {
    const block = route1.blocks[(y >> 1) * route1.widthBlocks + (x >> 1)]!;
    if (world.tilesets[route1.tileset]!.blocks[block * 16 + ((y & 1) * 2 + 1) * 4 + (x & 1) * 2] === grassTile) grass.push([x, y]);
  }
}
// The patch nearest the south entrance.
grass.sort((a, b) => b[1] - a[1] || a[0] - b[0]);
const [gx, gy] = grass[0]!;
goTo(gx, gy);
for (let i = 0; read("wIsInBattle") === 0; i++) {
  if (i > 200) throw new Error("No wild Pokémon");
  const [, x, y] = where();
  const next = grass.find(([cx, cy]) => Math.abs(cx - x) + Math.abs(cy - y) === 1);
  if (!next) throw new Error(`Lost the grass at ${where()}`);
  goTo(...next);
}
save("battle-wild.state");
