// ROM test for the emulator worker: pausing and unpausing at any moment, with or without
// sound, never leaves the game stuck or running away, and the player can still walk; the save
// it hands the page, and every resume point, is always a whole save. Skips without the dev ROM.
import { existsSync, readFileSync } from "node:fs";
import { SYMBOLS } from "@pokehd/rom";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { hasSave, sameTrainer, saveSummary } from "./autosave.ts";
import { Button, GameBoy } from "./core.ts";
import { saveGame } from "./gifts/gifts.ts";
import { SafePoint } from "./gifts/safepoint.ts";
import { playIntro } from "./testing.ts";
import { loadWorker, type WorkerHarness } from "./worker-harness.ts";

const ROM_PATH = new URL("../../../rom/pokeblue.gb", import.meta.url);
const WASM_PATH = new URL("./generated/sameboy.wasm", import.meta.url);
const wasm = existsSync(WASM_PATH) ? readFileSync(WASM_PATH) : undefined;

// The worker makes its own GameBoy, and Node can't fetch the wasm next to the module. The
// newest one is kept, so a test can have its game do something (save).
vi.mock("./core.ts", async (importOriginal) => {
  const core = await importOriginal<typeof import("./core.ts")>();
  const create = core.GameBoy.create.bind(core.GameBoy);
  core.GameBoy.create = async (options) => ((globalThis as { workerGameBoy?: GameBoy }).workerGameBoy = await create({ ...options, wasmBinary: wasm }));
  return core;
});
const workerGameBoy = () => (globalThis as { workerGameBoy?: GameBoy }).workerGameBoy!;

const SAMPLE_RATE = 48_000;
const position = async (w: WorkerHarness, id: number) => {
  const { bytes } = await w.request({ type: "read", id, ranges: [[SYMBOLS.wXCoord.address, 1], [SYMBOLS.wYCoord.address, 1]] }, "read");
  return `${bytes[0]![0]},${bytes[1]![0]}`;
};
/** Where the money is in a battery save. */
const MONEY_AT = 0x2000 + SYMBOLS.sMainData.address - 0xa000 + SYMBOLS.wPlayerMoney.address - SYMBOLS.wMainDataStart.address;

describe.skipIf(!existsSync(ROM_PATH))("emulator worker", () => {
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

  // The game writes its save over several frames, and the save file's checksum is wrong in
  // between. A save handed out then is one the game won't load: if the page is closed before
  // the next one (a second later), CONTINUE is gone. And each one made the save slot keep the
  // previous save as if a new game had replaced it, pushing real ones out of Earlier saves.
  it.each([
    ["while resume points are taken", true],
    ["on its own", false],
  ])("hands out only whole saves (%s), and takes no resume point half-way through one", async (_, takePoints) => {
    // A while in, so a first write could be handed out at once.
    vi.advanceTimersByTime(5000);
    const w = await boot();
    await w.advance(500);
    // The player saves (the start menu's SAVE, or an autosave) while the page is hidden and
    // shown again and again, taking a resume point each time.
    const gb = workerGameBoy();
    gb.write(SYMBOLS.wPlayerMoney.address, 0x42); // something new to save
    SafePoint.of(gb).enqueue({ scratch: [], steps: [saveGame] });
    const points: (Uint8Array | null)[] = [];
    for (let i = 0; i < 60; i++) {
      await w.advance(10);
      if (takePoints) points.push((await w.request({ type: "resume-point", id: i }, "resume-point")).state);
    }
    await w.advance(3000);
    const srams = w.out.flatMap((m) => (m.type === "sram" ? [m.sram] : []));
    expect(srams.length).toBeGreaterThan(0);
    const first = saveSummary(sram)!;
    for (const s of srams) {
      expect(hasSave(s)).toBe(true);
      expect(sameTrainer(saveSummary(s)!, first)).toBe(true);
    }
    // The last one is the finished save.
    expect(srams.at(-1)![MONEY_AT]).toBe(0x42);
    // Every point taken holds a whole save.
    if (takePoints) expect(points.some((p) => p)).toBe(true);
    for (const point of points) {
      if (!point) continue;
      const g = await GameBoy.create({ rom, wasmBinary: wasm });
      g.loadState(point);
      expect(hasSave(g.saveSram())).toBe(true);
    }
  }, 60_000);
});
