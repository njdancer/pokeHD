import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CloseCode, type Presence, type ServerMessage } from "@pokehd/protocol";
import { RoomClient, type RoomClientOptions, type RoomSocket } from "./client.ts";

const here: Presence = {
  mapId: 0,
  x: 5,
  y: 6,
  facing: "down",
  step: null,
  animFrame: 0,
  transport: "walk",
  mode: "overworld",
};

class FakeSocket implements RoomSocket {
  readyState = 0;
  sent: string[] = [];
  closedWith: number | undefined | null = null;
  onopen: RoomSocket["onopen"] = null;
  onmessage: RoomSocket["onmessage"] = null;
  onclose: RoomSocket["onclose"] = null;
  onerror: RoomSocket["onerror"] = null;
  send(data: string) {
    this.sent.push(data);
  }
  close(code?: number) {
    this.closedWith = code;
    this.readyState = 3;
  }
  // Server side:
  open() {
    this.readyState = 1;
    this.onopen?.({});
  }
  push(message: ServerMessage | string) {
    this.onmessage?.({ data: typeof message === "string" ? message : JSON.stringify(message) });
  }
  drop(code = 1006) {
    this.readyState = 3;
    this.onclose?.({ code });
  }
  get messages() {
    return this.sent.filter((s) => s !== "ping").map((s) => JSON.parse(s) as unknown);
  }
}

