// walkPath against the real game: the ROM in the emulator, decoded as the page decodes it, with
// the page's view of it slowed down (it sees the game only every few frames, and a move of the
// thumb reaches the emulator a few frames late), walking Mt Moon's floors, ladders and heights.
import { existsSync, readFileSync } from "node:fs";
import { Button, GameBoy, OVERWORLD_WATCHES, OverworldDecoder, type OverworldState, type OverworldWatched } from "@pokehd/emu";
import { parseWorld, SYMBOLS, type WorldData } from "@pokehd/rom";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { StateLite } from "./screen-read.ts";
import { blockerAt } from "./textmap.ts";
import { countSteps, DIRS, stallFrames, walkPath, type PathResult } from "./walk.ts";
import type { Direction } from "./types.ts";

const ROM_PATH = new URL("../../../../rom/pokeblue.gb", import.meta.url);
const WASM_PATH = new URL("../../../../packages/emu/src/generated/sameboy.wasm", import.meta.url);
/** wWarpEntries and wNumberOfWarps (ram/wram.asm): Y, X, warp ID (from 0), map ID per warp. */
const W_WARP_ENTRIES = 0xd3af;

class Game {
  readonly gb: GameBoy;
  readonly #decoder = new OverworldDecoder();
  state!: OverworldState;
  frames = 0;
  #queue: { at: number; mask: number }[] = [];
  #mask = 0;

  constructor(gb: GameBoy) {
    this.gb = gb;
  }

  /** The pad as the emulator will see it `latency` frames from now. */
  hold(mask: number, latency: number) {
    this.#queue.push({ at: this.frames + latency, mask });
  }

