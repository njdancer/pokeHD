import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it } from "vitest";
import type { RomHeader } from "@pokehd/rom";
import { closeDb } from "../idb.ts";
import { loadStoredRom, storeRom } from "../rom-store.ts";
import { checkSav, deleteSave, loadSave, openSaveSlot, romKey, savFileName, sramSize, storeSave } from "./save-store.ts";

const header: RomHeader = {
  title: "POKEMON BLUE", cgbFlag: 0, sgbFlag: 3, cartridgeType: 0x13, romSizeCode: 5, ramSizeCode: 3,
  headerChecksum: 0, globalChecksum: 0,
};

/** A full-size SRAM image with every byte value in it. */
const sram = (seed = 0) => Uint8Array.from({ length: 32768 }, (_, i) => (i * 31 + seed) & 0xff);

beforeEach(() => {
  closeDb();
  globalThis.indexedDB = new IDBFactory();
});

describe("save store", () => {
  it("round-trips SRAM byte for byte, per ROM", async () => {
    const a = sram(1);
    const b = sram(2);
    await storeSave("rom-a", a);
    await storeSave("rom-b", b);
    expect(await loadSave("rom-a")).toEqual(a);
    expect(await loadSave("rom-b")).toEqual(b);
    expect(await loadSave("rom-c")).toBeNull();
    await deleteSave("rom-a");
    expect(await loadSave("rom-a")).toBeNull();
  });

  it("survives a reopened database, as after a reload", async () => {
    await storeSave("k", sram(3));
    closeDb();
    expect(await loadSave("k")).toEqual(sram(3));
  });

  it("keys saves by the ROM's SHA-1", async () => {
    expect(await romKey(new TextEncoder().encode("abc"))).toBe("a9993e364706816aba3e25717850c26c9cd0d89d");
  });

  it("keeps the ROM stored by the version 1 database", async () => {
    const rom = Uint8Array.of(1, 2, 3);
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.open("pokehd", 1);
      req.onupgradeneeded = () => req.result.createObjectStore("rom").put(rom.buffer, "rom");
      req.onsuccess = () => (req.result.close(), resolve());
      req.onerror = () => reject(req.error);
    });
    expect(await loadStoredRom()).toEqual(rom);
    await storeSave("k", sram());
    expect(await loadSave("k")).toEqual(sram());
    await storeRom(Uint8Array.of(9));
    expect(await loadStoredRom()).toEqual(Uint8Array.of(9));
  });

  it("commits slot writes in the order the emulator sent them", async () => {
    const slot = await openSaveSlot("k");
    expect(slot.sram).toBeUndefined();
    void slot.persist(sram(1));
    void slot.persist(sram(2));
    await slot.persist(sram(3));
    expect(await loadSave("k")).toEqual(sram(3));
    expect((await openSaveSlot("k")).sram).toEqual(sram(3));
  });
});

describe(".sav files", () => {
  it("export then import is byte-identical", async () => {
    await storeSave("k", sram(7));
    const exported = new Uint8Array(await new Blob([(await loadSave("k"))!.slice().buffer]).arrayBuffer());
    await deleteSave("k");
    const check = checkSav(exported, header);
    expect(check.ok).toBe(true);
    if (check.ok) await storeSave("k", check.sram);
    expect(await loadSave("k")).toEqual(sram(7));
  });

  it("rejects files that aren't this cartridge's SRAM size", () => {
    expect(sramSize(header)).toBe(32768);
    expect(checkSav(new Uint8Array(8192), header)).toMatchObject({ ok: false });
    expect(checkSav(new Uint8Array(32768 + 48), header)).toMatchObject({ ok: false });
  });

  it("names the file after the game", () => {
    expect(savFileName(header)).toBe("pokeblue.sav");
  });
});
