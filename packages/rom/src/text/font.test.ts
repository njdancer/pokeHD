import { existsSync, readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { FONT_CHARS, TEXT_BOX_CHARS } from "./charmap.ts";
import { glyphTable, readGlyphs, tileKey, type Glyph } from "./font.ts";

const ROM_PATH = new URL("../../../../rom/pokeblue.gb", import.meta.url);

describe("charmap", () => {
  it("covers every tile of the font and the text box extras", () => {
    expect(FONT_CHARS).toHaveLength(0x80);
    expect(TEXT_BOX_CHARS).toHaveLength(0x20);
    expect(FONT_CHARS[0xf6 - 0x80]).toBe("0");
    expect(TEXT_BOX_CHARS[0x79 - 0x60]).toBe("┌");
  });
});

describe.skipIf(!existsSync(ROM_PATH))("readGlyphs", () => {
  // Read in beforeAll: a skipped describe still runs its body when collecting tests.
  let glyphs: Glyph[];
  beforeAll(() => {
    glyphs = readGlyphs(new Uint8Array(readFileSync(ROM_PATH)));
  });
  const byChar = (char: string) => glyphs.find((g) => g.char === char)!;

  it("tells every letter, digit and box piece apart", () => {
    const table = glyphTable(glyphs);
    const chars = [..."ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789▶▷▼┌─┐│└┘é!?"];
    for (const char of chars) expect(table.get(tileKey(byChar(char).tile)), char).toBe(char);
  });

  it("draws letters as solid ink (both bit planes set)", () => {
    const { tile } = byChar("A");
    expect(tile.some((b) => b !== 0)).toBe(true);
    for (let row = 0; row < 8; row++) expect(tile[row * 2]).toBe(tile[row * 2 + 1]);
  });

  it("reads the font's unused codes as blank", () => {
    expect(glyphs.find((g) => g.code === 0xc0)!.tile.every((b) => b === 0)).toBe(true);
  });
});
