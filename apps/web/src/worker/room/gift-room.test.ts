// Gifts through the real Room Durable Object (Miniflare, via wrangler): one is stored while its
// receiver is away, and handed over on every connect until acknowledged.
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Gift, ServerMessage } from "@pokehd/protocol";
import { unstable_startWorker } from "wrangler";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const ADMIN_TOKEN = "test-admin-token";
type Worker = Awaited<ReturnType<typeof unstable_startWorker>>;

async function startWorker(): Promise<Worker> {
  const dir = mkdtempSync(join(tmpdir(), "pokehd-gift-"));
  const config = join(dir, "wrangler.json");
  writeFileSync(
    config,
    JSON.stringify({
      name: "pokehd-gift-test",
      main: new URL("../index.ts", import.meta.url).pathname,
      compatibility_date: "2026-10-01",
      durable_objects: {
        bindings: [
          { name: "DIRECTORY", class_name: "Directory" },
          { name: "ROOM", class_name: "Room" },
        ],
      },
      migrations: [{ tag: "v1", new_sqlite_classes: ["Directory", "Room"] }],
    }),
  );
  const worker = await unstable_startWorker({
    config,
    bindings: { ADMIN_TOKEN: { type: "plain_text", value: ADMIN_TOKEN } },
    dev: { server: { port: 0 }, inspector: false, persist: false, logLevel: "warn" },
  });
  await worker.ready;
  return worker;
}

async function signUp(base: URL, name: string) {
  const add = await fetch(new URL("/api/admin/players", base), {
    method: "POST",
    headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
    body: JSON.stringify({ email: `${name.toLowerCase()}@example.com`, name }),
  });
  const { link } = (await add.json()) as { link: string };
  const res = await fetch(new URL("/api/auth/verify", base), {
    method: "POST",
    body: JSON.stringify(Object.fromEntries(new URLSearchParams(new URL(link).hash.slice(1)))),
  });
  const { player } = (await res.json()) as { player: { id: string } };
  return { id: player.id, cookie: res.headers.get("set-cookie")!.split(";")[0]! };
}

/** A room connection that collects what it hears; `next(type)` waits for a message of that type. */
async function connect(base: URL, cookie: string) {
  const url = new URL("/api/room", base);
  url.protocol = "ws:";
  const ws = new WebSocket(url, { headers: { cookie } } as unknown as string[]);
  const heard: ServerMessage[] = [];
  const waiters: (() => void)[] = [];
  ws.addEventListener("message", (event) => {
    heard.push(JSON.parse(String(event.data)) as ServerMessage);
    waiters.splice(0).forEach((w) => w());
  });
  const next = async <T extends ServerMessage["type"]>(type: T, after = 0) => {
    for (;;) {
      const found = heard.slice(after).find((m) => m.type === type);
      if (found) return found as Extract<ServerMessage, { type: T }>;
      await new Promise<void>((resolve) => waiters.push(resolve));
    }
  };
  await next("welcome");
  return {
    heard,
    next,
    send: (message: object) => ws.send(JSON.stringify(message)),
    close: () => new Promise<void>((resolve) => {
      ws.addEventListener("close", () => resolve());
      ws.close();
    }),
  };
}

describe("gifts through the Room Durable Object (D20)", () => {
  let worker: Worker;
  let base: URL;
  beforeAll(async () => {
    worker = await startWorker();
    base = await worker.url;
  }, 120_000);
  afterAll(async () => {
    await worker?.dispose();
  });

  it("holds a gift for a friend who's away until they acknowledge it", async () => {
    const [sam, alex] = [await signUp(base, "Sam"), await signUp(base, "Alex")];
    const gift: Gift = { kind: "money", amount: 500 };

    const samConn = await connect(base, sam.cookie);
    samConn.send({ type: "gift", to: alex.id, id: "g1", gift });
    expect(await samConn.next("gift-stored")).toEqual({ type: "gift-stored", id: "g1" });
    await samConn.close();

    const first = await connect(base, alex.cookie);
    expect(await first.next("gift")).toEqual({ type: "gift", id: "g1", from: { id: sam.id, name: "Sam" }, gift });
    await first.close();

    // Not acknowledged (no save yet): it comes again, and goes once acknowledged.
    const second = await connect(base, alex.cookie);
    expect((await second.next("gift")).id).toBe("g1");
    second.send({ type: "gift-ack", id: "g1" });
    await second.close();

    const third = await connect(base, alex.cookie);
    // A presence round trip proves the room has handled the connect.
    third.send({ type: "presence", presence: null });
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(third.heard.filter((m) => m.type === "gift")).toEqual([]);
    await third.close();
  }, 60_000);
});
