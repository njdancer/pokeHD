// Heuristics for things that look wrong on screen, fed a sample of the page ~5 times a second.
// Each incident gives one Glitch, written for the player and the bug report.
import type { Glitch } from "./types.ts";

export interface GlitchSample {
  /** Wall-clock ms. */
  at: number;
  hooked: boolean;
  inWorld: boolean;
  mode: string | null;
  layout: string;
  loading: boolean;
  frames: number;
  visible: boolean;
  held: boolean;
  /** The harness itself is reloading or holding the page (a restart, a screenshot). */
  busy: boolean;
  /** Long display frames seen since the last sample. */
  slow: { ms: number }[];
}

const FLIP_MAX_MS = 3000;
const STALL_MS = 2000;
const LONG_FRAME_MS = 250;
const LONG_FRAME_QUIET_MS = 30_000;
const LEAVE_MAX_MS = 10_000;
const REPEAT_MS = 10_000;

const secs = (ms: number) => `${(ms / 1000).toFixed(1)} s`;

export class GlitchWatcher {
  #out: Glitch[] = [];
  #seenWorld = false;
  #prev: GlitchSample | null = null;
  #flipStart: number | null = null;
  #loadingReported = false;
  #stallStart: number | null = null;
  #stallReported = false;
  #leftAt: number | null = null;
  #lastLong = -Infinity;
  #suppressedLong = 0;
  #recent = new Map<string, number>();

  /** Glitches since the last call. */
  take(): Glitch[] {
    const out = this.#out;
    this.#out = [];
    return out;
  }

  /** Every glitch kept for evidence, newest last (the last 50). */
  readonly history: Glitch[] = [];

  push(kind: string, text: string, at = Date.now()): void {
    const key = `${kind}:${text}`;
    const last = this.#recent.get(key);
    if (last !== undefined && at - last < REPEAT_MS) return;
    this.#recent.set(key, at);
    const g = { at, kind, text };
    this.#out.push(g);
    this.history.push(g);
    if (this.history.length > 50) this.history.shift();
  }

  /** Forget the page's history (after the harness reloads it on purpose). */
  reset(): void {
    this.#prev = null;
    this.#flipStart = null;
    this.#stallStart = null;
    this.#stallReported = false;
    this.#leftAt = null;
    this.#loadingReported = false;
    this.#seenWorld = false;
  }

  sample(s: GlitchSample): void {
    const prev = this.#prev;
    this.#prev = s;
    if (!s.hooked || s.busy) {
      this.#stallStart = null;
      this.#flipStart = null;
      this.#leftAt = null;
      return;
    }
    if (s.inWorld) this.#seenWorld = true;

    // The Game Boy screen flipping in and back (outside battles, where its own screens are expected).
    if (prev && s.inWorld && s.mode !== "battle") {
      if (s.layout === "full" && prev.layout !== "full" && prev.layout !== "") this.#flipStart = s.at;
      else if (s.layout !== "full" && this.#flipStart !== null) {
        const d = s.at - this.#flipStart;
        if (d < FLIP_MAX_MS) this.push("screen-flip", `The screen flipped to the Game Boy view for ${secs(d)} and back.`, s.at);
        this.#flipStart = null;
      }
    } else this.#flipStart = null;

    // The loading screen again, after the world was up.
    if (s.loading && this.#seenWorld && !this.#loadingReported) {
      this.#loadingReported = true;
      this.push("reload", "The loading screen came back while playing.", s.at);
    } else if (!s.loading) this.#loadingReported = false;

    // The emulator stopping while nothing should hold it.
    if (prev && s.visible && !s.held && s.frames === prev.frames) {
      this.#stallStart ??= prev.at;
      if (!this.#stallReported && s.at - this.#stallStart > STALL_MS) {
        this.#stallReported = true;
        this.push("freeze", `The game froze: no new frames for ${secs(s.at - this.#stallStart)}.`, s.at);
      }
    } else {
      this.#stallStart = null;
      this.#stallReported = false;
    }

    // Long display frames: one glitch, then quiet for a while (counting what it held back).
    const long = s.slow.filter((f) => f.ms > LONG_FRAME_MS);
    if (long.length) {
      const worst = Math.max(...long.map((f) => f.ms));
      if (s.at - this.#lastLong >= LONG_FRAME_QUIET_MS) {
        const more = this.#suppressedLong ? ` (${this.#suppressedLong} more long frames since the last report)` : "";
        this.push("long-frame", `The picture stuck for ${Math.round(worst)} ms${long.length > 1 ? ` (${long.length} long frames)` : ""}${more}.`, s.at);
        this.#lastLong = s.at;
        this.#suppressedLong = 0;
      } else this.#suppressedLong += long.length;
    }

    // The world going away and coming back.
    if (prev && this.#seenWorld) {
      if (prev.inWorld && !s.inWorld) this.#leftAt = s.at;
      else if (s.inWorld && this.#leftAt !== null) {
        const d = s.at - this.#leftAt;
        if (d < LEAVE_MAX_MS) this.push("world-flicker", `The world disappeared for ${secs(d)} and came back.`, s.at);
        this.#leftAt = null;
      }
    }
  }
}
