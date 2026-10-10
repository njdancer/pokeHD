// Runs the emulator worker (worker.ts) in Node for tests: a stand-in `self` that records what it
// posts, fake audio ports for the worklet's side, and a guard that stops a frame loop that never
// gives the event loop back. Use with fake timers (setTimeout and performance). Not exported
// from the package.
import { vi } from "vitest";
import type { FromWorker, FromWorklet, ToWorker, ToWorklet } from "./protocol.ts";

/** The worklet's end of an audio port: what it was sent, and its reports back. */
export class FakePort {
  onmessage: ((e: MessageEvent<FromWorklet>) => void) | null = null;
  closed = false;
  /** Sample frames sent and not yet played. */
  queued = 0;
  postMessage(message: ToWorklet): void {
    this.queued += message.samples.length / 2;
  }
  close(): void {
    this.closed = true;
  }
  /** The worklet played `frames` sample frames (it reports whether or not it had them). */
  consume(frames: number): void {
    this.queued = Math.max(0, this.queued - frames);
    this.onmessage?.({ data: { consumed: frames } } as MessageEvent<FromWorklet>);
  }
}

export interface WorkerHarness {
  /** Everything the worker posted, in order. */
  out: FromWorker[];
  send(message: ToWorker): void;
  /** Frames posted so far. */
  readonly frames: number;
  /** Set when one message or timer ran more than `runaway` frames without returning. */
  readonly ranAway: boolean;
  /** Lets the worker's queued promise work run (messages waiting on start). */
  settle(): Promise<void>;
  /** Advances fake time by `ms` in 10 ms steps, calling `each` after each and settling. */
  advance(ms: number, each?: () => void): Promise<void>;
  /** Sends a fresh audio port, as `EmulatorHost.enableAudio` does. */
  audio(): FakePort;
  /** Asks for a reply and waits for it. */
  request<T extends FromWorker["type"]>(message: ToWorker & { id: number }, type: T): Promise<Extract<FromWorker, { type: T }>>;
}

/**
 * Loads a fresh copy of worker.ts against a stand-in `self`. Call `vi.resetModules()` between
 * workers (this does) so each gets its own module state, and mock ./core.ts to hand the core
 * its wasm (Node can't fetch it).
 */
export async function loadWorker(options: { runaway?: number; onPost?: (message: FromWorker) => void } = {}): Promise<WorkerHarness> {
  const runaway = options.runaway ?? 2000;
  const out: FromWorker[] = [];
  let frames = 0;
  let sinceYield = 0;
  let ranAway = false;
  const scope = {
    onmessage: null as ((e: MessageEvent<ToWorker>) => void) | null,
    postMessage(message: FromWorker) {
      out.push(message);
      options.onPost?.(message);
      if (message.type !== "frame") return;
      frames++;
      if (++sinceYield > runaway && !ranAway) {
        ranAway = true;
        // Thrown from inside the worker's loop, which is the only way out of it.
        throw new Error("the worker ran away: frames without a break");
      }
    },
  };
  vi.resetModules();
  vi.stubGlobal("self", scope);
  await import("./worker.ts");
  const deliver = (message: ToWorker) => {
    sinceYield = 0;
    scope.onmessage?.({ data: message } as MessageEvent<ToWorker>);
  };
  const settle = async () => {
    for (let i = 0; i < 20; i++) await Promise.resolve();
    sinceYield = 0;
  };
  const harness: WorkerHarness = {
    out,
    send: deliver,
    get frames() {
      return frames;
    },
    get ranAway() {
      return ranAway;
    },
    settle,
    async advance(ms, each) {
      for (let t = 0; t < ms; t += 10) {
        sinceYield = 0;
        await vi.advanceTimersByTimeAsync(Math.min(10, ms - t));
        each?.();
        await settle();
      }
      await settle();
    },
    audio() {
      const port = new FakePort();
      deliver({ type: "audio", port: port as unknown as MessagePort });
      return port;
    },
    async request(message, type) {
      const from = out.length;
      deliver(message);
      for (let i = 0; i < 200; i++) {
        const reply = out.slice(from).find((m) => m.type === type && (!("id" in m) || m.id === message.id));
        if (reply) return reply as Extract<FromWorker, { type: typeof type }>;
        await settle();
      }
      throw new Error(`no ${type} reply (id ${message.id})`);
    },
  };
  return harness;
}
