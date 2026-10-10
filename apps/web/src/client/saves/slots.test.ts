import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it } from "vitest";
import { memoryBucket } from "../../worker/saves/memory-bucket.ts";
import { saveKey, savesApi, type SaveBucket } from "../../worker/saves/saves.ts";
import { closeDb, run } from "../idb.ts";
import { readResumePoint, storeResumePoint } from "./resume-store.ts";
import { loadSave, storeSave } from "./save-store.ts";
import { binSlot, createSlot, duplicateSlot, loadSlots, markPlayed, renameSlot, resumeSlot, slotKey, unbinSlot } from "./slots.ts";

const ROM = "d7037c83e1ae5b39bde3c30787637ba1d4c48ce2";
const sram = (seed: number) => Uint8Array.from({ length: 32768 }, (_, i) => (i * 31 + seed) & 0xff);

/** The real saves route over an in-memory bucket, as a `fetch` for one player. */
function server() {
  const { bucket: SAVES, objects } = memoryBucket();
  let signedIn = true;
  const api = savesApi<{ SAVES: SaveBucket }>(async () => (signedIn ? { id: "sam" } : null));
  const fetch = (async (input: RequestInfo | URL, init?: RequestInit) =>
    api.request(String(input).replace("/api/saves", ""), init, { SAVES })) as typeof globalThis.fetch;
  return { fetch, objects, signOut: () => (signedIn = false) };
}
const offline = (async () => {
  throw new TypeError("Failed to fetch");
}) as typeof globalThis.fetch;

/** Each device is its own browser: a fresh IndexedDB. */
function device() {
  const db = new IDBFactory();
  const activate = () => {
    closeDb();
    globalThis.indexedDB = db;
  };
  activate();
  return { activate };
}

beforeEach(() => device());

describe("save slots", () => {
  it("lists the save a player already had as the main slot, without moving it", async () => {
    await storeSave(ROM, sram(1));
    const index = await loadSlots(ROM, offline);
    expect(index.slots.map((s) => s.id)).toEqual(["main"]);
    expect(slotKey(ROM, "main")).toBe(ROM);
    expect(await loadSave(ROM)).toEqual(sram(1));
    expect((await resumeSlot(ROM, offline))?.id).toBe("main");
  });

  it("has no slots for a player with no save", async () => {
    expect((await loadSlots(ROM, offline)).slots).toEqual([]);
    expect(await resumeSlot(ROM, offline)).toBeNull();
  });

  it("finds the main slot from the cloud on a new device", async () => {
    const { fetch, objects } = server();
    objects.set(saveKey("sam", ROM), { body: sram(1).buffer, uploaded: new Date() });
    expect((await loadSlots(ROM, fetch)).slots.map((s) => s.id)).toEqual(["main"]);
  });

  it("makes, names, bins and brings back slots, and resumes the one played last", async () => {
    await storeSave(ROM, sram(1));
    await markPlayed(ROM, "main", offline);
    const fresh = await createSlot(ROM, "Second try", offline);
    expect(await loadSave(slotKey(ROM, fresh.id))).toBeNull();
    expect((await resumeSlot(ROM, offline))?.id).toBe("main");
    await markPlayed(ROM, fresh.id, offline);
    expect((await resumeSlot(ROM, offline))?.id).toBe(fresh.id);

    await renameSlot(ROM, fresh.id, "  Ash's run  ", offline);
    await binSlot(ROM, fresh.id, offline);
    let index = await loadSlots(ROM, offline);
    expect(index.slots.find((s) => s.id === fresh.id)).toMatchObject({ name: "Ash's run", deletedAt: expect.any(Number) });
    expect((await resumeSlot(ROM, offline))?.id).toBe("main");
    await unbinSlot(ROM, fresh.id, offline);
    index = await loadSlots(ROM, offline);
    expect(index.slots.find((s) => s.id === fresh.id)?.deletedAt).toBeUndefined();
  });

  it("copies a slot's save, resume point and journal, but not gifts on their way out", async () => {
    await storeSave(ROM, sram(1));
    await storeResumePoint(ROM, Uint8Array.of(1, 2, 3), sram(1));
    await run("saves", "readwrite", (s) => s.put({ places: [] }, `${ROM}#dex:42`));
    await run("saves", "readwrite", (s) => s.put(true, `${ROM}#gift-in:g1`));
    await run("saves", "readwrite", (s) => s.put({ id: "g2" }, `${ROM}#gift-out:g2`));

    const copy = await duplicateSlot(ROM, "main", undefined, offline);
    const to = slotKey(ROM, copy.id);
    expect(await loadSave(to)).toEqual(sram(1));
    expect((await readResumePoint(to))?.state).toEqual(Uint8Array.of(1, 2, 3));
    expect(await run("saves", "readonly", (s) => s.get(`${to}#dex:42`))).toEqual({ places: [] });
    expect(await run("saves", "readonly", (s) => s.get(`${to}#gift-in:g1`))).toBe(true);
    expect(await run("saves", "readonly", (s) => s.get(`${to}#gift-out:g2`))).toBeUndefined();
    // The original is untouched.
    expect(await loadSave(ROM)).toEqual(sram(1));
    expect(await run("saves", "readonly", (s) => s.get(`${ROM}#gift-out:g2`))).toEqual({ id: "g2" });
  });

  it("shares slots between devices and backs up a copy", async () => {
    const { fetch, objects } = server();
    const a = device();
    await storeSave(ROM, sram(1));
    const copy = await duplicateSlot(ROM, "main", "Copy", fetch);
    expect(objects.has(saveKey("sam", slotKey(ROM, copy.id)))).toBe(true);

    const b = device();
    const made = await createSlot(ROM, "On B", fetch);
    expect((await loadSlots(ROM, fetch)).slots.map((s) => s.id).sort()).toEqual(["main", copy.id, made.id].sort());

    // A bins the copy while B is offline; B's next sync still sees it binned.
    a.activate();
    await binSlot(ROM, copy.id, fetch);
    b.activate();
    const seen = await loadSlots(ROM, fetch);
    expect(seen.slots.find((s) => s.id === copy.id)?.deletedAt).toBeDefined();
    expect(seen.slots.find((s) => s.id === made.id)?.name).toBe("On B");
  });
});
