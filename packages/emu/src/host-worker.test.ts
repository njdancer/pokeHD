// ROM fuzz test for EmulatorHost and its worker together, with a stand-in browser: an audio
// context that, like iOS, only starts in a gesture (or, like a desktop, once one has happened),
// a worklet that plays while its context runs, and a page that pauses, unpauses, goes to the
// background and comes back, taps, and takes resume points at random moments. Whatever the
// order, once the game is unpaused and the player taps it runs at its own pace and walks, every
// resume point holds the save the page stored, and every save handed out is the same trainer's.
// Skips without the dev ROM.
import { existsSync, readFileSync } from "node:fs";
import { SYMBOLS } from "@pokehd/rom";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { loadResumePoint, sameTrainer, saveSummary } from "./autosave.ts";
import { Button, GameBoy } from "./core.ts";
import { fuzzSeeds, fuzzSteps, rng, type Rng } from "./fuzz.ts";
import { saveGame } from "./gifts/gifts.ts";
import { SafePoint } from "./gifts/safepoint.ts";
import { EmulatorHost } from "./host.ts";
import type { FromWorker, ToWorker } from "./protocol.ts";
import { playIntro } from "./testing.ts";
import { loadWorker, type WorkerHarness } from "./worker-harness.ts";

const ROM_PATH = new URL("../../../rom/pokeblue.gb", import.meta.url);
const WASM_PATH = new URL("./generated/sameboy.wasm", import.meta.url);
const wasm = existsSync(WASM_PATH) ? readFileSync(WASM_PATH) : undefined;

vi.mock("./core.ts", async (importOriginal) => {
  const core = await importOriginal<typeof import("./core.ts")>();
  const create = core.GameBoy.create.bind(core.GameBoy);
  core.GameBoy.create = (options) => create({ ...options, wasmBinary: wasm });
  return core;
});

/** When a resume() outside a gesture works: never (iOS), or once any gesture has (desktop). */
type Policy = "ios" | "sticky";

interface Browser {
  policy: Policy;
  gestured: boolean;
  contexts: FakeContext[];
  nodes: FakeNode[];
  /** Runs a user gesture: `during` is the page's handler (enableAudio). */
  gesture(during: () => void): void;
}

let browser: Browser;

class FakeContext {
  sampleRate = 48_000;
  state: AudioContextState | "interrupted" = "suspended";
  onstatechange: (() => void) | null = null;
  readonly #waiting: (() => void)[] = [];
  audioWorklet = { addModule: () => new Promise<void>((resolve) => setTimeout(resolve, 5)) };
  destination = {};
  constructor() {
    browser.contexts.push(this);
  }
  #set(state: FakeContext["state"]) {
    if (this.state === state || this.state === "closed") return;
    this.state = state;
    this.onstatechange?.();
  }
  resume(): Promise<void> {
    if (this.state === "closed") return Promise.reject(new Error("closed"));
    return new Promise((resolve) => {
      this.#waiting.push(resolve);
      if (browser.policy === "sticky" && browser.gestured) this.allow();
    });
  }
  /** A gesture the browser accepts: every waiting resume() goes through. */
  allow() {
    if (this.state === "closed") return;
    this.#set("running");
    for (const resolve of this.#waiting.splice(0)) resolve();
  }
  suspend = async () => this.#set("suspended");
  interrupt = () => this.#set("interrupted");
  close = async () => this.#set("closed");
}

/** The worklet: plays (and reports what it played) while its context runs and it's connected. */
class FakeNode {
  connected = true;
  emu: FakePort | null = null;
  readonly context: FakeContext;
  constructor(context: FakeContext) {
    this.context = context;
    browser.nodes.push(this);
  }
  port = { postMessage: (port: FakePort) => (this.emu = port) };
  connect() {}
  disconnect() {
    this.connected = false;
  }
  play(frames: number) {
    if (this.connected && this.emu && this.context.state === "running") this.emu.postMessage({ consumed: frames });
  }
}

