import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { parseWorld, SYMBOLS, type WorldData } from "@pokehd/rom";
import { beforeAll, describe, expect, it } from "vitest";
import { Button, GameBoy } from "../core.ts";
import { playIntro } from "../testing.ts";
import { decodeOverworldState, fadeLevel, OverworldDecoder } from "./decode.ts";
import { OVERWORLD_WATCHES, type OverworldState, type OverworldWatched } from "./overworld.ts";

const ROM_PATH = new URL("../../../../rom/pokeblue.gb", import.meta.url);
const WASM_PATH = new URL("../generated/sameboy.wasm", import.meta.url);
const hasRom = existsSync(ROM_PATH);

/** Zeroed watch buffers, with the window hidden and normal palettes. */
function blank(): OverworldWatched {
  const watched = {} as OverworldWatched;
  for (const [name, [, length]] of Object.entries(OVERWORLD_WATCHES)) {
    watched[name as keyof OverworldWatched] = new Uint8Array(length);
  }
  watched.windowY[0] = 144;
  watched.palettes.set([0xe4, 0xd0, 0xe0]);
  watched.toggleableList[0] = 0xff;
  return watched;
}

describe("decodeOverworldState", () => {
  it("reads the game's fade palettes as a fade level", () => {
    // home/fade.asm FadePal1..8, rBGP column.
    const bgps = [0xff, 0xfe, 0xf9, 0xe4, 0xe4, 0x90, 0x40, 0x00];
    expect(bgps.map(fadeLevel)).toEqual([1, 2 / 3, 1 / 3, 0, 0, -1 / 3, -2 / 3, -1]);
  });

  it("reports the player mid-step from the cell being left", () => {
    const w = blank();
    w.coords.set([5, 3]); // wYCoord, wXCoord
    w.walkCounter[0] = 6;
    w.sprites1[3] = 0xff; // Y step vector -1
    w.sprites1[9] = 0x04; // facing up
    const { player } = decodeOverworldState(w);
    expect(player).toMatchObject({ x: 3, y: 5, facing: "up", step: { dx: 0, dy: -1, progress: 0.25 } });
  });

  it("reports NPCs mid-step from the cell being left, though the game has moved them on", () => {
    const w = blank();
    w.numSprites[0] = 2;
    const s = 0x20; // slot 2
    w.sprites1.set([0x05, 3], s); // picture ID, moving
    w.sprites1[s + 5] = 1; // X step vector
    w.sprites1[s + 9] = 0x0c; // facing right
    w.sprites2[s] = 12; // walk animation counter
    w.sprites2.set([4 + 7, 4 + 9], s + 4); // map Y, X (already the destination)
    const [npc, ...rest] = decodeOverworldState(w).npcs;
    expect(rest).toEqual([]);
    expect(npc).toMatchObject({ slot: 2, pictureId: 5, x: 8, y: 7, facing: "right", visible: true });
    expect(npc?.step).toEqual({ dx: 1, dy: 0, progress: 0.25 });
  });

  it("hides toggled-off objects", () => {
    const w = blank();
    w.numSprites[0] = 1;
    w.sprites1[0x10] = 0x05;
    w.toggleableList.set([1, 10, 0xff]);
    expect(decodeOverworldState(w).npcs[0]?.visible).toBe(true);
    w.toggleableFlags[1] = 1 << 2; // object index 10
    expect(decodeOverworldState(w).npcs[0]?.visible).toBe(false);
  });

  it("tells battle, dialog and overworld apart", () => {
    const w = blank();
    expect(decodeOverworldState(w).mode).toBe("overworld");
    w.windowY[0] = 0;
    expect(decodeOverworldState(w).mode).toBe("dialog");
    w.inBattle[0] = 1;
    expect(decodeOverworldState(w).mode).toBe("battle");
  });
});

