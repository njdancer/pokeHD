import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { saveSummary } from "@pokehd/emu";
import { SYMBOLS, type SymbolName } from "@pokehd/rom";
import { closeDb } from "../idb.ts";
import { HISTORY_SPACING_MS, KEEP_BEFORE, KEEP_PERIODIC, keepSave, listHistory } from "./history.ts";
import { openSaveSlot } from "./save-store.ts";

const sramOffset = (name: SymbolName) => SYMBOLS[name].bank * 0x2000 + SYMBOLS[name].address - 0xa000;

/** A battery save the game would load: trainer `id`, `badges` badges, with a valid checksum. */
function gameSave(id: number, badges = 0, salt = 0): Uint8Array {
  const sram = new Uint8Array(32 * 1024);
  const main = sramOffset("sMainData");
  const at = (name: SymbolName) => main + SYMBOLS[name].address - SYMBOLS.wMainDataStart.address;
  sram.set([0x91, 0x84, 0x83, 0x50], sramOffset("sGameData")); // "RED"
  sram[at("wPlayerID")] = id >> 8;
  sram[at("wPlayerID") + 1] = id & 0xff;
  sram[at("wObtainedBadges")] = (1 << badges) - 1;
  sram[at("wPlayTimeMinutes")] = salt;
  let sum = 0;
  for (let i = sramOffset("sGameData"); i < sramOffset("sGameDataEnd"); i++) sum = (sum + sram[i]!) & 0xff;
  sram[sramOffset("sMainDataCheckSum")] = ~sum & 0xff;
  return sram;
}

const offline = (async () => {
  throw new Error("offline");
}) as unknown as typeof fetch;

describe("save history", () => {
  beforeEach(() => {
    closeDb();
    globalThis.indexedDB = new IDBFactory();
    vi.useFakeTimers({ now: 1_760_000_000_000, toFake: ["Date"] });
  });
  afterEach(() => vi.useRealTimers());

  it("summarises a save", () => {
    const s = saveSummary(gameSave(0x1234, 3, 7))!;
    expect(s).toMatchObject({ id: 0x1234, badges: 3, minutes: 7 });
  });

  it("keeps a periodic copy only every half hour, and before any replacement", async () => {
    expect(await keepSave("k", gameSave(1, 0, 1), "save", offline)).toBe(true);
    expect(await keepSave("k", gameSave(1, 0, 2), "save", offline)).toBe(false);
    // Another trainer's save is a new periodic copy at once.
    expect(await keepSave("k", gameSave(2, 0, 1), "save", offline)).toBe(true);
    expect(await keepSave("k", gameSave(1, 0, 3), "replaced", offline)).toBe(true);
    // The same bytes twice are kept once.
    expect(await keepSave("k", gameSave(1, 0, 3), "before-import", offline)).toBe(false);
    vi.setSystemTime(Date.now() + HISTORY_SPACING_MS);
    expect(await keepSave("k", gameSave(1, 0, 4), "save", offline)).toBe(true);
    // A blank cartridge is never kept.
    expect(await keepSave("k", new Uint8Array(32 * 1024), "replaced", offline)).toBe(false);
    expect((await listHistory("k", offline)).map((e) => e.reason)).toEqual(["save", "replaced", "save", "save"]);
  });

  it("keeps the newest of each kind", async () => {
    for (let i = 0; i < KEEP_PERIODIC + 5; i++) {
      vi.setSystemTime(Date.now() + HISTORY_SPACING_MS);
      await keepSave("k", gameSave(1, 0, i), "save", offline);
      await keepSave("k", gameSave(2, 0, i), "replaced", offline);
    }
    const all = await listHistory("k", offline);
    expect(all.filter((e) => e.reason === "save")).toHaveLength(KEEP_PERIODIC);
    expect(all.filter((e) => e.reason === "replaced")).toHaveLength(KEEP_BEFORE);
    expect(all[0]!.summary!.minutes).toBe(KEEP_PERIODIC + 4);
  });

  it("promotes a periodic copy when the same save is kept before a replacement", async () => {
    await keepSave("k", gameSave(1, 0, 1), "save", offline);
    expect(await keepSave("k", gameSave(1, 0, 1), "replaced", offline)).toBe(true);
    expect((await listHistory("k", offline)).map((e) => e.reason)).toEqual(["replaced"]);
  });

  it("keeps every copy when two are kept at once", async () => {
    await Promise.all([
      keepSave("k", gameSave(1, 1), "save", offline),
      keepSave("k", gameSave(2, 1), "replaced", offline),
      keepSave("k", gameSave(3, 1), "before-import", offline),
    ]);
    expect((await listHistory("k", offline)).map((e) => e.reason).sort()).toEqual(["before-import", "replaced", "save"]);
  });

  it("keeps the old trainer's save when a new game saves over it", async () => {
    const keep = vi.fn((sram: Uint8Array, reason: string) => keepSave("k", sram, reason as "save", offline));
    const slot = await openSaveSlot("k", null, keep);
    await slot.persist(gameSave(1, 2));
    await slot.persist(gameSave(1, 2, 5)); // same trainer: no "replaced" copy
    await slot.persist(gameSave(9)); // NEW GAME saved over it
    expect(keep.mock.calls.filter(([, reason]) => reason === "replaced")).toHaveLength(1);
    const replaced = (await listHistory("k", offline)).find((e) => e.reason === "replaced")!;
    expect(replaced.summary).toMatchObject({ id: 1, badges: 2, minutes: 5 });
  });
});
