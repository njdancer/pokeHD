import { describe, expect, it } from "vitest";
import {
  HISTORY_KEEP,
  MAX_SAVE_BYTES,
  SAVE_SHA1_HEADER,
  SAVED_AT_HEADER,
  STATE_SHA1_HEADER,
  saveKey,
  savesApi,
  type SaveBucket,
} from "./saves.ts";
import { memoryBucket } from "./memory-bucket.ts";

const ROM = "d7037c83e1ae5b39bde3c30787637ba1d4c48ce2";
const players: Record<string, { id: string }> = { "sam-token": { id: "sam" }, "alex-token": { id: "alex" } };

function setup() {
  const { bucket, objects } = memoryBucket();
  const api = savesApi<{ SAVES: SaveBucket }>(async (c) => players[c.req.header("x-test-session") ?? ""] ?? null);
  const call = (path: string, init: RequestInit & { as?: string } = {}) =>
    api.request(
      path,
      { ...init, headers: { ...(init.headers as Record<string, string>), ...(init.as ? { "x-test-session": `${init.as}-token` } : {}) } },
      { SAVES: bucket },
    );
  return { call, objects };
}

const sram = (seed: number, length = MAX_SAVE_BYTES) => Uint8Array.from({ length }, (_, i) => (i * 7 + seed) & 0xff);