describe("OverworldDecoder", () => {
  const frame = (map: number, warpedFrom: number, bgp = 0xe4, header = [0, 9, 10]) => {
    const w = blank();
    w.map[0] = map;
    w.warpedFrom[0] = warpedFrom;
    w.palettes[0] = bgp;
    w.mapHeader.set(header);
    return w;
  };

  it("holds a warp's new map ID until the screen is black", () => {
    const d = new OverworldDecoder();
    expect(d.decode(frame(0x25, 0x26)).mapId).toBe(0x25);
    expect(d.decode(frame(0, 0x25)).mapId).toBe(0x25);
    expect(d.decode(frame(0, 0x25, 0xf9)).mapId).toBe(0x25);
    expect(d.decode(frame(0, 0x25, 0xff)).mapId).toBe(0);
  });

  it("switches at once on a connection", () => {
    const d = new OverworldDecoder();
    d.decode(frame(0, 0x25));
    expect(d.decode(frame(0x0c, 0x25)).mapId).toBe(0x0c);
  });
});

/** Runs frames through the decoder, keeping every state for assertions and recording. */
class Driver {
  readonly states: OverworldState[] = [];
  readonly #decoder = new OverworldDecoder();
  /** Zeroes wGrassRate before every frame, so the player (who has no Pokémon) meets none. */
  noEncounters = false;

  readonly gb: GameBoy;

  constructor(gb: GameBoy) {
    this.gb = gb;
  }

  get state(): OverworldState {
    return this.states.at(-1)!;
  }

  frame(buttons = 0): OverworldState {
    if (this.noEncounters) this.gb.write(SYMBOLS.wGrassRate.address, 0);
    this.gb.setButtons(buttons);
    this.gb.runFrame();
    const watched = {} as OverworldWatched;
    for (const [name, [address, length]] of Object.entries(OVERWORLD_WATCHES)) {
      watched[name as keyof OverworldWatched] = this.gb.readBytes(address, length);
    }
    const state = this.#decoder.decode(watched);
    this.states.push(state);
    return state;
  }

  /** Holds `button` until `done` holds for the state, then lets go and waits for a standstill. */
  until(button: number, done: (s: OverworldState) => boolean, limit = 600): OverworldState[] {
    const start = this.states.length;
    for (let i = 0; !done(this.frame(button)); i++) {
      if (i > limit) throw new Error(`Stuck at ${JSON.stringify(this.state.player)} on map ${this.state.mapId}`);
    }
    this.settle();
    return this.states.slice(start);
  }

  walk(button: number, axis: "x" | "y", target: number): OverworldState[] {
    return this.until(button, (s) => s.player[axis] === target && s.player.step === null);
  }

  /** Waits until the player stands still on the overworld with the screen at full brightness. */
  settle(): void {
    for (let i = 0; i < 4 || this.state.player.step || this.state.fade !== 0 || this.state.mode !== "overworld"; i++) {
      if (i > 600) throw new Error("Never settled");
      this.frame();
    }
  }
}

const DIRECTIONS = [
  { button: Button.Up, dx: 0, dy: -1 },
  { button: Button.Down, dx: 0, dy: 1 },
  { button: Button.Left, dx: -1, dy: 0 },
  { button: Button.Right, dx: 1, dy: 0 },
] as const;

/**
 * Buttons for the shortest walk between two cells of a map, over walkable tiles (tall grass
 * included, ledges not). A cell's collision is its bottom-left tile, as in the game.
 */
