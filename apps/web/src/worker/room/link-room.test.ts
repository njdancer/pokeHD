// p3-link-net: two Game Boys trade and battle through the real Room Durable Object (Miniflare,
// via wrangler), each player's LinkPort paired by RoomLink over a WebSocket, with 200 ms added
// on every message each way. Repeats the p3-link spike's checks.
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setImmediate } from "node:timers/promises";
import { LinkPort, type GameBoy } from "@pokehd/emu";
import {
  linkScenarioReady,
  makeParty,
  PLAYERS,
  runLink,
  setupLinkScenario,
  type Kind,
} from "@pokehd/emu/link-scenario";
import type { ClientMessage, ServerMessage } from "@pokehd/protocol";
import { unstable_startWorker } from "wrangler";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RoomLink, type RoomConnection } from "../../client/room/link.ts";

const DELAY_MS = 200;
const ADMIN_TOKEN = "test-admin-token";

type Worker = Awaited<ReturnType<typeof unstable_startWorker>>;

/** The app's Worker with its Durable Objects, local and in memory. */
async function startWorker(): Promise<Worker> {
  // A config of our own: the app's wrangler.jsonc carries Vite's asset settings.
  const dir = mkdtempSync(join(tmpdir(), "pokehd-link-"));
  const config = join(dir, "wrangler.json");
  writeFileSync(
    config,
    JSON.stringify({
      name: "pokehd-link-test",
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

/** A player added by the admin and signed in with their link: their ID and session cookie. */
async function join_(base: URL, name: string) {
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
  const cookie = res.headers.get("set-cookie")!.split(";")[0]!;
  return { id: player.id, cookie };
}

/**
 * A room connection whose outbound messages leave `DELAY_MS` of simulated time after they're
 * sent, and whose inbound ones are also held `DELAY_MS`: `flush(now)` sends and delivers what's
 * due. (The real socket adds its own, much smaller, latency on top.)
 */
async function connect(base: URL, cookie: string) {
  const url = new URL("/api/room", base);
  url.protocol = "ws:";
  // Node's WebSocket (undici) takes headers as an extension; browsers send the cookie themselves.
  const ws = new WebSocket(url, { headers: { cookie } } as unknown as string[]);
  const listeners = new Set<(message: ServerMessage) => void>();
  const inbox: { at: number; message: ServerMessage }[] = [];
  const outbox: { at: number; message: ClientMessage }[] = [];
  let clock = 0;
  const welcome = new Promise<void>((resolve, reject) => {
    ws.addEventListener("error", (e) => reject(new Error(`WebSocket error: ${(e as ErrorEvent).message}`)));
    ws.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data)) as ServerMessage;
      if (message.type === "welcome") resolve();
      if (message.type === "error") throw new Error(`Room error: ${JSON.stringify(message)}`);
      inbox.push({ at: clock + DELAY_MS, message });
    });
  });
  await welcome;
  const room: RoomConnection = {
    send: (message) => outbox.push({ at: clock + DELAY_MS, message }),
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  return {
    room,
    flush(now: number) {
      clock = now;
      while (outbox.length && outbox[0]!.at <= now) ws.send(JSON.stringify(outbox.shift()!.message));
      while (inbox.length && inbox[0]!.at <= now) {
        const { message } = inbox.shift()!;
        for (const listener of listeners) listener(message);
      }
    },
    close: () => ws.close(),
  };
}

describe.skipIf(!linkScenarioReady)("link cable through the room", () => {
  let worker: Worker;
  let gbs: [GameBoy, GameBoy];
  let rom: Uint8Array;
  let reset: (kind: Kind) => void;
  let players: { id: string; cookie: string }[];

  beforeAll(async () => {
    ({ gbs, rom, reset } = await setupLinkScenario());
    worker = await startWorker();
    const base = await worker.url;
    players = [await join_(base, "Alice"), await join_(base, "Bob")];
  }, 180_000);

  afterAll(async () => {
    await worker?.dispose();
  });

  /** Both players connect to the room, pick each other at the receptionist and play `kind`. */
  async function play(kind: Kind) {
    const base = await worker.url;
    const conns = await Promise.all(players.map((p) => connect(base, p.cookie)));
    const ports: (LinkPort | undefined)[] = [undefined, undefined];
    const picks: string[][] = [[], []];
    const links = gbs.map((gb, i) => {
      const link = new RoomLink({
        room: conns[i]!.room,
        me: players[i]!.id,
        open: (options) => {
          ports[i]?.dispose();
          const port = new LinkPort(gb, options);
          ports[i] = port;
          return { receive: (m) => port.receive(m), close: () => port.dispose() };
        },
      });
      // The friend picker: pick the other player as soon as the game asks (between frames, as
      // a click would be; in the browser the port's messages arrive asynchronously anyway).
      let visit = 0;
      link.subscribe(() => {
        if (link.state.status !== "choosing" || link.state.visit === visit) return;
        visit = link.state.visit;
        const friend = players[1 - i]!.id;
        picks[i]!.push(friend);
        queueMicrotask(() => link.choose(friend));
      });
      return link;
    });
    try {
      const run = await runLink(gbs, kind, async (now) => {
        for (const conn of conns) conn.flush(now);
        await setImmediate(); // let the sockets' events in
      });
      return { ...run, picks, sent: ports.map((p) => p?.stats.sent ?? 0) };
    } finally {
      for (const link of links) link.dispose();
      for (const conn of conns) conn.close();
    }
  }

  it("trades first mons, each arriving byte for byte as sent", async () => {
    reset("trade");
    const sent = PLAYERS.map((p) => [...makeParty(rom, p.mons, p.id)[0]!.struct]);
    const { results, picks } = await play("trade");
    expect(picks).toEqual([[players[1]!.id], [players[0]!.id]]);
    results.forEach((res, i) => {
      expect(res.party).toEqual([PLAYERS[i as 0 | 1].mons[1]!.species, PLAYERS[1 - i]!.mons[0]!.species]);
      expect(res.received).toEqual(sent[1 - i]);
    });
  }, 300_000);

  it("battles until exactly one mon faints, both sides agreeing on the HP", async () => {
    reset("battle");
    const { results } = await play("battle");
    const [a, b] = results.map((res) => res.hp!);
    expect(a).toEqual([b![1], b![0]]);
    expect(a![0] === 0).not.toBe(a![1] === 0);
  }, 300_000);
});
