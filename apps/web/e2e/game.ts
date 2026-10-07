// Scripted play of the real game page for the e2e play-throughs: reads the decoded state the
// page exposes with ?stats and drives the keyboard. Needs the ROM at rom/pokeblue.gb.
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test, type Page, type PlaywrightTestOptions, type PlaywrightWorkerOptions } from "@playwright/test";
import { parseWorld, type WorldData } from "@pokehd/rom";

const ROM_PATH = fileURLToPath(new URL("../../../rom/pokeblue.gb", import.meta.url));

export const REDS_HOUSE_2F = 0x26;
export const REDS_HOUSE_1F = 0x25;
export const PALLET_TOWN = 0x00;
export const OAKS_LAB = 0x28;
export const ROUTE_1 = 0x0c;
export const VIRIDIAN_CITY = 0x01;
export const MAP_NAMES: Record<number, string> = {
  [REDS_HOUSE_2F]: "Red's room",
  [REDS_HOUSE_1F]: "Red's house",
  [PALLET_TOWN]: "Pallet Town",
  [OAKS_LAB]: "Oak's lab",
  [ROUTE_1]: "Route 1",
  [VIRIDIAN_CITY]: "Viridian City",
};
/** Oak's lab's object slots 2–4 are the three starters' Poké Balls. */
export const BALL_SLOTS = [2, 3, 4];

export interface Actor { x: number; y: number; step: unknown; visible?: boolean; slot?: number }
export interface State { mapId: number; mode: "overworld" | "dialog" | "battle"; fade: number; player: Actor; npcs: Actor[] }

/** What the game page exposes with ?stats (see src/client/game/Game.tsx). */
export type Hooked = Window & { __pokehd?: { state: State | null; inWorld: boolean } };

export type Dir = "ArrowUp" | "ArrowDown" | "ArrowLeft" | "ArrowRight";
export const DIRS: { key: Dir; dx: number; dy: number }[] = [
  { key: "ArrowUp", dx: 0, dy: -1 },
  { key: "ArrowDown", dx: 0, dy: 1 },
  { key: "ArrowLeft", dx: -1, dy: 0 },
  { key: "ArrowRight", dx: 1, dy: 0 },
];

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Shortest walk between two cells over walkable tiles (ignoring NPCs), as direction keys. */
export function route(world: WorldData, mapId: number, from: [number, number], to: [number, number]): Dir[] | null {
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
  const came = new Map<number, { prev: number; dir: Dir }>([[key(...from), { prev: -1, dir: "ArrowUp" }]]);
  const queue = [from];
  while (queue.length) {
    const [x, y] = queue.shift()!;
    if (x === to[0] && y === to[1]) break;
    for (const { key: dir, dx, dy } of DIRS) {
      const next: [number, number] = [x + dx, y + dy];
      if (!walkable(...next) || came.has(key(...next))) continue;
      came.set(key(...next), { prev: key(x, y), dir });
      queue.push(next);
    }
  }
  if (!came.has(key(...to))) return null;
  const dirs: Dir[] = [];
  for (let k = key(...to); came.get(k)!.prev !== -1; k = came.get(k)!.prev) dirs.unshift(came.get(k)!.dir);
  return dirs;
}

export class Player {
  readonly page: Page;
  readonly world: WorldData;
  readonly samples: { map: number; fps: number; worstMs: number; cpuMs: number }[] = [];
  readonly log: string[] = [];
  #seenMaps = new Set<number>();

  constructor(page: Page, world: WorldData) {
    this.page = page;
    this.world = world;
  }

  state(): Promise<State> {
    return this.page.evaluate(() => {
      const s = (window as Hooked).__pokehd?.state;
      return s ? JSON.parse(JSON.stringify(s)) : null;
    }) as Promise<State>;
  }

  async tap(key: string, ms = 50): Promise<void> {
    await this.page.keyboard.down(key);
    await sleep(ms);
    await this.page.keyboard.up(key);
  }

  /** Samples the page's frame-rate readout, and screenshots each map the first time it's seen. */
  async observe(s: State): Promise<void> {
    const el = this.page.getByTestId("stats");
    const fps = Number(await el.getAttribute("data-fps"));
    const text = (await el.textContent()) ?? "";
    const worstMs = Number(/worst ([\d.]+)/.exec(text)?.[1] ?? NaN);
    const cpuMs = Number(/cpu ([\d.]+)/.exec(text)?.[1] ?? NaN);
    if (s.mode === "overworld" && s.fade === 0) this.samples.push({ map: s.mapId, fps, worstMs, cpuMs });
    if (!this.#seenMaps.has(s.mapId) && s.mode === "overworld" && s.fade === 0 && !s.player.step) {
      this.#seenMaps.add(s.mapId);
      this.log.push(`${new Date().toISOString()} entered ${MAP_NAMES[s.mapId] ?? s.mapId}: ${text.replace(/\n/g, " | ")}`);
      await this.page.screenshot({ path: test.info().outputPath(`map-${s.mapId.toString(16)}.png`) });
    }
  }