function route(world: WorldData, mapId: number, from: [number, number], to: [number, number]): number[] {
  const map = world.maps[mapId]!;
  const tileset = world.tilesets[map.tileset]!;
  const width = map.widthBlocks * 2;
  const height = map.heightBlocks * 2;
  const walkable = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return false;
    const block = map.blocks[(y >> 1) * map.widthBlocks + (x >> 1)]!;
    return tileset.semantics.walkable.includes(tileset.blocks[block * 16 + ((y & 1) * 2 + 1) * 4 + (x & 1) * 2]!);
  };
  const key = (x: number, y: number) => y * width + x;
  const came = new Map<number, { prev: number; button: number }>([[key(...from), { prev: -1, button: 0 }]]);
  const queue = [from];
  while (queue.length) {
    const [x, y] = queue.shift()!;
    if (x === to[0] && y === to[1]) break;
    for (const { button, dx, dy } of DIRECTIONS) {
      const next: [number, number] = [x + dx, y + dy];
      if (!walkable(...next) || came.has(key(...next))) continue;
      came.set(key(...next), { prev: key(x, y), button });
      queue.push(next);
    }
  }
  const buttons: number[] = [];
  for (let k = key(...to); came.get(k)?.prev !== -1; k = came.get(k)!.prev) {
    if (!came.has(k)) throw new Error(`No route on map ${mapId} to ${to}`);
    buttons.unshift(came.get(k)!.button);
  }
  return buttons;
}

const REDS_HOUSE_2F = 0x26;
const REDS_HOUSE_1F = 0x25;
const PALLET_TOWN = 0x00;
const ROUTE_1 = 0x0c;
const VIRIDIAN_CITY = 0x01;
const SPRITE_OAK = 0x03;
/** EVENT_FOLLOWED_OAK_INTO_LAB is bit 0 of wEventFlags. */
const EVENT_FOLLOWED_OAK_INTO_LAB = { address: SYMBOLS.wEventFlags.address, bit: 0 };

const where = (s: OverworldState) => [s.mapId, s.player.x, s.player.y];

