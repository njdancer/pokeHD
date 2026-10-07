// End to end: real RoomClients against the real Worker and Room Durable Object, run locally by
// wrangler (Miniflare). Covers p3-rooms-client's "two clients see each other" bar.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { unstable_startWorker } from "wrangler";
import type { Presence } from "@pokehd/protocol";
import { RoomClient, type RoomSocket, type RoomState } from "../../client/room/client.ts";

const ADMIN_TOKEN = "test-admin-token";
let worker: Awaited<ReturnType<typeof unstable_startWorker>>;
let base: URL;

beforeAll(async () => {
  // The real config, minus `assets` (the Vite plugin supplies the directory in dev and builds).
  const web = new URL("../../../", import.meta.url);
  const raw = await readFile(new URL("wrangler.jsonc", web), "utf8");
  const config = JSON.parse(raw.replace(/^\s*\/\/.*$/gm, "")) as Record<string, unknown>;
  delete config.assets;
  delete config.$schema;
  config.main = new URL("src/worker/index.ts", web).pathname;
  const tmp = new URL("node_modules/.tmp/", web);
  await mkdir(tmp, { recursive: true });
  const path = new URL("wrangler.room-test.json", tmp).pathname;
  await writeFile(path, JSON.stringify(config));
  worker = await unstable_startWorker({
    config: path,
    dev: { server: { port: 0 }, inspector: false, persist: false, watch: false, logLevel: "error" },
    bindings: { ADMIN_TOKEN: { type: "plain_text", value: ADMIN_TOKEN } },
  });
  await worker.ready;
  base = await worker.url;
}, 60_000);

afterAll(async () => {
  await worker?.dispose();
});

/** Makes an invite and joins with it; returns the session cookie. */
async function newPlayer(name: string): Promise<string> {
  const invite = await fetch(new URL("/api/admin/invites", base), {
    method: "POST",
    headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
    body: "{}",
  });
  const { code } = (await invite.json()) as { code: string };
  const join = await fetch(new URL("/api/join", base), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ code, name }),
  });
  expect(join.status).toBe(200);
  const cookie = join.headers.get("set-cookie")!.split(";")[0]!;
  expect(cookie).toMatch(/^__Host-pokehd-session=/);
  return cookie;
}

/** A client that sends `cookie` (as a browser would) and keeps its raw sockets for tests. */
function client(cookie: string) {
  const sockets: WebSocket[] = [];
  const c = new RoomClient({
    url: new URL("/api/room", base).href.replace(/^http/, "ws"),
    createSocket: (url) => {
      // Node's WebSocket (undici) takes headers; browsers send the cookie themselves.
      const ws = new WebSocket(url, { headers: { cookie } } as unknown as string[]);
      sockets.push(ws);
      return ws as unknown as RoomSocket;
    },
    checkSession: async () => (await fetch(new URL("/api/me", base), { headers: { cookie } })).ok,
    backoffMs: 20,
    random: () => 0,
  });
  return { client: c, sockets };
}

function until(c: RoomClient, check: (s: RoomState) => boolean): Promise<RoomState> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      off();
      reject(new Error(`timed out; state: ${JSON.stringify(c.store.getState())}`));
    }, 5000);
    const test = (s: RoomState) => {
      if (!check(s)) return;
      clearTimeout(timer);
      off();
      resolve(s);
    };
    const off = c.store.subscribe(test);
    queueMicrotask(() => test(c.store.getState()));
  });
}

const at = (x: number, y: number): Presence => ({
  mapId: 12,
  x,
  y,
  facing: "up",
  step: null,
  animFrame: 0,
  transport: "walk",
  mode: "overworld",
});

describe("two RoomClients in one room", () => {
  it("see each other's joins, presence, reconnects and leaves", async () => {
    const [samCookie, alexCookie] = await Promise.all([newPlayer("Sam"), newPlayer("Alex")]);
    const sam = client(samCookie);
    const alex = client(alexCookie);

    sam.client.sendPresence(at(3, 4)); // before connecting: goes out with the welcome
    sam.client.connect();
    const samState = await until(sam.client, (s) => s.status === "open");
    expect(samState.you?.name).toBe("Sam");
    const samId = samState.you!.id;

    alex.client.connect();
    const alexState = await until(alex.client, (s) => s.status === "open");
    const alexId = alexState.you!.id;
    // Alex arrives to find Sam already standing somewhere; Sam hears Alex join.
    await until(alex.client, (s) => s.friends[samId]?.presence?.x === 3);
    await until(sam.client, (s) => s.friends[alexId]?.name === "Alex");

    alex.client.sendPresence(at(7, 8));
    await until(sam.client, (s) => s.friends[alexId]?.presence?.y === 8);
    sam.client.sendPresence(null);
    await until(alex.client, (s) => !!s.friends[samId] && s.friends[samId].presence === null);

    // Alex's connection drops: Sam sees Alex leave and come back, at the same spot.
    alex.sockets[0]!.close();
    await until(alex.client, (s) => s.status === "reconnecting");
    await until(alex.client, (s) => s.status === "open");
    expect(alex.sockets).toHaveLength(2);
    await until(sam.client, (s) => s.friends[alexId]?.presence?.x === 7);

    alex.client.close();
    await until(sam.client, (s) => !s.friends[alexId]);
    sam.client.close();
  });

  it("gives way when the same player connects elsewhere", async () => {
    const cookie = await newPlayer("Jo");
    const first = client(cookie);
    first.client.connect();
    await until(first.client, (s) => s.status === "open");
    const second = client(cookie);
    second.client.connect();
    await until(second.client, (s) => s.status === "open");
    await until(first.client, (s) => s.status === "replaced");
    second.client.close();
    first.client.close();
  });

  it("stops at signed-out without a session", async () => {
    const stranger = client("__Host-pokehd-session=nope");
    stranger.client.connect();
    await until(stranger.client, (s) => s.status === "signed-out");
    expect(stranger.sockets).toHaveLength(1);
  });
});
