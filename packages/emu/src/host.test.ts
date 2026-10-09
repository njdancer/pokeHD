import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EmulatorHost } from "./host.ts";
import type { ToWorker } from "./protocol.ts";

// A browser just big enough for EmulatorHost's audio setup: a context whose resume() waits for
// the test to release it, like iOS before a gesture it accepts.
class FakeContext {
  sampleRate = 48_000;
  state = "suspended";
  release = () => {};
  readonly #resumed = new Promise<void>((resolve) => (this.release = resolve));
  audioWorklet = { addModule: () => new Promise<void>((resolve) => setTimeout(resolve, 5)) };
  destination = {};
  async resume() {
    await this.#resumed;
    this.state = "running";
  }
  onstatechange: (() => void) | null = null;
  /** The browser stopping it on its own, as iOS does to a backgrounded app. */
  interrupt() {
    this.state = "interrupted";
    this.onstatechange?.();
  }
  suspend = async () => {};
  close = async () => {};
}

let context: FakeContext;
let posted: ToWorker[];

beforeEach(() => {
  posted = [];
  vi.stubGlobal("AudioContext", function () {
    context = new FakeContext();
    return context;
  });
  vi.stubGlobal("Worker", function () {
    return { postMessage: (message: ToWorker) => posted.push(message), terminate() {} };
  });
  vi.stubGlobal("AudioWorkletNode", function () {
    return { connect() {}, disconnect() {}, port: { postMessage() {} } };
  });
  URL.createObjectURL = () => "blob:worklet";
  URL.revokeObjectURL = () => {};
});
afterEach(() => vi.unstubAllGlobals());

describe("EmulatorHost.enableAudio", () => {
  it("makes one worklet for calls that all waited on the same resume", async () => {
    const host = new EmulatorHost({ rom: new Uint8Array(0) });
    // Several touch presses before iOS accepted a gesture, then the one it accepts.
    const calls = [host.enableAudio(), host.enableAudio(), host.enableAudio()];
    context.release();
    await Promise.all(calls);
    await host.enableAudio();
    expect(posted.filter((m) => m.type === "audio").length).toBe(1);
    expect(host.audioEnabled).toBe(true);
  });

  it("swaps in one fresh context and worklet after coming back from the background", async () => {
    const host = new EmulatorHost({ rom: new Uint8Array(0) });
    const first = context;
    const closed = vi.spyOn(first, "close");
    first.release();
    await host.enableAudio();
    first.interrupt();
    expect(host.restartAudio()).toBe(true);
    expect(closed).toHaveBeenCalled();
    expect(context).not.toBe(first);
    expect(host.audioEnabled).toBe(false);
    const calls = [host.enableAudio(), host.enableAudio()];
    context.release();
    await Promise.all(calls);
    expect(posted.filter((m) => m.type === "audio").length).toBe(2);
    expect(host.audioEnabled).toBe(true);
  });

  it("keeps a context that kept running while the page was away", async () => {
    const host = new EmulatorHost({ rom: new Uint8Array(0) });
    const first = context;
    first.release();
    await host.enableAudio();
    expect(host.restartAudio()).toBe(false);
    expect(context).toBe(first);
    expect(host.audioEnabled).toBe(true);
  });

  it("drops a worklet still being set up when the context is swapped", async () => {
    const host = new EmulatorHost({ rom: new Uint8Array(0) });
    const first = context;
    first.release();
    const early = host.enableAudio(); // resumed, but the worklet module is still loading
    await Promise.resolve();
    await Promise.resolve();
    first.state = "suspended"; // the page went away before it finished
    expect(host.restartAudio()).toBe(true);
    const fresh = host.enableAudio();
    context.release();
    await Promise.all([early, fresh]);
    expect(posted.filter((m) => m.type === "audio").length).toBe(1);
    expect(host.audioEnabled).toBe(true);
  });
});
