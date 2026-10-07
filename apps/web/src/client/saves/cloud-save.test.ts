import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it } from "vitest";
import { savesApi, type SaveBucket } from "../../worker/saves/saves.ts";
import { closeDb } from "../idb.ts";
import { CloudBackup } from "./cloud-save.ts";
import { loadSave, openSaveSlot, storeSave } from "./save-store.ts";

const KEY = "d7037c83e1ae5b39bde3c30787637ba1d4c48ce2";
const sram = (seed: number) => Uint8Array.from({ length: 32768 }, (_, i) => (i * 31 + seed) & 0xff);

/** The real saves route over an in-memory bucket, as a `fetch` for one signed-in player. */
function server() {
  const objects = new Map<string, { body: ArrayBuffer; uploaded: Date }>();
  let now = 1_700_000_000_000;
  const SAVES: SaveBucket = {
    async get(key) {
      const o = objects.get(key);
      return o ? { uploaded: o.uploaded, arrayBuffer: async () => o.body.slice(0) } : null;
    },
    async put(key, body) {
      objects.set(key, { body: body.slice(0), uploaded: new Date((now += 1000)) });
      return { uploaded: objects.get(key)!.uploaded };
    },
  };
  let signedIn = true;
  const api = savesApi<{ SAVES: SaveBucket }>(async () => (signedIn ? { id: "sam" } : null));
  const fetch = (async (input: RequestInfo | URL, init?: RequestInit) =>
    api.request(String(input).replace("/api/saves", ""), init, { SAVES })) as typeof globalThis.fetch;
  return { fetch, objects, signOut: () => (signedIn = false) };
}

/** Each device is its own browser: a fresh IndexedDB. */
function device(fetch: typeof globalThis.fetch) {
  const db = new IDBFactory();
  const activate = () => {
    closeDb();
    globalThis.indexedDB = db;
  };
  activate();
  return { activate, backup: new CloudBackup(KEY, { fetch, delayMs: 0 }) };
}

beforeEach(() => closeDb());

describe("cloud backup", () => {
  it("restores a save made on one device on another", async () => {
    const { fetch } = server();
    const a = device(fetch);
    const slot = await openSaveSlot(KEY, a.backup);
    await slot.persist(sram(1));
    await a.backup.flush();
    expect(await a.backup.status()).toEqual({ kind: "in-sync" });

    const b = device(fetch);
    const status = await b.backup.status();
    expect(status.kind).toBe("newer");
    if (status.kind !== "newer") return;
    expect(status.cloud.sram).toEqual(sram(1));
    await b.backup.restore(status.cloud);
    expect(await loadSave(KEY)).toEqual(sram(1));
    expect(await b.backup.status()).toEqual({ kind: "in-sync" });
  });

  it("offers a restore only when another device saved since this one synced", async () => {
    const { fetch } = server();
    const a = device(fetch);
    a.backup.onSram(sram(1));
    await a.backup.flush();
    const b = device(fetch);
    const first = await b.backup.status();
    if (first.kind === "newer") await b.backup.restore(first.cloud);

    // B plays on and saves; A sees B's save as newer, B sees itself in sync.
    b.backup.onSram(sram(2));
    await b.backup.flush();
    expect(await b.backup.status()).toEqual({ kind: "in-sync" });
    a.activate();
    const onA = await a.backup.status();
    expect(onA.kind === "newer" && onA.cloud.sram).toEqual(sram(2));
  });

  it("treats identical bytes as in sync, and backs up a local save the cloud lacks", async () => {
    const { fetch, objects } = server();
    const a = device(fetch);
    await storeSave(KEY, sram(3));
    expect(await a.backup.status()).toEqual({ kind: "none" });
    expect(objects.size).toBe(1);
    const b = device(fetch);
    await storeSave(KEY, sram(3));
    expect(await b.backup.status()).toEqual({ kind: "in-sync" });
  });

  it("coalesces a burst of saves into one upload", async () => {
    const { fetch } = server();
    let puts = 0;
    const counting = ((input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "PUT") puts++;
      return fetch(input, init);
    }) as typeof globalThis.fetch;
    device(fetch);
    const backup = new CloudBackup(KEY, { fetch: counting, delayMs: 50 });
    for (let i = 0; i < 5; i++) backup.onSram(sram(i));
    await new Promise((r) => setTimeout(r, 100));
    await backup.flush();
    expect(puts).toBe(1);
  });

  it("stays quiet while signed out", async () => {
    const { fetch, objects, signOut } = server();
    signOut();
    const a = device(fetch);
    a.backup.onSram(sram(1));
    await a.backup.flush();
    expect(await a.backup.status()).toEqual({ kind: "signed-out" });
    a.backup.onSram(sram(2));
    await a.backup.flush();
    expect(objects.size).toBe(0);
  });

  it("reports offline when the request fails", async () => {
    device(fetch);
    const backup = new CloudBackup(KEY, { fetch: (() => Promise.reject(new TypeError("offline"))) as typeof fetch });
    expect(await backup.status()).toEqual({ kind: "offline" });
  });
});
