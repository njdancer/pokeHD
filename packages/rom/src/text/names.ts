// Item and Pokémon names, and the game's own strings (names, nicknames), read from the ROM's
// text encoding. Codes $80–$ff are the font (FONT_CHARS); "@" ($50) ends a string.
import { SYMBOLS } from "../generated/symbols.ts";
import { romOffset } from "../symbols.ts";
import { FONT_CHARS } from "./charmap.ts";

const TERMINATOR = 0x50;
const HM01 = 0xc4;
const TM01 = 0xc9;
const NAME_LENGTH = 11;

/** Decodes a game string up to its terminator (or the end of `bytes`). */
export function decodeText(bytes: ArrayLike<number>): string {
  let out = "";
  for (let i = 0; i < bytes.length; i++) {
    const code = bytes[i]!;
    if (code === TERMINATOR) break;
    if (code >= 0x80) out += FONT_CHARS[code - 0x80];
    else if (code === 0x7f) out += " ";
    else if (code === 0x54) out += "POKé";
    else out += "?";
  }
  return out;
}

/** Encodes a string for the game, padded with terminators to `length`. Unknown characters become "?". */
export function encodeText(text: string, length = NAME_LENGTH): Uint8Array {
  const out = new Uint8Array(length).fill(TERMINATOR);
  const chars = [...text];
  for (let i = 0; i < Math.min(chars.length, length - 1); i++) {
    const char = chars[i]!;
    const index = char === " " ? -1 : FONT_CHARS.indexOf(char);
    out[i] = char === " " ? 0x7f : index >= 0 ? 0x80 + index : 0xe6; // "?"
  }
  return out;
}

/** An item's name as the bag shows it: `ItemNames` for ordinary items, "TM01"/"HM01" for machines. */
export function itemName(rom: Uint8Array, item: number): string {
  if (item >= TM01) return `TM${String(item - TM01 + 1).padStart(2, "0")}`;
  if (item >= HM01) return `HM${String(item - HM01 + 1).padStart(2, "0")}`;
  let offset = romOffset(SYMBOLS.ItemNames);
  for (let i = 1; i < item; i++) while (rom[offset++] !== TERMINATOR);
  return decodeText(rom.subarray(offset, offset + 20));
}

/** A species' name, by internal index (not Pokédex number): `MonsterNames`, 10 bytes each. */
export function monName(rom: Uint8Array, species: number): string {
  const offset = romOffset(SYMBOLS.MonsterNames) + (species - 1) * 10;
  return decodeText(rom.subarray(offset, offset + 10));
}

/** The Pokédex number for an internal species index, or 0 for MissingNo. and the glitch slots. */
export function pokedexNumber(rom: Uint8Array, species: number): number {
  if (species < 1 || species > 190) return 0;
  return rom[romOffset(SYMBOLS.PokedexOrder) + species - 1] ?? 0;
}

/**
 * Whether the game counts an item as a key item (`IsKeyItem_`): the `KeyItemFlags` bit array
 * for ordinary items, and every HM. TMs aren't key items.
 */
export function isKeyItem(rom: Uint8Array, item: number): boolean {
  if (item >= TM01) return false;
  if (item >= HM01) return true;
  const bit = item - 1;
  return ((rom[romOffset(SYMBOLS.KeyItemFlags) + (bit >> 3)]! >> (bit & 7)) & 1) === 1;
}

/**
 * What the naming screen's keyboard can type (data/text/alphabets.asm), leaving out its PK and
 * MN tiles. A name made of these is one a player could have typed on the Game Boy.
 */
export const NAME_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz ×():;[]-?!♂♀/.,";

/** The longest names the naming screen takes: the player and rival 7 letters, a Pokémon 10. */
export const NAME_MAX = { player: 7, rival: 7, mon: 10 } as const;

/** Why `text` can't be typed on the naming screen as it is, or null if it can. */
export function nameProblem(text: string, max: number): string | null {
  const chars = [...text];
  if (chars.length > max) return `${max} letters at most`;
  const bad = chars.filter((c) => !NAME_ALPHABET.includes(c));
  if (bad.length) return `The game can't write ${[...new Set(bad)].map((c) => `“${c}”`).join(" ")}`;
  return null;
}

/** A name as the naming screen writes it (its "." is the <DOT> tile), ended and padded with "@". */
export function encodeName(text: string): Uint8Array {
  const out = encodeText(text);
  [...text].forEach((c, i) => {
    if (c === "." && i < out.length - 1) out[i] = 0xf2;
  });
  return out;
}

/** The names the intro offers after NEW NAME (BLUE, GARY, JOHN for the player in Blue). */
export function defaultNames(rom: Uint8Array, who: "player" | "rival"): string[] {
  let at = romOffset(who === "player" ? SYMBOLS.DefaultNamesPlayerList : SYMBOLS.DefaultNamesRivalList);
  const names: string[] = [];
  for (let i = 0; i < 4; i++) {
    let end = at;
    while (rom[end] !== TERMINATOR && end - at < NAME_LENGTH) end++;
    names.push(decodeText(rom.subarray(at, end)));
    at = end + 1;
  }
  return names.slice(1);
}
