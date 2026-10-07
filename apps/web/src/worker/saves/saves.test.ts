import { describe, expect, it } from "vitest";
import { MAX_SAVE_BYTES, SAVED_AT_HEADER, saveKey, savesApi, type SaveBucket } from "./saves.ts";

const ROM = "d7037c83e1ae5b39bde3c30787637ba1d4c48ce2";
const players: Record<string, { id: string }> = { "sam-token": { id: "sam" }, "alex-token": { id: "alex" } };

/** An in-memory bucket whose clock moves forward one second per write. */
function fakeBucket() {
  const objects = new Map<string, { body: ArrayBuffer; uploaded: Date }>();
  let now = 1_700_000_000_000;
  const bucket: SaveBucket = {
    async get(key) {
      const o = objects.get(key);
      return o ? { uploaded: o.uploaded, arrayBuffer: async () => o.body.slice(0) } : null;
    },
    async put(key, value) {
      const o = { body: value.slice(0), uploaded: new Date((now += 1000)) };
      objects.set(key, o);
      return { uploaded: o.uploaded };
    },
  };
  return { bucket, objects };
}

function setup() {
  const { bucket, objects } = fakeBucket();
  const api = savesApi<{ SAVES: SaveBucket }>(async (c) => players[c.req.header("x-test-session") ?? ""] ?? null);
  const call = (path: string, init: RequestInit & { as?: string } = {}) =>
    api.request(path, { ...init, headers: { ...(init.as ? { "x-test-session": `${init.as}-token` } : {}) } }, { SAVES: bucket });
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
});
