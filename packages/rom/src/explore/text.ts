// Decodes the game's text scripts (the `text`, `line`, `para`… macros) for the explorer.
import { FONT_CHARS, TEXT_BOX_CHARS } from "../text/charmap.ts";

/** Control characters inside strings, from constants/charmap.asm. */
const CONTROL: Record<number, string> = {
  0x49: "\n\n", // <PAGE>
  0x4a: "PKMN",
  0x4b: "\n", // <_CONT>
  0x4c: "\n", // <SCROLL>
  0x4e: "\n", // <NEXT>
  0x4f: "\n", // <LINE>
  0x51: "\n\n", // <PARA>
  0x52: "‹PLAYER›",
  0x53: "‹RIVAL›",
  0x54: "POKé",
  0x55: "\n", // <CONT>
  0x56: "……",
  0x5b: "PC",
  0x5c: "TM",
  0x5d: "TRAINER",
  0x5e: "ROCKET",
  0x59: "‹TARGET›",
  0x5a: "‹USER›",
  0x7f: " ",
};
const END = 0x50;
const DONE = 0x57;
const PROMPT = 0x58;

export type TextPart =
  | { t: "text"; text: string }
  /** `text_far`: the text continues in another bank. */
  | { t: "far"; bank: number; address: number }
  /** A text command that isn't a string (sound, numbers from RAM, pauses…). */
  | { t: "command"; code: number; name: string }
  /** `text_asm`: the script switches to running code at this file offset. */
  | { t: "asm"; offset: number };

const COMMANDS: Record<number, [name: string, args: number]> = {
  0x01: ["text_ram", 2],
  0x02: ["text_bcd", 3],
  0x03: ["text_move", 2],
  0x04: ["text_box", 4],
  0x05: ["text_low", 0],
  0x06: ["text_promptbutton", 0],
  0x07: ["text_scroll", 0],
  0x09: ["text_decimal", 3],
  0x0a: ["text_pause", 0],
  0x0b: ["sound_get_item_1", 0],
  0x0c: ["text_dots", 1],
  0x0d: ["text_waitbutton", 0],
  0x0e: ["sound_pokedex_rating", 0],
  0x0f: ["sound_get_item_1", 0],
  0x10: ["sound_get_item_2", 0],
  0x11: ["sound_get_key_item", 0],
  0x12: ["sound_caught_mon", 0],
  0x13: ["sound_dex_page_added", 0],
  0x14: ["sound_cry_nidorina", 0],
  0x15: ["sound_cry_pidgeot", 0],
  0x16: ["sound_cry_dewgong", 0],
};

const SCRIPTS: Record<number, string> = {
  0xf5: "vending machine",
  0xf6: "cable club receptionist",
  0xf7: "prize vendor",
  0xf9: "pokecenter PC",
  0xfc: "player's PC",
  0xfd: "bill's PC",
  0xfe: "mart",
  0xff: "pokecenter nurse",
};

/** Decodes one string of characters starting at `offset`; returns it and where it ended. */
export function decodeChars(rom: Uint8Array, offset: number, max = 1024): { text: string; end: number } {
  let text = "";
  let i = offset;
  for (; i < Math.min(rom.length, offset + max); i++) {
    const c = rom[i]!;
    if (c === END) return { text, end: i + 1 };
    if (c === DONE) return { text: text + "▪", end: i + 1 };
    if (c === PROMPT) return { text: text + "▼", end: i + 1 };
    if (c >= 0x80) text += FONT_CHARS[c - 0x80];
    else if (CONTROL[c]) text += CONTROL[c];
    else if (c >= 0x60 && TEXT_BOX_CHARS[c - 0x60]) text += TEXT_BOX_CHARS[c - 0x60];
    else text += `‹${c.toString(16).padStart(2, "0")}›`;
  }
  return { text, end: i };
}

/**
 * Decodes a text script: a sequence of commands, most often `text` (a string) and `text_far`
 * (a jump to text in another bank). `plain` treats the bytes as a bare string (names lists).
 */
export function decodeTextScript(rom: Uint8Array, offset: number, plain = false): TextPart[] {
  if (plain) return [{ t: "text", text: decodeChars(rom, offset).text }];
  const parts: TextPart[] = [];
  let i = offset;
  for (let n = 0; n < 32 && i < rom.length; n++) {
    const code = rom[i]!;
    if (code === 0x00) {
      const { text, end } = decodeChars(rom, i + 1);
      parts.push({ t: "text", text });
      i = end;
      if (rom[end - 1] === DONE || rom[end - 1] === PROMPT) break;
    } else if (code === 0x17) {
      parts.push({ t: "far", address: rom[i + 1]! | (rom[i + 2]! << 8), bank: rom[i + 3]! });
      i += 4;
    } else if (code === 0x08) {
      parts.push({ t: "asm", offset: i + 1 });
      break;
    } else if (code === END) {
      break;
    } else if (code >= 0xf5) {
      // TX_SCRIPT_*: a special routine (a mart, the nurse, the PC…) runs instead of text.
      parts.push({ t: "command", code, name: SCRIPTS[code] ?? `text script $${code.toString(16)}` });
      break;
    } else if (COMMANDS[code]) {
      const [name, args] = COMMANDS[code];
      parts.push({ t: "command", code, name });
      i += 1 + args;
    } else {
      // Not a command: probably a bare string.
      const { text, end } = decodeChars(rom, i);
      parts.push({ t: "text", text });
      i = end;
      break;
    }
  }
  return parts;
}