describe.skipIf(!hasRom)("decoding a walk from Red's room to Viridian City", () => {
  let gb: GameBoy;
  let drive: Driver;

  beforeAll(async () => {
    gb = await GameBoy.create({ rom: readFileSync(ROM_PATH), wasmBinary: readFileSync(WASM_PATH) });
    playIntro(gb);
    drive = new Driver(gb);
    drive.settle();
  }, 60_000);

  it("starts in Red's room facing up", () => {
    expect(where(drive.state)).toEqual([REDS_HOUSE_2F, 3, 6]);
    expect(drive.state).toMatchObject({ mode: "overworld", fade: 0, npcs: [] });
    expect(drive.state.player).toMatchObject({ facing: "up", step: null, transport: "walk" });
  });

  it("decodes each step as a smooth move from one cell to the next", () => {
    const states = drive.walk(Button.Right, "x", 5);
    expect(where(drive.state)).toEqual([REDS_HOUSE_2F, 5, 6]);
    expect(drive.state.player.facing).toBe("right");
    // The drawn position never goes backwards and never jumps by more than a quarter cell.
    const drawn = states.map(({ player: p }) => p.x + (p.step ? p.step.dx * p.step.progress : 0));
    for (let i = 1; i < drawn.length; i++) {
      expect(drawn[i]! - drawn[i - 1]!).toBeGreaterThanOrEqual(0);
      expect(drawn[i]! - drawn[i - 1]!).toBeLessThanOrEqual(0.25);
    }
    const progress = states.flatMap(({ player: p }) => (p.step ? [p.step.progress] : []));
    expect(new Set(progress)).toEqual(new Set([1, 2, 3, 4, 5, 6, 7].map((n) => n / 8)));
    expect(new Set(states.map((s) => s.player.animFrame)).size).toBeGreaterThan(1);
  });

  it("goes downstairs behind a fade to black", () => {
    drive.walk(Button.Up, "y", 1);
    const states = drive.until(Button.Right, (s) => s.mapId === REDS_HOUSE_1F);
    const before = drive.states.slice(0, -states.length);
    // The map ID changes only once the screen is black, never while the old room is visible.
    const all = [...before.slice(-1), ...states];
    const switchAt = all.findIndex((s) => s.mapId === REDS_HOUSE_1F);
    expect(all[switchAt]!.fade).toBe(1);
    expect(all.slice(0, switchAt).map((s) => s.fade)).toContain(2 / 3);
    expect(where(drive.state)).toEqual([REDS_HOUSE_1F, 7, 1]);
    expect(drive.state.npcs).toEqual([
      expect.objectContaining({ slot: 1, x: 5, y: 4, facing: "left", visible: true, step: null }),
    ]);
  });

  it("walks out of the front door into Pallet Town", () => {
    drive.walk(Button.Down, "y", 7);
    drive.walk(Button.Left, "x", 3);
    const states = drive.until(Button.Down, (s) => s.mapId === PALLET_TOWN);
    expect(states.map((s) => s.fade)).toContain(1);
    expect(where(drive.state)).toEqual([PALLET_TOWN, 5, 6]);
  });

  it("decodes NPCs walking about, and Oak hidden until he appears", () => {
    const oak = (s: OverworldState) => s.npcs.find((n) => n.pictureId === SPRITE_OAK);
    expect(oak(drive.state)).toMatchObject({ visible: false });
    // Wander about for a while so the town's NPCs take some steps.
    for (let i = 0; i < 300; i++) drive.frame();
    const walking = drive.states.slice(-300).flatMap((s) => s.npcs.filter((n) => n.step));
    expect(walking.length).toBeGreaterThan(0);
    for (const n of walking) expect(n.step!.progress * 16).toSatisfy(Number.isInteger);

    const beforeOak = gb.saveState();
    const recorded = drive.states.length;
    drive.walk(Button.Right, "x", 10);
    drive.until(Button.Up, (s) => s.mode === "dialog");
    expect(where(drive.state)).toEqual([PALLET_TOWN, 10, 1]);
    for (let i = 0; i < 120 && !oak(drive.state)?.visible; i++) drive.frame(i % 8 < 2 ? Button.A : 0);
    expect(oak(drive.state)).toMatchObject({ visible: true });
    // Rewind, keeping the recording continuous.
    gb.loadState(beforeOak);
    drive.states.length = recorded;
  });

  it("crosses the connection north to Route 1 without a fade", () => {
    // Skip Oak stopping the player: the test isn't about his script.
    const { address, bit } = EVENT_FOLLOWED_OAK_INTO_LAB;
    gb.write(address, gb.read(address) | (1 << bit));
    drive.settle();
    drive.walk(Button.Right, "x", 10);
    const states = drive.until(Button.Up, (s) => s.mapId === ROUTE_1);
    expect(states.every((s) => s.fade === 0)).toBe(true);
    const [map, x, y] = where(drive.state);
    expect([map, x]).toEqual([ROUTE_1, 10]);
    expect(y).toBeGreaterThanOrEqual(34); // Route 1 is 18 blocks (36 cells) tall
  });

  it("walks Route 1 into Viridian City", () => {
    const world = parseWorld(readFileSync(ROM_PATH));
    drive.noEncounters = true;
    const { x, y } = drive.state.player;
    for (const button of route(world, ROUTE_1, [x, y], [10, 0])) {
      const [, px, py] = where(drive.state);
      drive.until(button, (s) => s.player.step === null && (s.player.x !== px || s.player.y !== py));
    }
    // Viridian City sits 5 blocks left of Route 1, so x shifts by 10 cells.
    drive.until(Button.Up, (s) => s.mapId === VIRIDIAN_CITY);
    expect(drive.states.slice(-60).every((s) => s.fade === 0)).toBe(true);
    expect(where(drive.state)).toEqual([VIRIDIAN_CITY, 20, 35]);
    drive.walk(Button.Up, "y", 28);
    expect(where(drive.state)).toEqual([VIRIDIAN_CITY, 20, 28]);
    expect(drive.state.npcs.length).toBeGreaterThan(0);

    // POKEHD_RECORD_STATE=path writes the whole walk as JSON, one state per frame, for building
    // the live world renderer without an emulator (p1-state-render).
    const out = process.env["POKEHD_RECORD_STATE"];
    if (out) writeFileSync(out, JSON.stringify(drive.states));
  });
});
