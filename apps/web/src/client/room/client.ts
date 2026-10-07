// The connection to the shared world (p3-rooms-client): one WebSocket to `/api/room`, kept open
// with reconnects, and a vanilla Zustand store of everyone else's presence. Framework-free, so
// the game loop can call `sendPresence` every frame and the engine can subscribe to the store
// without React.
import {
  CloseCode,
  parseServerMessage,
  type ClientMessage,
  type PlayerInfo,
  type Presence,
  type ServerMessage,
} from "@pokehd/protocol";
import { createStore, type StoreApi } from "zustand/vanilla";

/**
 * - `connecting`: the first connection is opening.
 * - `open`: connected and welcomed; `friends` is live.
 * - `reconnecting`: the connection dropped and a retry is scheduled or opening.
 * - `signed-out`: the room refused us and `/api/me` says there's no session; send them to /join.
 * - `replaced`: the same player connected from another tab or device. We don't fight it.
 * - `closed`: `close()` was called (or never connected).
 */
export type RoomStatus = "connecting" | "open" | "reconnecting" | "signed-out" | "replaced" | "closed";

export interface Friend extends PlayerInfo {
  /** Null while they're somewhere without a ghost (title screen, not playing yet). */
  presence: Presence | null;
}

export interface RoomState {
  status: RoomStatus;
  /** Who the room says we are; null until the first welcome. */
  you: PlayerInfo | null;
  /** Everyone else in the room right now, by player ID. Emptied while disconnected. */
  friends: Readonly<Record<string, Friend>>;
}