describe("saves API", () => {
  it("needs a signed-in player", async () => {
    const { call, objects } = setup();
    expect((await call(`/${ROM}`)).status).toBe(401);
    expect((await call(`/${ROM}`, { method: "PUT", body: sram(1) })).status).toBe(401);
    expect((await call(`/${ROM}`, { method: "PUT", body: sram(1), as: "nobody" })).status).toBe(401);
    expect(objects.size).toBe(0);
  });

  it("round-trips a save with the server's timestamp", async () => {
    const { call } = setup();
    expect((await call(`/${ROM}`, { as: "sam" })).status).toBe(404);
    const put = await call(`/${ROM}`, { method: "PUT", body: sram(1), as: "sam" });
    expect(put.status).toBe(200);
    const { savedAt } = (await put.json()) as { savedAt: number };
    const got = await call(`/${ROM}`, { as: "sam" });
    expect(got.status).toBe(200);
    expect(Number(got.headers.get(SAVED_AT_HEADER))).toBe(savedAt);
    expect(new Uint8Array(await got.arrayBuffer())).toEqual(sram(1));
  });

  it("is last-writer-wins, with a later timestamp each write", async () => {
    const { call } = setup();
    const first = (await (await call(`/${ROM}`, { method: "PUT", body: sram(1), as: "sam" })).json()) as { savedAt: number };
    const second = (await (await call(`/${ROM}`, { method: "PUT", body: sram(2), as: "sam" })).json()) as { savedAt: number };
    expect(second.savedAt).toBeGreaterThan(first.savedAt);
    expect(new Uint8Array(await (await call(`/${ROM}`, { as: "sam" })).arrayBuffer())).toEqual(sram(2));
  });

  it("keeps each player's saves apart", async () => {
    const { call, objects } = setup();
    await call(`/${ROM}`, { method: "PUT", body: sram(1), as: "sam" });
    expect((await call(`/${ROM}`, { as: "alex" })).status).toBe(404);
    expect([...objects.keys()]).toEqual([saveKey("sam", ROM)]);
  });

  it("caps the size at 32 KB and refuses empty bodies", async () => {
    const { call, objects } = setup();
    expect((await call(`/${ROM}`, { method: "PUT", body: sram(1, MAX_SAVE_BYTES + 1), as: "sam" })).status).toBe(413);
    expect((await call(`/${ROM}`, { method: "PUT", body: new Uint8Array(0), as: "sam" })).status).toBe(400);
    expect(objects.size).toBe(0);
    expect((await call(`/${ROM}`, { method: "PUT", body: sram(1, 8192), as: "sam" })).status).toBe(200);
  });

  it("only takes a SHA-1 as the ROM key", async () => {
    const { call } = setup();
    expect((await call("/not-a-sha", { as: "sam" })).status).toBe(400);
    expect((await call(`/${ROM.toUpperCase()}`, { method: "PUT", body: sram(1), as: "sam" })).status).toBe(400);
    expect((await call(`/..%2F${ROM}`, { as: "sam" })).status).toBe(400);
  });

  it("keeps the latest resume point with the SHA-1s it was sent with", async () => {
    const { call } = setup();
    const a = "a".repeat(40);
    const b = "b".repeat(40);
    expect((await call(`/${ROM}/resume`, { as: "sam" })).status).toBe(404);
    const bad = await call(`/${ROM}/resume`, { method: "PUT", body: sram(1, 100), as: "sam", headers: { [SAVE_SHA1_HEADER]: "x" } });
    expect(bad.status).toBe(400);
    const headers = { [SAVE_SHA1_HEADER]: a, [STATE_SHA1_HEADER]: b };
    expect((await call(`/${ROM}/resume`, { method: "PUT", body: sram(1, 100), headers })).status).toBe(401);
    expect((await call(`/${ROM}/resume`, { method: "PUT", body: sram(1, 100), as: "sam", headers })).status).toBe(200);
    const got = await call(`/${ROM}/resume`, { as: "sam" });
    expect(got.headers.get(SAVE_SHA1_HEADER)).toBe(a);
    expect(got.headers.get(STATE_SHA1_HEADER)).toBe(b);
    expect(new Uint8Array(await got.arrayBuffer())).toEqual(sram(1, 100));
    // Another player's is their own.
    expect((await call(`/${ROM}/resume`, { as: "alex" })).status).toBe(404);
  });

  it("keeps the newest earlier saves, newest first", async () => {
    const { call } = setup();
    const at = (i: number) => 1_760_000_000_000 + i * 60_000;
    for (let i = 0; i < HISTORY_KEEP + 3; i++) {
      const reason = i === 5 ? "replaced" : "save";
      const res = await call(`/${ROM}/history?reason=${reason}&at=${at(i)}`, { method: "POST", body: sram(i), as: "sam" });
      expect(res.status).toBe(200);
    }
    const { saves } = (await (await call(`/${ROM}/history`, { as: "sam" })).json()) as {
      saves: { id: string; savedAt: number; reason: string }[];
    };
    expect(saves).toHaveLength(HISTORY_KEEP);
    expect(saves[0]!.savedAt).toBe(at(HISTORY_KEEP + 2));
    expect(saves.at(-1)!.savedAt).toBe(at(3));
    const one = await call(`/${ROM}/history/${saves[0]!.id}`, { as: "sam" });
    expect(new Uint8Array(await one.arrayBuffer())).toEqual(sram(HISTORY_KEEP + 2));
    expect((await call(`/${ROM}/history/../x`, { as: "sam" })).status).not.toBe(200);
    expect((await call(`/${ROM}/history?reason=Bad!&at=${at(0)}`, { method: "POST", body: sram(1), as: "sam" })).status).toBe(400);
    expect(await (await call(`/${ROM}/history`, { as: "alex" })).json()).toEqual({ saves: [] });
  });

  it("keeps each slot's save on its own key", async () => {
    const { call, objects } = setup();
    const other = `${ROM}-ab12cd34`;
    await call(`/${ROM}`, { method: "PUT", body: sram(1), as: "sam" });
    await call(`/${other}`, { method: "PUT", body: sram(2), as: "sam" });
    expect(new Uint8Array(await (await call(`/${other}`, { as: "sam" })).arrayBuffer())).toEqual(sram(2));
    expect(new Uint8Array(await (await call(`/${ROM}`, { as: "sam" })).arrayBuffer())).toEqual(sram(1));
    expect(objects.has(saveKey("sam", other))).toBe(true);
    expect((await call(`/${ROM}-main`, { as: "sam" })).status).toBe(400);
    expect((await call(`/${ROM}-AB12CD34`, { as: "sam" })).status).toBe(400);
  });

  it("merges slot lists instead of replacing them", async () => {
    const { call } = setup();
    const meta = (id: string, createdAt: number) => ({ id, createdAt, updatedAt: createdAt, playedAt: createdAt });
    const put = (slots: unknown[], as = "sam") =>
      call(`/${ROM}/slots`, { method: "PUT", body: JSON.stringify({ slots }), as, headers: { "content-type": "application/json" } });
    expect(await (await call(`/${ROM}/slots`, { as: "sam" })).json()).toEqual({ slots: [] });
    await put([meta("main", 0), meta("aaaaaaaa", 5)]);
    // A device that never saw "aaaaaaaa" can't drop it.
    const merged = (await (await put([meta("main", 0), meta("bbbbbbbb", 7)])).json()) as { slots: { id: string }[] };
    expect(merged.slots.map((s) => s.id)).toEqual(["main", "aaaaaaaa", "bbbbbbbb"]);
    expect(((await (await call(`/${ROM}/slots`, { as: "sam" })).json()) as { slots: unknown[] }).slots).toHaveLength(3);
    expect(await (await call(`/${ROM}/slots`, { as: "alex" })).json()).toEqual({ slots: [] });
    expect((await put([{ id: "../../x", createdAt: 1, updatedAt: 1, playedAt: 1 }])).status).toBe(400);
    expect((await call(`/${ROM}/slots`, { method: "PUT", body: "{", as: "sam" })).status).toBe(400);
    expect((await call(`/${ROM}-ab12cd34/slots`, { as: "sam" })).status).toBe(400);
    expect((await call(`/${ROM}/slots`)).status).toBe(401);
  });
});
