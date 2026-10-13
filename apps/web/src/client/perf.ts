// Performance telemetry: how smoothly the game runs on every device playing (the old iPad above
// all), sent to `POST /api/perf` one window of play at a time and read at /admin/perf. The game
// feeds it every display frame. It's always on, so it stays cheap: each frame adds a few numbers
// to buffers made once, and nothing it does may throw into the game.
import { MISSED_FRAME_MS, STALL_MS, type PerfReport } from "@pokehd/protocol";
import type { Engine } from "@pokehd/engine";
import { reportContext } from "./errors.ts";

/** The first window goes after half a minute of visible play, so short visits still report. */
const FIRST_WINDOW_MS = 30_000;
const WINDOW_MS = 60_000;
/** A window cut short by the page hiding or closing is sent if it's at least this long. */
const MIN_PARTIAL_MS = 10_000;
/** The most windows one page load sends: two hours of play. */
const MAX_WINDOWS = 120;
/** Frame times one window can hold: a minute at 270 fps. */
const CAPACITY = 16_384;

type Mode = "overworld" | "dialog" | "battle";

export class PerfSampler {
  readonly #intervals = new Float32Array(CAPACITY);
  readonly #cpu = new Float32Array(CAPACITY);
  #frames = 0;
  #cpuFrames = 0;
  /** Visible time in the window, ms, and how much of it the engine was drawing. */
  #ms = 0;
  #engineMs = 0;
  #worst = 0;
  #missed = 0;
  #stalls = 0;
  /** Render scale and depth of field, weighted by time; the engine's drawn-per-second, summed. */
  #scaleMs = 0;
  #dofMs = 0;
  #drawn = 0;
  readonly #modeMs = { overworld: 0, dialog: 0, battle: 0, other: 0, menu: 0 };
  #emuStart = -1;
  #emuNow = 0;
  #map: number | null = null;
  #quality: string | undefined;
  /** The last visible frame's time; 0 after the page was hidden, so the gap isn't counted. */
  #last = 0;
  #sent = 0;
  readonly #onHide = () => {
    if (document.visibilityState === "hidden") this.#close();
  };
  readonly #onPageHide = () => this.#close();

  constructor() {
    document.addEventListener("visibilitychange", this.#onHide);
    addEventListener("pagehide", this.#onPageHide);
  }

  /**
   * One display frame. `mode` and `map` are null outside the world (title, intro, loading);
   * `menu` is the Pokédex menu or a question sheet being up.
   */
  frame(now: number, engine: Engine | null, emuFrames: number, mode: Mode | null, map: number | null, menu: boolean): void {
    try {
      if (this.#sent >= MAX_WINDOWS) return;
      if (document.visibilityState !== "visible") {
        this.#last = 0;
        return;
      }
      const last = this.#last;
      this.#last = now;
      if (this.#emuStart < 0) this.#emuStart = emuFrames;
      this.#emuNow = emuFrames;
      if (!last) return;
      const ms = now - last;
      if (this.#frames < CAPACITY) this.#intervals[this.#frames] = ms;
      this.#frames++;
      this.#ms += ms;
      if (ms > this.#worst) this.#worst = ms;
      if (ms > MISSED_FRAME_MS) this.#missed++;
      if (ms > STALL_MS) this.#stalls++;
      this.#modeMs[mode ?? "other"] += ms;
      if (menu) this.#modeMs.menu += ms;
      if (map !== null) this.#map = map;
      if (engine) {
        const stats = engine.stats;
        if (this.#cpuFrames < CAPACITY) this.#cpu[this.#cpuFrames++] = stats.cpuMs;
        this.#engineMs += ms;
        this.#scaleMs += stats.scale * ms;
        if (stats.dof) this.#dofMs += ms;
        this.#drawn += stats.drawn;
        this.#quality = engine.quality;
      }
      if (this.#ms >= (this.#sent ? WINDOW_MS : FIRST_WINDOW_MS)) this.#send();
    } catch {
      // Telemetry must never be the thing that breaks the game.
    }
  }

  /** The game is going: sends what's left of the window and stops listening. */
  dispose(): void {
    this.#close();
    document.removeEventListener("visibilitychange", this.#onHide);
    removeEventListener("pagehide", this.#onPageHide);
  }

  /** The page hid or closed: the window so far goes if it's long enough, and a new one starts. */
  #close(): void {
    try {
      this.#last = 0;
      if (this.#ms >= MIN_PARTIAL_MS && this.#sent < MAX_WINDOWS) this.#send();
      else this.#reset();
    } catch {
      // As above.
    }
  }

  #send(): void {
    const frames = Math.min(this.#frames, CAPACITY);
    const intervals = this.#intervals.subarray(0, frames).sort();
    const seconds = this.#ms / 1000;
    const context = reportContext();
    const share = (ms: number) => round(Math.min(1, ms / this.#ms), 3);
    const report: PerfReport = {
      ...context,
      backend: (context.device.renderer as PerfReport["backend"] | undefined) ?? "none",
      ...(this.#quality ? { quality: this.#quality } : {}),
      seconds: round(seconds, 1),
      frames: this.#frames,
      fps: round(this.#frames / seconds, 1),
      p50Ms: round(percentile(intervals, 0.5), 1),
      p95Ms: round(percentile(intervals, 0.95), 1),
      worstMs: round(this.#worst, 1),
      missed: round(this.#missed / this.#frames, 3),
      stalls: this.#stalls,
      emuFps: round((this.#emuNow - this.#emuStart) / seconds, 1),
      ...(this.#cpuFrames
        ? {
            cpuMs: round(percentile(this.#cpu.subarray(0, this.#cpuFrames).sort(), 0.5), 2),
            scale: round(this.#scaleMs / this.#engineMs, 3),
            dof: round(this.#dofMs / this.#engineMs, 3),
            drawn: round(this.#drawn / this.#cpuFrames, 1),
          }
        : {}),
      modes: {
        overworld: share(this.#modeMs.overworld),
        dialog: share(this.#modeMs.dialog),
        battle: share(this.#modeMs.battle),
        other: share(this.#modeMs.other),
        menu: share(this.#modeMs.menu),
      },
      ...(this.#map !== null ? { map: this.#map } : {}),
    };
    this.#sent++;
    this.#reset();
    void post(report);
  }

  #reset(): void {
    this.#frames = this.#cpuFrames = 0;
    this.#ms = this.#engineMs = this.#worst = this.#missed = this.#stalls = 0;
    this.#scaleMs = this.#dofMs = this.#drawn = 0;
    this.#modeMs.overworld = this.#modeMs.dialog = this.#modeMs.battle = this.#modeMs.other = this.#modeMs.menu = 0;
    // Straight on, the next window's emulator count starts here; after a hide, at the first visible frame.
    this.#emuStart = this.#last ? this.#emuNow : -1;
  }
}

/** The value `p` of the way through `sorted`. */
function percentile(sorted: Float32Array, p: number): number {
  return sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))]! : 0;
}

const round = (n: number, places: number) => Math.round(n * 10 ** places) / 10 ** places;

async function post(report: PerfReport): Promise<void> {
  try {
    // As with crash reports: keepalive lets it finish if the page is closing; text/plain keeps it a simple request.
    await fetch("/api/perf", { method: "POST", body: JSON.stringify(report), headers: { "content-type": "text/plain" }, keepalive: true });
  } catch {
    // Offline: this window is lost, which is fine.
  }
}
