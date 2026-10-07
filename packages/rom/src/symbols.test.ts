import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SYM_PATH, parseSym, renderAll, renderSymbols } from "../../../tools/gen-symbols.ts";
import { checkRom } from "./rom.ts";
import { SYMBOLS, romOffset, wramAddress } from "./symbols.ts";

const ROM_PATH = new URL("../../../rom/pokeblue.gb", import.meta.url);

describe("romOffset", () => {
  it("maps bank 0 directly", () => {
    expect(romOffset({ bank: 0, address: 0x01ae })).toBe(0x01ae);
  });

  it("maps switchable banks into the file", () => {
    expect(romOffset({ bank: 1, address: 0x4000 })).toBe(0x4000);
    expect(romOffset({ bank: 3, address: 0x423d })).toBe(0xc23d);
    expect(romOffset({ bank: 0x1c, address: 0x7fff })).toBe(0x73fff);
  });

  it("rejects non-ROM addresses", () => {
    expect(() => romOffset(SYMBOLS.wCurMap)).toThrow();
    expect(() => romOffset({ bank: 2, address: 0x1000 })).toThrow();
  });
});

describe("wramAddress", () => {
  it("returns WRAM addresses and rejects ROM ones", () => {
    expect(wramAddress(SYMBOLS.wCurMap)).toBe(0xd35e);
    expect(() => wramAddress(SYMBOLS.MapHeaderPointers)).toThrow();
  });
});

describe("generated symbols", () => {
  it("has the known addresses", () => {
    expect(SYMBOLS.MapHeaderPointers).toEqual({ bank: 0x00, address: 0x01ae });
    expect(SYMBOLS.wCurMap).toEqual({ bank: 0x00, address: 0xd35e });
  });

  it("parses rgblink sym lines, keeping the first definition", () => {
    const parsed = parseSym("; comment\n00:1749 RedsHouse1_Coll\n03:47be Tilesets\n01:0000 Tilesets\n");
    expect(parsed.get("Tilesets")).toEqual({ bank: 3, address: 0x47be });
    expect(parsed.size).toBe(2);
  });

  it("fails on an allowlisted name the sym file lacks", () => {
    expect(() => renderSymbols("00:0000 NULL\n", ["Missing"])).toThrow(/Missing/);
  });

  it.skipIf(!existsSync(SYM_PATH))("matches a fresh render of the disassembly", () => {
    for (const [path, rendered] of renderAll()) expect(rendered).toBe(readFileSync(path, "utf8"));
  });
});

describe.skipIf(!existsSync(ROM_PATH))("symbols against the ROM", () => {
  it("finds Pallet Town's header through MapHeaderPointers and MapHeaderBanks", async () => {
    const rom = new Uint8Array(readFileSync(ROM_PATH));
    expect((await checkRom(rom)).ok).toBe(true);
    // Map 0 is Pallet Town: a little-endian header pointer plus its bank in a parallel table.
    const ptrAt = romOffset(SYMBOLS.MapHeaderPointers);
    const address = rom[ptrAt]! | (rom[ptrAt + 1]! << 8);
    const bank = rom[romOffset(SYMBOLS.MapHeaderBanks)]!;
    const header = romOffset({ bank, address });
    // Header: tileset (OVERWORLD = 0), height 9 blocks, width 10 blocks.
    expect([rom[header], rom[header + 1], rom[header + 2]]).toEqual([0, 9, 10]);
  });
});