function setup(options: Partial<RoomClientOptions> = {}) {
  const sockets: FakeSocket[] = [];
  const client = new RoomClient({
    url: "ws://test/api/room",
    createSocket: () => {
      const s = new FakeSocket();
      sockets.push(s);
      return s;
    },
    checkSession: async () => true,
    random: () => 1,
    ...options,
  });
  const welcome = (s: FakeSocket, players: Extract<ServerMessage, { type: "welcome" }>["players"] = []) => {
    s.open();
    s.push({ type: "welcome", you: { id: "me", name: "ME" }, players });
  };
  return { client, sockets, welcome, last: () => sockets.at(-1)! };
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("RoomClient", () => {
  it("tracks friends through welcome, join, presence and leave", () => {
    const { client, last, welcome } = setup();
    client.connect();
    expect(client.store.getState().status).toBe("connecting");
    welcome(last(), [{ id: "sam", name: "SAM", presence: here }]);
    expect(client.store.getState()).toMatchObject({
      status: "open",
      you: { id: "me", name: "ME" },
      friends: { sam: { id: "sam", name: "SAM", presence: here } },
    });
    last().push({ type: "joined", player: { id: "alex", name: "ALEX" } });
    last().push({ type: "presence", id: "alex", presence: { ...here, x: 9 } });
    expect(client.store.getState().friends.alex?.presence?.x).toBe(9);
    last().push({ type: "left", id: "sam" });
    expect(Object.keys(client.store.getState().friends)).toEqual(["alex"]);
  });

  it("ignores frames that aren't server messages", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { client, last, welcome } = setup();
    client.connect();
    welcome(last());
    const before = client.store.getState();
    last().push(JSON.stringify({ type: "presence", id: "x", presence: { mapId: 999 } }));
    last().push("pong");
    expect(client.store.getState()).toBe(before);
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it("sends presence only when it changes, throttling progress within a step", () => {
    const { client, last, welcome } = setup({ presenceIntervalMs: 100 });
    client.connect();
    client.sendPresence(here); // before the welcome: held, then sent
    expect(last().messages).toEqual([]);
    welcome(last());
    expect(last().messages).toEqual([{ type: "presence", presence: here }]);

    client.sendPresence({ ...here });
    expect(last().messages).toHaveLength(1);

    // A step starts: sent at once, even inside the interval.
    const step = (progress: number): Presence => ({ ...here, step: { dx: 0, dy: 1, progress } });
    client.sendPresence(step(0));
    expect(last().messages).toHaveLength(2);
    // Progress within the step: coalesced, the latest goes out when the interval is up.
    client.sendPresence(step(0.25));
    client.sendPresence(step(0.5));
    expect(last().messages).toHaveLength(2);
    vi.advanceTimersByTime(100);
    expect(last().messages.at(-1)).toEqual({ type: "presence", presence: step(0.5) });
    expect(last().messages).toHaveLength(3);

    client.sendPresence(null);
    expect(last().messages.at(-1)).toEqual({ type: "presence", presence: null });
  });

  it("reconnects with backoff and resends presence after a drop", async () => {
    const { client, sockets, last, welcome } = setup({ backoffMs: 500, maxBackoffMs: 2000 });
    client.connect();
    welcome(last(), [{ id: "sam", name: "SAM", presence: here }]);
    client.sendPresence(here);

    last().drop();
    expect(client.store.getState()).toMatchObject({ status: "reconnecting", friends: {} });
    vi.advanceTimersByTime(499);
    expect(sockets).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(sockets).toHaveLength(2);

    // Failing again before the welcome doubles the delay (after the session check).
    last().drop();
    await vi.advanceTimersByTimeAsync(999);
    expect(sockets).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(sockets).toHaveLength(3);
    welcome(last());
    expect(client.store.getState().status).toBe("open");
    expect(last().messages).toEqual([{ type: "presence", presence: here }]);
  });

  it("caps the backoff", async () => {
    const { client, sockets, last } = setup({ backoffMs: 500, maxBackoffMs: 2000 });
    client.connect();
    for (let i = 0; i < 6; i++) {
      last().drop();
      await vi.advanceTimersByTimeAsync(2000);
    }
    expect(sockets).toHaveLength(7);
  });

  it("stops when the session is gone", async () => {
    const { client, sockets, last } = setup({ checkSession: async () => false });
    client.connect();
    last().drop();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(client.store.getState().status).toBe("signed-out");
    expect(sockets).toHaveLength(1);
  });

  it("stops when replaced by another tab", async () => {
    const { client, sockets, last, welcome } = setup();
    client.connect();
    welcome(last());
    last().drop(CloseCode.replaced);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(client.store.getState().status).toBe("replaced");
    expect(sockets).toHaveLength(1);
  });

  it("stops when the room says we were replaced, before the close arrives", async () => {
    const { client, sockets, last, welcome } = setup();
    client.connect();
    welcome(last());
    last().push({ type: "error", reason: "replaced" });
    expect(client.store.getState().status).toBe("replaced");
    last().drop(CloseCode.replaced);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(sockets).toHaveLength(1);
  });

  it("pings, and treats a silent connection as dropped", () => {
    const { client, sockets, last, welcome } = setup({ keepaliveMs: 1000 });
    client.connect();
    welcome(last());
    vi.advanceTimersByTime(1000);
    expect(last().sent.filter((s) => s === "ping")).toHaveLength(1);
    last().push("pong");
    vi.advanceTimersByTime(2000);
    expect(client.store.getState().status).toBe("open");
    vi.advanceTimersByTime(1000); // three seconds without a word
    expect(client.store.getState().status).toBe("reconnecting");
    expect(sockets[0]!.closedWith).not.toBeNull();
  });

  it("sends link messages and passes on everything it hears", () => {
    const { client, last, welcome } = setup();
    const heard: ServerMessage[] = [];
    const off = client.subscribe((m) => heard.push(m));
    client.connect();
    const link = { type: "link", to: "sam", message: { kind: "connect" } } as const;
    expect(client.send(link)).toBe(false); // not connected: dropped, not queued
    welcome(last());
    expect(client.send(link)).toBe(true);
    expect(last().messages).toEqual([link]);
    last().push({ type: "link", from: "sam", message: { kind: "nybble", value: 1 } });
    last().push({ type: "error", reason: "not-here", to: "alex" });
    expect(heard.slice(1)).toEqual([
      { type: "link", from: "sam", message: { kind: "nybble", value: 1 } },
      { type: "error", reason: "not-here", to: "alex" },
    ]);
    expect(heard[0]?.type).toBe("welcome");
    off();
    last().push({ type: "link", from: "sam", message: { kind: "cancel" } });
    expect(heard).toHaveLength(3);
  });

  it("routes presence sent through send() via the throttle", () => {
    const { client, last, welcome } = setup();
    client.connect();
    welcome(last());
    client.send({ type: "presence", presence: here });
    client.send({ type: "presence", presence: here });
    expect(last().messages).toEqual([{ type: "presence", presence: here }]);
  });

  it("close() stops for good", async () => {
    const { client, sockets, last, welcome } = setup();
    client.connect();
    welcome(last());
    client.close();
    expect(sockets[0]!.closedWith).toBe(1000);
    expect(client.store.getState().status).toBe("closed");
    await vi.advanceTimersByTimeAsync(60_000);
    expect(sockets).toHaveLength(1);
  });
});
