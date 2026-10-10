// One device per save (D40), the device's side: before a save is played it's claimed from the
// lock service, and while it's played a heartbeat keeps it. Signed out or offline there's no
// service to ask, and the game plays as before ("free"): it never stops a child playing.
import { LOCK_BEAT_MS, parseLockAnswer, type LockAnswer, type LockHolder } from "@pokehd/protocol";

export type { LockHolder };
export type LockState = LockAnswer | { state: "free" };

type Fetch = typeof fetch;

/** This tab's ID: kept for the tab's life, so a reload still holds the save it held. */
export function deviceId(storage: Pick<Storage, "getItem" | "setItem"> | undefined = safeSession()): string {
  const stored = storage?.getItem("pokehd-device");
  if (stored && /^[0-9a-z]{8,32}$/.test(stored)) return stored;
  const id = Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => "0123456789abcdefghijklmnopqrstuvwxyz"[b % 36]).join("");
  storage?.setItem("pokehd-device", id);
  return id;
}

function safeSession(): Storage | undefined {
  try {
    return sessionStorage;
  } catch {
    return undefined;
  }
}

/** What another device sees this one called. */
export function deviceName(ua = navigator.userAgent, touch = navigator.maxTouchPoints): string {
  if (/iPhone/.test(ua)) return "iPhone";
  if (/iPad/.test(ua) || (/Macintosh/.test(ua) && touch > 1)) return "iPad";
  if (/Android/.test(ua)) return "Android";
  if (/Macintosh/.test(ua)) return "Mac";
  if (/Windows/.test(ua)) return "Windows PC";
  if (/CrOS/.test(ua)) return "Chromebook";
  return "another device";
}

export interface SaveLockOptions {
  fetch?: Fetch;
  device?: string;
  name?: string;
  beatMs?: number;
}

export class SaveLock {
  readonly key: string;
  readonly device: string;
  readonly name: string;
  readonly #fetch: Fetch;
  readonly #beatMs: number;
  #timer: ReturnType<typeof setInterval> | undefined;
  #stopped = false;

  constructor(key: string, options: SaveLockOptions = {}) {
    this.key = key;
    this.device = options.device ?? deviceId();
    this.name = options.name ?? deviceName();
    this.#fetch = options.fetch ?? ((...args) => fetch(...args));
    this.#beatMs = options.beatMs ?? LOCK_BEAT_MS;
  }

  /** One heartbeat. `take` asks to take the save over from the device that has it. */
  async beat(take = false): Promise<LockState> {
    try {
      const res = await this.#fetch(`/api/saves/${this.key}/lock`, {
        method: "POST",
        body: JSON.stringify({ device: this.device, name: this.name, ...(take ? { take } : {}) }),
        headers: { "content-type": "application/json" },
      });
      if (!res.ok) return { state: "free" }; // signed out, or an older server
      return parseLockAnswer(await res.json()) ?? { state: "free" };
    } catch {
      return { state: "free" }; // offline
    }
  }

  /**
   * Claims the save: resolves once this device may play it (held, or free). While another device
   * has it, `onBlocked` hears who, every heartbeat; it plays here once that device lets go, or
   * once `take()` has taken it over. `take()` asks at once.
   */
  claim(onBlocked: (state: LockState & { state: "in-use" | "waiting" }) => void): { done: Promise<LockState>; take(): void } {
    let taking = false;
    let wake = () => {};
    const done = (async () => {
      for (;;) {
        const state = await this.beat(taking);
        if (this.#stopped || state.state === "held" || state.state === "free") return state;
        // "lost": this device held it (a reload) and another is taking over; let it.
        if (state.state === "lost") await this.release();
        else onBlocked(state);
        // Waiting on a handover goes quicker than an idle check.
        await new Promise<void>((r) => {
          wake = r;
          setTimeout(r, taking ? 1000 : this.#beatMs);
        });
      }
    })();
    return {
      done,
      take: () => {
        taking = true;
        wake();
      },
    };
  }

  /**
   * Beats while the save is played. `onLost` hears if another device has it now (it took it over,
   * or this one went quiet long enough to lose it): the game must stop.
   */
  keep(onLost: (state: LockState & { state: "in-use" | "lost" }) => void): void {
    clearInterval(this.#timer);
    this.#timer = setInterval(() => {
      void this.beat().then((state) => {
        if (this.#stopped || this.#timer === undefined) return;
        if (state.state === "in-use" || state.state === "lost") {
          clearInterval(this.#timer);
          this.#timer = undefined;
          onLost(state);
        }
      });
    }, this.#beatMs);
  }

  /** Done with the save (or kept its progress for a takeover): another device may have it. */
  async release(beacon = false): Promise<void> {
    const url = `/api/saves/${this.key}/unlock`;
    const body = JSON.stringify({ device: this.device });
    if (beacon && typeof navigator !== "undefined" && navigator.sendBeacon?.(url, body)) return;
    await this.#fetch(url, { method: "POST", body, keepalive: true, headers: { "content-type": "application/json" } }).catch(() => {});
  }

  /** Stops beating. Letting go is `release()`. */
  stop(): void {
    this.#stopped = true;
    clearInterval(this.#timer);
    this.#timer = undefined;
  }
}
