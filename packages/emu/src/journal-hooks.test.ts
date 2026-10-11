// ROM test for the play journal's hooks: from a new game, the Potion in the PC, the starter, the
// rival's battle, a friend's gift of Poké Balls and a catch on Route 1 all arrive as events, while
// the game plays as it always does. Skips without the dev ROM.
import { existsSync, readFileSync } from "node:fs";
import { MAP_NAMES, parseWorld, SYMBOLS, type WorldData } from "@pokehd/rom";
import { beforeAll, describe, expect, it } from "vitest";
import { Button, GameBoy } from "./core.ts";
import { GiftDesk } from "./gifts/desk.ts";
import { JournalHooks, journalHooks, type JournalEvent } from "./journal-hooks.ts";
import { playIntro } from "./testing.ts";

const ROM_PATH = new URL("../../../rom/pokeblue.gb", import.meta.url);
const WASM_PATH = new URL("./generated/sameboy.wasm", import.meta.url);
const hasRom = existsSync(ROM_PATH);

// constants/pokemon_constants.asm, item_constants.asm and trainer_constants.asm
const BULBASAUR = 0x99;
const SQUIRTLE = 0xb1;
const POKE_BALL = 0x04;
const POTION = 0x14;
const RIVAL1 = 0x19;
const map = (name: string) => MAP_NAMES.indexOf(name);

