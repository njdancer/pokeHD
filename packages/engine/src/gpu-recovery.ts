// Bringing the HD view back after the GPU device is lost (QA bug #74).
//
// A WebGPU device can go at any moment: the browser's GPU process restarts (a driver reset, a
// screen recorder grabbing the GPU, the machine waking), and everything made on that device goes
// with it. three.js only logs it; its renderer then never draws again, so the canvas stays black
// while the game plays on. The engine instead makes a new renderer on a new device and builds
// what it drew with again (the scene objects themselves keep their data, so they upload anew).
//
// This is the orchestration alone, so it can be tested without a GPU: restoring can fail for a
// while (no adapter until the GPU process is back), and the new device can be lost too. Losses
// that keep coming mean something is wrong for good, so after a few the caller is told to give
// up (the page falls back to a reload or the Game Boy screen).

export type GpuState = "ok" | "recovering" | "failed";

export interface GpuEvent {
  state: "lost" | "restored" | "failed";
  /** What happened, for logs and reports. */
  detail: string;
}

export interface DeviceRecoveryOptions {
  /** Makes a new renderer and everything on its device. Rejects when it can't yet. */
  restore(): Promise<void>;
  onEvent?(event: GpuEvent): void;
  /** Waits before each restore attempt, ms: the GPU process may still be coming back. */
  retryDelays?: readonly number[];
  /** More losses than this within `windowMs` and recovery gives up. */
  maxLosses?: number;
  windowMs?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

export interface DeviceRecovery {
  /** Reports a lost device. Losses while a restore is under way restore again after it. */
  lost(detail: string): void;
  readonly state: GpuState;
  /** A restore under way, if any (tests wait on it). */
  readonly settled: Promise<void>;
  dispose(): void;
}

export const DEFAULT_RETRY_DELAYS = [100, 500, 1500, 4000] as const;

export function createDeviceRecovery(options: DeviceRecoveryOptions): DeviceRecovery {
  const {
    restore,
    onEvent,
    retryDelays = DEFAULT_RETRY_DELAYS,
    maxLosses = 3,
    windowMs = 60_000,
    now = () => performance.now(),
    sleep = (ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
  } = options;
  let state: GpuState = "ok";
  let disposed = false;
  /** Another loss came in while restoring: the device just made may be gone too. */
  let again = false;
  let losses: number[] = [];
  let settled: Promise<void> = Promise.resolve();

  const fail = (detail: string) => {
    state = "failed";
    onEvent?.({ state: "failed", detail });
  };

  const run = async (): Promise<void> => {
    while (again) {
      again = false;
      let error: unknown = null;
      let restored = false;
      for (const delay of retryDelays) {
        await sleep(delay);
        if (disposed) return;
        try {
          await restore();
          restored = true;
          break;
        } catch (e) {
          error = e;
        }
        if (disposed) return;
      }
      if (disposed) return;
      if (!restored) return fail(`couldn't make a new GPU device: ${String(error)}`);
    }
    state = "ok";
    onEvent?.({ state: "restored", detail: `restored after ${losses.length} loss(es) in the last minute` });
  };

  return {
    lost(detail) {
      if (disposed || state === "failed") return;
      const t = now();
      losses = losses.filter((at) => t - at < windowMs);
      losses.push(t);
      onEvent?.({ state: "lost", detail });
      if (losses.length > maxLosses) return fail(`GPU device lost ${losses.length} times within ${windowMs / 1000} s`);
      again = true;
      if (state === "recovering") return;
      state = "recovering";
      settled = run().catch((e: unknown) => fail(String(e)));
    },
    get state() {
      return state;
    },
    get settled() {
      return settled;
    },
    dispose() {
      disposed = true;
    },
  };
}