/** A MessagePort pair that delivers in order, a microtask later. */
class FakePort {
  other!: FakePort;
  onmessage: ((e: { data: unknown }) => void) | null = null;
  closed = false;
  postMessage(data: unknown) {
    queueMicrotask(() => !this.closed && !this.other.closed && this.other.onmessage?.({ data }));
  }
  close() {
    this.closed = true;
  }
}
class FakeChannel {
  port1 = new FakePort();
  port2 = new FakePort();
  constructor() {
    this.port1.other = this.port2;
    this.port2.other = this.port1;
  }
}

describe.skipIf(!existsSync(ROM_PATH))("emulator host and worker", () => {
  let rom: Uint8Array;
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
    browser = {
      policy: "ios",
      gestured: false,
      contexts: [],
      nodes: [],
      gesture(during) {
        this.gestured = true;
        during();
        browser.contexts.at(-1)?.allow();
      },
    };
    vi.stubGlobal("AudioContext", FakeContext);
    vi.stubGlobal("AudioWorkletNode", FakeNode);
    vi.stubGlobal("MessageChannel", FakeChannel);
    URL.createObjectURL = () => "blob:worklet";
    URL.revokeObjectURL = () => {};
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  interface Page {
    host: EmulatorHost;
    worker: WorkerHarness;
    srams: Uint8Array[];
    errors: string[];
    /** Advances time with the worklets playing. */
    advance(ms: number): Promise<void>;
    gesture(): Promise<void>;
  }

  const open = async (resume = true): Promise<Page> => {
    let toHost: ((e: MessageEvent<FromWorker>) => void) | null = null;
    const worker = await loadWorker({ onPost: (m) => queueMicrotask(() => toHost?.({ data: m } as MessageEvent<FromWorker>)) });
    vi.stubGlobal("Worker", function () {
      return {
        set onmessage(f: typeof toHost) {
          toHost = f;
        },
        postMessage: (m: ToWorker) => queueMicrotask(() => worker.send(m)),
        terminate() {},
      };
    });
    const srams: Uint8Array[] = [];
    const errors: string[] = [];
    const host = new EmulatorHost({ rom, sram, ...(resume ? { resume: state } : {}), onSram: (s) => srams.push(s), onError: (e) => errors.push(e) });
    for (const until = Date.now() + 10_000; Date.now() < until && !worker.out.some((m) => m.type === "ready" || m.type === "error"); ) {
      await new Promise((r) => setImmediate(r));
    }
    expect(await host.started).toEqual({ resumed: resume });
    const page: Page = {
      host,
      worker,
      srams,
      errors,
      advance: (ms) => worker.advance(ms, () => browser.nodes.forEach((n) => n.play(480))),
      async gesture() {
        let enabling: Promise<void> = Promise.resolve();
        browser.gesture(() => (enabling = host.enableAudio().catch(() => {})));
        await page.advance(20);
        await enabling;
        await worker.settle();
      },
    };
    return page;
  };

  const position = async (w: WorkerHarness) => {
    const { bytes } = await w.request({ type: "read", id: 1e9, ranges: [[SYMBOLS.wXCoord.address, 1], [SYMBOLS.wYCoord.address, 1]] }, "read");
    return `${bytes[0]![0]},${bytes[1]![0]}`;
  };
  const walks = async (page: Page) => {
    // Out of anything an A press opened (the bedroom's PC, the SNES's few lines).
    for (let i = 0; i < 16; i++) {
      page.host.setButtons(Button.B);
      await page.advance(100);
      page.host.setButtons(0);
      await page.advance(200);
    }
    const seen = new Set([await position(page.worker)]);
    for (const dir of [Button.Down, Button.Left, Button.Right, Button.Up]) {
      page.host.setButtons(dir);
      await page.advance(700);
      page.host.setButtons(0);
      await page.advance(300);
      seen.add(await position(page.worker));
    }
    return seen.size > 1;
  };
  /** Frames in a second of play: about 60 when it runs at its own pace. */
  const pace = async (page: Page) => {
    const before = page.worker.frames;
    await page.advance(1000);
    return page.worker.frames - before;
  };

  it("runs at its own pace after the held page's first Resume tap starts the sound", async () => {
    const page = await open();
    await page.advance(30);
    page.host.setPaused(true);
    await page.advance(400);
    // The Resume tap: a gesture starts the sound, and the menu lets the game go.
    let enabling: Promise<void> = Promise.resolve();
    browser.gesture(() => (enabling = page.host.enableAudio()));
    page.host.setPaused(false);
    await page.advance(50);
    await enabling;
    expect(page.worker.ranAway).toBe(false);
    const n = await pace(page);
    expect(n).toBeGreaterThan(45);
    expect(n).toBeLessThan(75);
    expect(await walks(page)).toBe(true);
  }, 60_000);

  // iOS: sound was on, the menu paused the game (suspending the context), and the unpause's own
  // resume() isn't in a gesture, so it waits. The game, paced by that context, stands still
  // until the next tap. EmulatorHost.setPaused is changing to leave the context running.
  it("runs after an unpause on iOS with no tap, when sound was already on", async () => {
    const page = await open();
    await page.gesture();
    await page.advance(200);
    page.host.setPaused(true);
    await page.advance(300);
    page.host.setPaused(false);
    expect(await pace(page)).toBeGreaterThan(45);
  }, 60_000);

  const seeds = fuzzSeeds(3);
  it.each(seeds)("survives random pauses, taps, backgrounding and resume points (seed %i)", async (seed) => {
    const r: Rng = rng(seed);
    browser.policy = r.chance(0.5) ? "ios" : "sticky";
    const resumed = r.chance(0.8);
    const page = await open(resumed);
    let paused = false;
    let points = 0;
    const steps = fuzzSteps(30);
    for (let step = 0; step < steps; step++) {
      const op = r.int(8);
      if (op === 0) {
        paused = !paused;
        page.host.setPaused(paused);
      } else if (op === 1) {
        await page.gesture();
      } else if (op === 2) {
        // To the background and back: iOS stops the context; Game swaps it on return.
        if (r.chance(0.5)) browser.contexts.at(-1)?.interrupt();
        await page.advance(r.int(200));
        page.host.restartAudio();
      } else if (op === 3) {
        page.host.setButtons(r.pick([0, Button.Up, Button.Down, Button.Left, Button.Right, Button.A]));
      } else if (op === 4 && points < 3) {
        points++;
        const point = await page.host.resumePoint();
        if (point) {
          // It holds the save the page has: the newest handed out, else the one it started on.
          const stored = page.srams.at(-1) ?? sram;
          const gb = await GameBoy.create({ rom, sram: stored, wasmBinary: wasm });
          expect(loadResumePoint(gb, point, stored), `seed ${seed} step ${step}`).toBeUndefined();
        }
      } else if (op === 5) {
        // A call outside a gesture (a gamepad, the pointerdown before iOS accepts the tap): it
        // may wait for the next gesture's resume().
        void page.host.enableAudio().catch(() => {});
        page.host.setPaused(paused);
        await page.advance(20);
      } else {
        await page.advance(10 + r.int(400));
      }
      expect(page.worker.ranAway, `seed ${seed} step ${step}`).toBe(false);
    }
    // The player lets it go and taps: it runs at its pace and walks.
    page.host.setPaused(false);
    page.host.setButtons(0);
    await page.gesture();
    const n = await pace(page);
    expect(page.worker.ranAway, `seed ${seed}`).toBe(false);
    expect(n, `seed ${seed}`).toBeGreaterThan(45);
    expect(n, `seed ${seed}`).toBeLessThan(75);
    // From the title screen there's nowhere to walk yet.
    if (resumed) expect(await walks(page), `seed ${seed}`).toBe(true);
    // Only one worklet ever paces the game at a time.
    expect(browser.nodes.filter((nd) => nd.connected && nd.context.state === "running").length).toBeLessThanOrEqual(1);
    const first = saveSummary(sram)!;
    for (const s of page.srams) expect(sameTrainer(saveSummary(s)!, first)).toBe(true);
    expect(page.errors).toEqual([]);
  }, 120_000);
});
