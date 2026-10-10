// ROM test for the emulator worker's pacing: pausing and unpausing at any moment, with or
// without sound, never leaves the game stuck or running away, and the player can still walk.
// Skips without the dev ROM.
import { existsSync, readFileSync } from "node:fs";
import { SYMBOLS } from "@pokehd/rom";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Button, GameBoy } from "./core.ts";
import { saveGame } from "./gifts/gifts.ts";
import { SafePoint } from "./gifts/safepoint.ts";
import { playIntro } from "./testing.ts";
import { loadWorker, type WorkerHarness } from "./worker-harness.ts";

const ROM_PATH = new URL("../../../rom/pokeblue.gb", import.meta.url);
const WASM_PATH = new URL("./generated/sameboy.wasm", import.meta.url);
const wasm = existsSync(WASM_PATH) ? readFileSync(WASM_PATH) : undefined;

// The worker makes its own GameBoy, and Node can't fetch the wasm next to the module.
vi.mock("./core.ts", async (importOriginal) => {
  const core = await importOriginal<typeof import("./core.ts")>();
  const create = core.GameBoy.create.bind(core.GameBoy);
  core.GameBoy.create = (options) => create({ ...options, wasmBinary: wasm });
  return core;
});

const SAMPLE_RATE = 48_000;
const position = async (w: WorkerHarness, id: number) => {
  const { bytes } = await w.request({ type: "read", id, ranges: [[SYMBOLS.wXCoord.address, 1], [SYMBOLS.wYCoord.address, 1]] }, "read");
  return `${bytes[0]![0]},${bytes[1]![0]}`;
};

describe.skipIf(!existsSync(ROM_PATH))("emulator worker pacing", () => {
  let rom: Uint8Array;
  /** In the world after the intro, with that trainer saved, and the save. */
  let state: Uint8Array;
  let sram: Uint8Array;

  beforeAll(async () => {
    rom = new Uint8Array(readFileSync(ROM_PATH));
    const gb = await GameBoy.create({ rom, wasmBinary: wasm });
    playIntro(gb);
    const safe = SafePoint.of(gb);
    safe.enqueue({ scratch: [], steps: [saveGame] });
    for (let i = 0; i < 600 && safe.pending > 0; i++) gb.runFrame();
    for (let i = 0; i < 60; i++) gb.runFrame();
    sram = gb.saveSram();
    state = gb.saveState();
  }, 60_000);

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  const boot = async (resume = true) => {
    const w = await loadWorker();
    w.send({ type: "start", rom, sram, ...(resume ? { resume: state } : {}), sampleRate: SAMPLE_RATE });
    // The core compiles its wasm meanwhile, in real time.
    for (const until = Date.now() + 10_000; Date.now() < until && !w.out.some((m) => m.type === "ready" || m.type === "error"); ) {
      await new Promise((r) => setImmediate(r));
    }
    expect(w.out.find((m) => m.type === "ready" || m.type === "error")).toMatchObject({ type: "ready", resumed: resume });
    return w;
  };

  /** Holds each direction in turn; true if the player moved or turned to walk somewhere. */
  const walks = async (w: WorkerHarness, step: (ms: number) => Promise<void>) => {
    const seen = new Set([await position(w, 1)]);
    for (const dir of [Button.Down, Button.Left, Button.Right, Button.Up]) {
      w.send({ type: "buttons", mask: dir });
      await step(700);
      w.send({ type: "buttons", mask: 0 });
      await step(300);
      seen.add(await position(w, 2));
    }
    return seen.size > 1;
  };

  it("runs on the timer after an unpause with no sound yet (the /dev/saves Resume)", async () => {
    const w = await boot();
    await w.advance(50);
    // Game.tsx pauses after the first frame while the menu is up, then lets go on Resume,
    // before the tap has started any sound.
    w.send({ type: "pause", paused: true });
    await w.advance(500);
    const before = w.frames;
    w.send({ type: "pause", paused: false });
    expect(w.ranAway).toBe(false);
    await w.advance(1000);
    expect(w.ranAway).toBe(false);
    // About 60 a second, not thousands.
    expect(w.frames - before).toBeGreaterThan(40);
    expect(w.frames - before).toBeLessThan(80);
    expect(await walks(w, (ms) => w.advance(ms))).toBe(true);
  }, 60_000);
});