describe.skipIf(!hasRom)("JournalHooks on a new game", () => {
  let gb: GameBoy;
  let world: WorldData;
  const events: JournalEvent[] = [];
  const of = <T extends JournalEvent["type"]>(type: T) => events.filter((e): e is Extract<JournalEvent, { type: T }> => e.type === type);

  const read = (name: keyof typeof SYMBOLS) => gb.read(SYMBOLS[name].address);
  const where = () => [read("wCurMap"), read("wXCoord"), read("wYCoord")] as [number, number, number];
  const frame = (buttons = 0) => {
    gb.setButtons(buttons);
    gb.runFrame();
  };
  const mash = (i: number, button = Button.A) => frame(i % 8 < 2 ? button : 0);

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

  /** Steps along a shortest walkable path to (x, y) in the current map; stops if a battle starts. */
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

  beforeAll(async () => {
    const rom = new Uint8Array(readFileSync(ROM_PATH));
    world = parseWorld(rom);
    gb = await GameBoy.create({ rom, wasmBinary: readFileSync(WASM_PATH) });
    const desk = new GiftDesk(gb, { rom, emit: () => {} });
    new JournalHooks(gb, { rom, emit: (e) => events.push(e) });
    playIntro(gb);
    untilFree(10);
    // Red's room → downstairs → Pallet Town → the north edge, where Oak stops the player.
    walk(Button.Right, (_, x) => x === 5);
    walk(Button.Up, (_, __, y) => y === 1);
    walk(Button.Right, (m) => m === map("REDS_HOUSE_1F"));
    walk(Button.Down, (_, __, y) => y === 7);
    walk(Button.Left, (_, x) => x === 3);
    walk(Button.Down, (m) => m === map("PALLET_TOWN"));
    walk(Button.Right, (_, x) => x === 10);
    walk(Button.Up, () => read("hWY") < 144);
    untilFree(120);
    // Squirtle's ball is on the table at (7, 3): yes to Squirtle, no to a nickname.
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
    // The rival challenges the player on the way out; mash A through the battle.
    walk(Button.Left, (_, x) => x === 5);
    for (let i = 0; read("wIsInBattle") === 0; i++) {
      if (i > 3000) throw new Error("No battle");
      mash(i, i % 16 < 8 ? Button.A : Button.Down);
    }
    for (let i = 0; read("wIsInBattle") !== 0; i++) {
      if (i > 20_000) throw new Error("The battle never ended");
      mash(i);
    }
    untilFree(60);
    // A friend's gift: five Poké Balls through the overworld idle point (D20).
    desk.give("balls", { kind: "item", item: POKE_BALL, quantity: 5 });
    for (let i = 0; i < 600 && desk.pending > 0; i++) frame();
    // Out of the lab and north to Route 1's grass, then catch whatever jumps out: in battle,
    // Down then A opens the bag (ITEM) and A throws its only item, a Poké Ball.
    for (let i = 0; where()[0] !== map("PALLET_TOWN"); i++) {
      if (i > 3000) throw new Error(`Couldn't leave the lab, at ${where()}`);
      const [, x] = where();
      frame(x > 5 ? Button.Left : x < 4 ? Button.Right : Button.Down);
    }
    for (let i = 0; i < 120; i++) frame();
    untilFree(10);
    goTo(10, 0);
    walk(Button.Up, (m) => m === map("ROUTE_1"));
    for (let i = 0; i < 60; i++) frame();
    untilFree(10);
    const route1 = world.maps[map("ROUTE_1")]!;
    const tileset = world.tilesets[route1.tileset]!;
    const grass: [number, number][] = [];
    for (let y = 0; y < route1.heightBlocks * 2; y++) {
      for (let x = 0; x < route1.widthBlocks * 2; x++) {
        const block = route1.blocks[(y >> 1) * route1.widthBlocks + (x >> 1)]!;
        if (tileset.blocks[block * 16 + ((y & 1) * 2 + 1) * 4 + (x & 1) * 2] === tileset.semantics.grass) grass.push([x, y]);
      }
    }
    grass.sort((a, b) => b[1] - a[1] || a[0] - b[0]);
    for (let battles = 0; of("caught").length === 0; battles++) {
      if (battles > 6) throw new Error("Caught nothing");
      goTo(...grass[0]!);
      for (let i = 0; read("wIsInBattle") === 0; i++) {
        if (i > 400) throw new Error("No wild Pokémon");
        const [, x, y] = where();
        const next = grass.find(([cx, cy]) => Math.abs(cx - x) + Math.abs(cy - y) === 1);
        if (!next) throw new Error(`Lost the grass at ${where()}`);
        goTo(...next);
      }
      // No to a nickname.
      const pattern = [Button.Down, 0, 0, 0, Button.A, 0, 0, 0, Button.A, 0, 0, 0, Button.B];
      for (let i = 0; read("wIsInBattle") !== 0; i++) {
        if (i > 20_000) throw new Error("The wild battle never ended");
        frame(i % 8 < 2 ? (showsYes() ? Button.B : pattern[Math.floor(i / 8) % pattern.length]!) : 0);
      }
      untilFree(30);
    }
  }, 240_000);

  it("checks the routines it hooks against the ROM", () => {
    expect(() => journalHooks(new Uint8Array(readFileSync(ROM_PATH)))).not.toThrow();
    expect(() => journalHooks(new Uint8Array(0x100000))).toThrow(/isn't where expected/);
  });

  it("sees the Potion the game puts in the PC at the start", () => {
    expect(of("item-added")[0]).toMatchObject({ item: POTION, quantity: 1, inventory: "box", source: "given" });
  });

  it("sees the starter join the party", () => {
    expect(of("mon-added")).toContainEqual(expect.objectContaining({ species: SQUIRTLE, level: 5, into: "party", how: "starter", map: map("OAKS_LAB") }));
  });

  it("sees the rival's battle start, his Bulbasaur and how it ended", () => {
    const start = of("battle-start")[0]!;
    expect(start).toMatchObject({ kind: "trainer", trainerClass: RIVAL1, battleType: 0, map: map("OAKS_LAB") });
    expect(start.trainerNumber).toBeGreaterThan(0);
    const firstSeen = events.findIndex((e) => e.type === "enemy-seen");
    expect(events[firstSeen]).toMatchObject({ species: BULBASAUR, level: 5, kind: "trainer" });
    expect(firstSeen).toBeGreaterThan(events.indexOf(start));
    expect(of("battle-end")[0]).toMatchObject({ kind: "trainer", outcome: expect.stringMatching(/^(won|lost)$/), lead: SQUIRTLE });
  });

  it("tags a friend's gift as the page's", () => {
    expect(of("item-added")).toContainEqual(expect.objectContaining({ item: POKE_BALL, quantity: 5, inventory: "bag", source: "page" }));
  });

  it("sees a wild Pokémon, the ball thrown and the catch", () => {
    const caught = of("caught")[0]!;
    expect(caught).toMatchObject({ into: "party", map: map("ROUTE_1") });
    // Its battle: started wild with this species, seen once (the ball's reload isn't a sighting),
    // ended as a catch.
    const at = events.indexOf(caught);
    const start = events.slice(0, at).findLast((e) => e.type === "battle-start")!;
    expect(start).toMatchObject({ kind: "wild", species: caught.species, level: caught.level });
    const between = events.slice(events.indexOf(start), at);
    expect(between.filter((e) => e.type === "enemy-seen")).toEqual([expect.objectContaining({ species: caught.species, kind: "wild" })]);
    expect(events.slice(at).find((e) => e.type === "battle-end")).toMatchObject({ kind: "wild", outcome: "caught", result: 2 });
    expect(of("item-removed")).toContainEqual(expect.objectContaining({ item: POKE_BALL, quantity: 1, inventory: "bag", reason: "used" }));
    // The catch isn't counted again as a Pokémon from someone.
    expect(of("mon-added").filter((e) => e.species === caught.species && e.how !== "starter")).toEqual([]);
    expect(read("wPartyCount")).toBe(2);
  });
});
