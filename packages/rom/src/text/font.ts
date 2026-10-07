// The game's text glyphs, read from the ROM, keyed by how they look in VRAM. Screen decoding
// matches each tile's pixels against these, which works whatever tile set the game has loaded.
import { SYMBOLS } from "../generated/symbols.ts";
import { romOffset } from "../symbols.ts";
import { BATTLE_CHARS, FONT_CHARS, TEXT_BOX_CHARS } from "./charmap.ts";

/** Bytes of one tile in VRAM (2 bits per pixel, 8×8). */
export const TILE_BYTES = 16;

export interface Glyph {
  /** The character code (and tile ID) the game draws it with. */
  code: number;
  /** What it reads as, e.g. "A", "'d", "▶", "┌". */
  char: string;
  /** The tile as it sits in VRAM: 16 bytes of 2bpp. */
  tile: Uint8Array;
}

/** A tile's bytes as a lookup key. */
export const tileKey = (tile: Uint8Array): string => String.fromCharCode(...tile);

function slice(rom: Uint8Array, start: keyof typeof SYMBOLS, end: keyof typeof SYMBOLS): Uint8Array {
  const from = romOffset(SYMBOLS[start]);
  return rom.subarray(from, from + SYMBOLS[end].address - SYMBOLS[start].address);
}

/**
 * Every text glyph in the ROM: the main font (1bpp, copied to VRAM with each byte doubled), the
 * text box extras and the battle HUD's characters. Earlier entries win where two look alike.
 */
export function readGlyphs(rom: Uint8Array): Glyph[] {
  const glyphs: Glyph[] = [];
  const font = slice(rom, "FontGraphics", "FontGraphicsEnd");
  FONT_CHARS.forEach((char, i) => {
    const tile = new Uint8Array(TILE_BYTES);
    for (let row = 0; row < 8; row++) tile.fill(font[i * 8 + row]!, row * 2, row * 2 + 2);
    glyphs.push({ code: 0x80 + i, char, tile });
  });
  const add = (bytes: Uint8Array, first: number, chars: readonly (string | null)[]) =>
    chars.forEach((char, i) => {
      if (char !== null) glyphs.push({ code: first + i, char, tile: bytes.slice(i * TILE_BYTES, (i + 1) * TILE_BYTES) });
    });
  add(slice(rom, "TextBoxGraphics", "TextBoxGraphicsEnd"), 0x60, TEXT_BOX_CHARS);
  add(slice(rom, "HpBarAndStatusGraphics", "HpBarAndStatusGraphicsEnd"), 0x62, BATTLE_CHARS);
  return glyphs;
}

/** Glyphs by `tileKey`, for matching VRAM tiles. A blank tile reads as a space. */
export function glyphTable(glyphs: readonly Glyph[]): Map<string, string> {
  const table = new Map<string, string>([[tileKey(new Uint8Array(TILE_BYTES)), " "]]);
  for (const { tile, char } of glyphs) {
    const key = tileKey(tile);
    if (!table.has(key)) table.set(key, char);
  }
  return table;
}