/** The subset of the browser WebSocket the client uses, so tests can pass their own. */
export interface RoomSocket {
  readonly readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  onopen: ((ev: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onclose: ((ev: { code: number }) => void) | null;
  onerror: ((ev: unknown) => void) | null;
}

export interface RoomClientOptions {
  /** Defaults to `/api/room` on this page's host. */
  url?: string;
  /** Defaults to `new WebSocket(url)`; the browser sends the session cookie itself. */
  createSocket?: (url: string) => RoomSocket;
  /** After a connection fails before its welcome: is there still a session? Defaults to `/api/me`. */
  checkSession?: () => Promise<boolean>;
  /** First retry delay; doubles per failed attempt up to `maxBackoffMs`, with jitter. */
  backoffMs?: number;
  maxBackoffMs?: number;
  /** Presence changes within one step (progress, animation frame) go out at most this often. */
  presenceIntervalMs?: number;
  /** How often to ping; a connection silent for two intervals is treated as dropped. */
  keepaliveMs?: number;
  random?: () => number;
}

const OPEN = 1;

export class RoomClient {
  readonly store: StoreApi<RoomState>;

  readonly #url: string;
  readonly #createSocket: (url: string) => RoomSocket;
  readonly #checkSession: () => Promise<boolean>;
  readonly #backoffMs: number;
  readonly #maxBackoffMs: number;
  readonly #presenceIntervalMs: number;
  readonly #keepaliveMs: number;
  readonly #random: () => number;

  #socket: RoomSocket | null = null;
  #welcomed = false;
  #attempt = 0;
  #stopped = true;
  #retryTimer: ReturnType<typeof setTimeout> | null = null;
  #keepaliveTimer: ReturnType<typeof setInterval> | null = null;
  #lastHeard = 0;

  /** The presence the game last reported, and what the room last heard from us. */
  #presence: Presence | null = null;
  #sent: Presence | null = null;
  #sentJson = "null";
  #sentAt = -Infinity;
  #presenceTimer: ReturnType<typeof setTimeout> | null = null;

  readonly #listeners = new Set<(message: ServerMessage) => void>();

  constructor(options: RoomClientOptions = {}) {
    this.#url = options.url ?? defaultUrl();
    this.#createSocket = options.createSocket ?? ((url) => new WebSocket(url) as unknown as RoomSocket);
    this.#checkSession = options.checkSession ?? defaultCheckSession;
    this.#backoffMs = options.backoffMs ?? 500;
    this.#maxBackoffMs = options.maxBackoffMs ?? 30_000;
    this.#presenceIntervalMs = options.presenceIntervalMs ?? 100;
    this.#keepaliveMs = options.keepaliveMs ?? 25_000;
    this.#random = options.random ?? Math.random;
    this.store = createStore<RoomState>(() => ({ status: "closed", you: null, friends: {} }));
  }

  /** Opens the connection (and keeps it open) until `close()`. Calling it again is harmless. */
  connect(): void {
    if (!this.#stopped) return;
    this.#stopped = false;
    this.#attempt = 0;
    this.store.setState({ status: "connecting" });
    this.#open();
  }

  /** Closes the connection for good (until `connect()` again). */
  close(): void {
    this.#stopped = true;
    this.#clearRetry();
    this.#drop(1000);
    this.store.setState({ status: "closed", friends: {} });
  }

  /**
   * Reports our presence (null hides our ghost). Call it whenever the game state is read, as
   * often as every frame: only changes are sent, and changes within a step are throttled.
   */
  sendPresence(presence: Presence | null): void {
    this.#presence = presence;
    this.#flushPresence();
  }

  /**
   * Sends a message to the room (link cable messages, for p3-link-net). False if we're not
   * connected and welcomed: nothing is queued, so a link session sees the gap.
   */
  send(message: ClientMessage): boolean {
    if (message.type === "presence") {
      this.sendPresence(message.presence);
      return this.#welcomed;
    }
    return this.#send(message);
  }

  /** Hears every message from the room, after the store has applied it. Returns the unsubscribe. */
  subscribe(listener: (message: ServerMessage) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  #open(): void {
    this.#welcomed = false;
    const socket = this.#createSocket(this.#url);
    this.#socket = socket;
    socket.onopen = () => {
      this.#lastHeard = Date.now();
      this.#keepaliveTimer = setInterval(() => this.#keepalive(), this.#keepaliveMs);
    };
    socket.onmessage = (ev) => {
      this.#lastHeard = Date.now();
      if (ev.data === "pong") return;
      const message = parseServerMessage(ev.data);
      if (message) {
        this.#receive(message);
        for (const listener of this.#listeners) listener(message);
      } else console.warn("room: ignored a frame that isn't a server message");
    };
    socket.onclose = (ev) => {
      if (this.#socket === socket) this.#closed(ev.code);
    };
    // An error is always followed by a close, which does the work.
    socket.onerror = () => {};
  }

  #receive(message: ServerMessage): void {
    switch (message.type) {
      case "welcome": {
        this.#welcomed = true;
        this.#attempt = 0;
        const friends: Record<string, Friend> = {};
        for (const p of message.players) friends[p.id] = { id: p.id, name: p.name, presence: p.presence };
        this.store.setState({ status: "open", you: message.you, friends });
        // A fresh connection starts with no presence on the server; resend ours.
        this.#sent = null;
        this.#sentJson = "null";
        this.#sentAt = -Infinity;
        this.#flushPresence();
        return;
      }
      case "joined":
        this.#setFriends((f) => ({ ...f, [message.player.id]: { ...message.player, presence: null } }));
        return;
      case "left":
        this.#setFriends((f) => {
          const { [message.id]: _, ...rest } = f;
          return rest;
        });
        return;
      case "presence":
        this.#setFriends((f) => {
          const friend = f[message.id];
          return friend ? { ...f, [message.id]: { ...friend, presence: message.presence } } : f;
        });
        return;
      case "link":
        return; // for subscribers
      case "error":
        if (message.reason === "replaced") this.#replaced();
        else if (message.reason === "bad-message") console.warn("room: the server rejected a message");
        return;
    }
  }

  #closed(code: number): void {
    const welcomed = this.#welcomed;
    this.#drop();
    if (this.#stopped) return;
    if (code === CloseCode.replaced) return this.#replaced();
    this.store.setState({ status: "reconnecting", friends: {} });
    if (welcomed) {
      this.#scheduleRetry();
      return;
    }
    // Refused before the welcome: maybe the session ended (the upgrade got a 401, which
    // browsers don't show us). Ask; if the check itself fails, assume a network problem.
    void this.#checkSession().then(
      (signedIn) => {
        if (this.#stopped) return;
        if (signedIn) return this.#scheduleRetry();
        this.#stopped = true;
        this.store.setState({ status: "signed-out", you: null });
      },
      () => {
        if (!this.#stopped) this.#scheduleRetry();
      },
    );
  }

  /** Another tab or device took over as this player. We don't fight it. */
  #replaced(): void {
    this.#stopped = true;
    this.#drop();
    this.store.setState({ status: "replaced", friends: {} });
  }