  /** Presses `key` repeatedly while the game isn't on the overworld (A in battle, `key` otherwise). */
  async clearDialogs(key = "x", settleMs = 1200): Promise<State> {
    let calmSince = Date.now();
    for (;;) {
      const s = await this.state();
      if (s.mode === "overworld" && s.fade === 0) {
        if (Date.now() - calmSince > settleMs) return s;
        await sleep(100);
        continue;
      }
      calmSince = Date.now();
      await this.tap(s.mode === "battle" ? "z" : key);
      await sleep(80);
    }
  }

  /** Takes one step with `dir`. Returns false if the game didn't move the player. */
  async step(dir: Dir): Promise<boolean> {
    const before = await this.state();
    await this.page.keyboard.down(dir);
    let moved = false;
    for (let i = 0; i < 40; i++) {
      const s = await this.state();
      if (s.player.step || s.player.x !== before.player.x || s.player.y !== before.player.y || s.mapId !== before.mapId) {
        moved = true;
        break;
      }
      if (s.mode !== "overworld") break;
      await sleep(10);
    }
    await this.page.keyboard.up(dir);
    for (let i = 0; i < 100; i++) {
      const s = await this.state();
      if (!s.player.step) break;
      await sleep(10);
    }
    return moved;
  }

  /** Walks to a cell of `mapId`, dealing with battles and text on the way. */
  async walkTo(mapId: number, to: [number, number]): Promise<State> {
    let stuck = 0;
    for (;;) {
      let s = await this.state();
      if (s.mode !== "overworld" || s.fade !== 0) s = await this.clearDialogs();
      await this.observe(s);
      if (s.mapId !== mapId) throw new Error(`Expected map ${mapId}, on ${s.mapId} at (${s.player.x}, ${s.player.y})`);
      if (s.player.x === to[0] && s.player.y === to[1]) return s;
      const dirs = route(this.world, mapId, [s.player.x, s.player.y], to);
      if (!dirs) throw new Error(`No route on map ${mapId} from (${s.player.x}, ${s.player.y}) to ${to}`);
      // A step that doesn't happen is an NPC in the way (or a turn on the spot): try again, then sidestep.
      if (await this.step(dirs[0]!)) stuck = 0;
      else if (++stuck > 3) {
        await this.step(DIRS[Math.floor(Math.random() * 4)]!.key);
        stuck = 0;
      }
    }
  }

  /** Holds `dir` until the map changes (a door, stairs or a connection). */
  async leave(dir: Dir, expected: number): Promise<State> {
    const start = Date.now();
    for (;;) {
      const s = await this.state();
      if (s.mapId === expected) {
        const settled = await this.clearDialogs();
        await this.observe(settled);
        return settled;
      }
      if (Date.now() - start > 30_000) throw new Error(`Never reached map ${expected}; on ${s.mapId}`);
      if (s.mode === "battle" || s.mode === "dialog") await this.clearDialogs();
      else await this.step(dir);
    }
  }

  /** Title screen and the new-game intro: mash A, with Down now and then to pick the default names. */
  async playIntro(): Promise<State> {
    for (let tick = 0; ; tick++) {
      const s = await this.state();
      const inWorld = await this.page.evaluate(() => (window as Hooked).__pokehd?.inWorld);
      if (inWorld && s.mapId === REDS_HOUSE_2F && s.mode === "overworld" && s.fade === 0) break;
      await this.tap(tick % 64 === 63 ? "Enter" : tick % 8 === 7 ? "ArrowDown" : "z", 33);
      await sleep(100);
    }
    return this.clearDialogs();
  }
}

export const hasRom = existsSync(ROM_PATH);
export const loadWorld = () => parseWorld(new Uint8Array(readFileSync(ROM_PATH)));

/** Browser options for scripted play, from POKEHD_PLAY_HEADED, _VIDEO and _NO_GPU. */
export const PLAY_USE: Partial<PlaywrightTestOptions & PlaywrightWorkerOptions> = {
  viewport: { width: 1600, height: 900 },
  // POKEHD_PLAY_VIDEO=1 records the run (it costs some frame rate, so not for perf numbers).
  video: process.env["POKEHD_PLAY_VIDEO"] ? { mode: "on", size: { width: 1600, height: 900 } } : "off",
  launchOptions: {
    headless: !process.env["POKEHD_PLAY_HEADED"],
    // POKEHD_PLAY_NO_GPU=1: no renderer at all (the page falls back to the Game Boy screen), for
    // checking the script where only a slow software renderer exists.
    args: process.env["POKEHD_PLAY_NO_GPU"] ? ["--disable-gpu", "--disable-software-rasterizer"] : ["--enable-unsafe-webgpu"],
  },
};

