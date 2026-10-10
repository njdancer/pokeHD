import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { memoryBucket } from "../../worker/saves/memory-bucket.ts";
import { savesApi, type SaveBucket } from "../../worker/saves/saves.ts";
import { closeDb } from "../idb.ts";
import { CloudBackup } from "./cloud-save.ts";
import { loadSave, openSaveSlot, storeSave } from "./save-store.ts";

const KEY = "d7037c83e1ae5b39bde3c30787637ba1d4c48ce2";
const sram = (seed: number) => Uint8Array.from({ length: 32768 }, (_, i) => (i * 31 + seed) & 0xff);

/** The real saves route over an in-memory bucket, as a `fetch` for one signed-in player. */
function server() {
  const { bucket: SAVES, objects } = memoryBucket();
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

    // B plays on and saves (stored, then backed up, as a save slot does); A sees B's save as
    // newer, B sees itself in sync.
    await storeSave(KEY, sram(2));
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

  it("sends a save made offline with the next flush", async () => {
    const { fetch, objects } = server();
    let online = false;
    const flaky = ((input: RequestInfo | URL, init?: RequestInit) => (online ? fetch(input, init) : Promise.reject(new TypeError("offline")))) as typeof globalThis.fetch;
    device(fetch);
    const backup = new CloudBackup(KEY, { fetch: flaky, delayMs: 0 });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    backup.onSram(sram(1));
    await backup.flush();
    warn.mockRestore();
    online = true;
    await backup.flush();
    expect(new Uint8Array(objects.values().next().value!.body)).toEqual(sram(1));
  });

  it("sends a save this device made since it last synced, at start-up", async () => {
    const { fetch, objects } = server();
    const a = device(fetch);
    const slot = await openSaveSlot(KEY, a.backup, null);
    await slot.persist(sram(1));
    await a.backup.flush();
    // Saved while signed out (or offline, and then the page closed): the cloud never heard.
    await storeSave(KEY, sram(2));
    expect(await a.backup.status()).toEqual({ kind: "in-sync" });
    expect(new Uint8Array(objects.values().next().value!.body)).toEqual(sram(2));
  });
});