  #scheduleRetry(): void {
    this.#clearRetry();
    const base = Math.min(this.#maxBackoffMs, this.#backoffMs * 2 ** this.#attempt);
    this.#attempt++;
    // Full delay at most, half at least, so friends dropped together don't return in lockstep.
    const delay = base * (0.5 + this.#random() * 0.5);
    this.#retryTimer = setTimeout(() => {
      this.#retryTimer = null;
      if (!this.#stopped) this.#open();
    }, delay);
  }

  #clearRetry(): void {
    if (this.#retryTimer !== null) clearTimeout(this.#retryTimer);
    this.#retryTimer = null;
  }

  /** Forgets the current socket (closing it if it's still open) and its timers. */
  #drop(code?: number): void {
    const socket = this.#socket;
    this.#socket = null;
    this.#welcomed = false;
    if (this.#keepaliveTimer !== null) clearInterval(this.#keepaliveTimer);
    if (this.#presenceTimer !== null) clearTimeout(this.#presenceTimer);
    this.#keepaliveTimer = this.#presenceTimer = null;
    if (socket) {
      socket.onopen = socket.onmessage = socket.onclose = socket.onerror = null;
      try {
        socket.close(code);
      } catch {
        // Already closed.
      }
    }
  }

  #keepalive(): void {
    const socket = this.#socket;
    // Closing: the server started the close handshake (e.g. we were replaced), and the close
    // event will say why. Reconnecting now could replace the tab that replaced us.
    if (!socket || socket.readyState !== OPEN) return;
    if (Date.now() - this.#lastHeard > 2 * this.#keepaliveMs) {
      // Silent too long: a dead connection the browser hasn't noticed (sleep, network change).
      this.#closed(1006);
      return;
    }
    socket.send("ping");
  }

  #flushPresence(): void {
    if (!this.#welcomed) return;
    const json = JSON.stringify(this.#presence);
    if (json === this.#sentJson) return;
    const now = Date.now();
    // A new step, map, facing or mode goes out at once; progress within a step is throttled.
    const urgent = stepKey(this.#presence) !== stepKey(this.#sent);
    const wait = this.#sentAt + this.#presenceIntervalMs - now;
    if (urgent || wait <= 0) {
      if (this.#presenceTimer !== null) clearTimeout(this.#presenceTimer);
      this.#presenceTimer = null;
      if (this.#send({ type: "presence", presence: this.#presence })) {
        this.#sent = JSON.parse(json) as Presence | null; // a copy, in case the caller reuses its object
        this.#sentJson = json;
        this.#sentAt = now;
      }
    } else if (this.#presenceTimer === null) {
      this.#presenceTimer = setTimeout(() => {
        this.#presenceTimer = null;
        this.#flushPresence();
      }, wait);
    }
  }

  #send(message: ClientMessage): boolean {
    const socket = this.#socket;
    if (!socket || !this.#welcomed || socket.readyState !== OPEN) return false;
    socket.send(JSON.stringify(message));
    return true;
  }

  #setFriends(update: (friends: RoomState["friends"]) => RoomState["friends"]): void {
    const friends = this.store.getState().friends;
    const next = update(friends);
    if (next !== friends) this.store.setState({ friends: next });
  }
}

/** Everything about a presence except progress through the current step and its frame. */
function stepKey(p: Presence | null): string {
  if (!p) return "null";
  return JSON.stringify([p.mapId, p.x, p.y, p.facing, p.step?.dx, p.step?.dy, !!p.step, p.transport, p.mode]);
}

function defaultUrl(): string {
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${location.host}/api/room`;
}

async function defaultCheckSession(): Promise<boolean> {
  const res = await fetch("/api/me", { credentials: "same-origin" });
  if (res.status === 401) return false;
  if (!res.ok) throw new Error(`/api/me: ${res.status}`);
  return true;
}