  frame(): OverworldState {
    this.frames++;
    while (this.#queue[0] && this.#queue[0].at <= this.frames) this.#mask = this.#queue.shift()!.mask;
    this.gb.write(SYMBOLS.wGrassRate.address, 0); // no wild battles in the way
    this.gb.setButtons(this.#mask);
    this.gb.runFrame();
    const watched = {} as OverworldWatched;
    for (const [name, [address, length]] of Object.entries(OVERWORLD_WATCHES)) watched[name as keyof OverworldWatched] = this.gb.readBytes(address, length);
    return (this.state = this.#decoder.decode(watched));
  }

  run(n: number) {
    for (let i = 0; i < n; i++) this.frame();
  }

  /** Holds `pad` until `done`, then lets go and lets the game come to rest. */
  until(pad: number, done: (s: OverworldState) => boolean) {
    this.hold(pad, 0);
    for (let i = 0; !done(this.frame()); i++) if (i > 2000) throw new Error(`stuck at ${JSON.stringify(this.state.player)}`);
    this.hold(0, 0);
    this.run(90);
  }
}

/** The page around the game, busy: it sees the state only every `burst` frames; the thumb lands `latency` frames late. */
function walker(game: Game, burst: number, latency: number) {
  const centre = { x: 100, y: 100 };
  const listeners: ((e: { target: unknown; pointerId: number }) => void)[] = [];
  const stick = {
    contains: () => true,
    dispatchEvent(e: { type: string; clientX: number; clientY: number }) {
      const dx = Math.sign(e.clientX - centre.x);
      const dy = Math.sign(e.clientY - centre.y);
      const mask = e.type === "pointerup" ? 0 : dx > 0 ? Button.Right : dx < 0 ? Button.Left : dy > 0 ? Button.Down : dy < 0 ? Button.Up : 0;
      game.hold(mask, latency);
      return true;
    },
  };
  vi.stubGlobal("document", { querySelector: () => stick, addEventListener: (_: string, fn: (typeof listeners)[number]) => listeners.push(fn) });
  vi.stubGlobal(
    "PointerEvent",
    class {
      readonly type: string;
      constructor(type: string, init: object) {
        this.type = type;
        Object.assign(this, init);
      }
    },
  );
  vi.stubGlobal("__pokehd", {
    get state() {
      game.run(burst);
      return game.state;
    },
    get frames() {
      return game.frames;
    },
  });
  return async (legs: { direction: Direction; steps: number }[]) => {
    delete (globalThis as { __qaStickArmed?: boolean }).__qaStickArmed;
    const start = game.state;
    expect(walkPath({ legs: legs.map((l) => ({ ...DIRS[l.direction], steps: l.steps })), centre, reach: 40, stall: stallFrames(8), idleMs: 5000 })).toBe(true);
    for (const fn of listeners) fn({ target: stick, pointerId: 3 }); // the touch on the stick's centre
    const result = await (globalThis as typeof globalThis & { __qaWalk: Promise<PathResult> }).__qaWalk;
    game.hold(0, latency * 2); // and its end
    game.run(120);
    return { result, start, end: game.state, steps: countSteps([start, ...result.trail, game.state]) };
  };
}

describe.skipIf(!existsSync(ROM_PATH))("walkPath in Mt Moon, on a busy page", () => {
  let game: Game;
  let world: WorldData;
  const id = (name: string) => world.maps.findIndex((m) => m?.name === name);
  const open = (s: StateLite, direction: Direction, n: number) => {
    const { dx, dy } = DIRS[direction];
    for (let i = 0; i < n; i++) {
      const here = { ...s, player: { ...s.player, x: s.player.x + dx * i, y: s.player.y + dy * i, step: null } };
      if (blockerAt(world, null, here, { dx, dy })) return false;
      const m = world.maps[s.mapId]!;
      if (m.warps.some((w) => w.x === here.player.x + dx && w.y === here.player.y + dy)) return false;
    }
    return true;
  };

  beforeAll(async () => {
    const rom = new Uint8Array(readFileSync(ROM_PATH));
    world = parseWorld(rom);
    const gb = await GameBoy.create({ rom, wasmBinary: readFileSync(WASM_PATH) });
    game = new Game(gb);
    // Through the intro to Red's room (as packages/emu's playIntro does).
    let reached = false;
    const remove = gb.addHook("OverworldLoop", () => (reached = true));
    for (let f = 0; !reached && f < 20_000; f++) {
      const press = f % 64 < 8 ? Button.Down : f % 512 < 8 ? Button.Start : Button.A;
      game.hold(f % 8 < 2 ? press : 0, 0);
      game.frame();
    }
    remove();
    game.hold(0, 0);
    game.run(60);
    // Point the stairs at Mt Moon 1F's ladder down (its 3rd warp, at 5,5), and take them.
    gb.write(W_WARP_ENTRIES + 2, 2);
    gb.write(W_WARP_ENTRIES + 3, id("MT_MOON_1F"));
    game.until(Button.Right, (s) => s.player.x === 5);
    game.until(Button.Up, (s) => s.player.y === 1);
    game.until(Button.Right, (s) => s.mapId !== id("REDS_HOUSE_2F"));
    game.run(120);
  }, 120_000);

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("arrives on Mt Moon 1F's ladder", () => {
    expect([game.state.mapId, game.state.player.x, game.state.player.y]).toEqual([id("MT_MOON_1F"), 5, 5]);
  });

  it("takes exactly the steps asked for, however late the page sees the game", async () => {
    for (const [burst, latency] of [
      [1, 0],
      [3, 2],
      [4, 3],
    ] as const) {
      for (const steps of [1, 3]) {
        const direction = (["down", "right", "up", "left"] as const).find((d) => open(game.state, d, steps))!;
        const walk = await walker(game, burst, latency)([{ direction, steps }]);
        expect({ burst, latency, end: walk.result.end, steps: walk.steps, moved: Math.abs(walk.end.player.x - walk.start.player.x) + Math.abs(walk.end.player.y - walk.start.player.y) }).toEqual({
          burst,
          latency,
          end: "done",
          steps,
          moved: steps,
        });
        vi.unstubAllGlobals();
      }
    }
  }, 120_000);

  it("counts only the steps on this floor when a ladder ends the walk", async () => {
    // Back to the ladder at 5,5, then ask for more steps than that.
    const s = game.state;
    const legs: { direction: Direction; steps: number }[] = [];
    if (s.player.y !== 5) legs.push({ direction: s.player.y > 5 ? "up" : "down", steps: Math.abs(s.player.y - 5) });
    if (s.player.x !== 5) legs.push({ direction: s.player.x > 5 ? "left" : "right", steps: Math.abs(s.player.x - 5) + 3 });
    else legs[legs.length - 1]!.steps += 3;
    const walk = await walker(game, 4, 3)(legs);
    expect(walk.result.end).toBe("map");
    expect(walk.end.mapId).toBe(id("MT_MOON_B1F"));
    expect(walk.steps).toBe(Math.abs(s.player.x - 5) + Math.abs(s.player.y - 5));
  }, 60_000);
});
