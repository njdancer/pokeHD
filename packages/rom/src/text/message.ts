// A message read straight from the game's text script, laid out the way its two-line message box
// shows it: the pages it stops at, how each stops, and what follows. Used to show whole messages
// in the HD box before the game prints them (tap-first UI) and by the /dev/dialog preview.
// The text engine is home/text.asm: `line`, `cont` (▼ then scroll one line), `para` (▼ then a new
// page), `prompt` (▼ then the end), `done` (the end, no ▼), and the text commands.
import { FONT_CHARS, TEXT_BOX_CHARS } from "./charmap.ts";

/** What the game does after a ▼. */
export type NextPage = "scroll" | "page" | "end";

/** A stop in the message box: its two lines, and how it waits. */
export interface MessagePage {
  lines: [string, string];
  /**
   * `arrow`: a ▼ waits for A or B. `button`: waits without a ▼ (`text_waitbutton`). `end`: the
   * text stops here without waiting (`done`, or code takes over).
   */
  wait: "arrow" | "button" | "end";
  /** After an arrow: what the game does next. */
  next?: NextPage;
}

/** How a message ends: at a ▼ (`prompt`), with no ▼ (`done`), or where code takes over. */
export type MessageEnding = "prompt" | "done" | "code";

export interface Message {
  pages: MessagePage[];
  ending: MessageEnding;
  /**
   * Only text, names, numbers and waits: nothing that draws elsewhere or plays a sound. A message
   * ending in code counts if the code is `text_asm`, at `asm`.
   */
  simple: boolean;
  /** Where `text_asm` code takes over (the bank it's in, and the address after the command). */
  asm?: { bank: number; address: number };
}

/** Values the game fills in as it prints. Unset, placeholders show instead. */
export interface MessageFill {
  /** <PLAYER> ($52), <RIVAL> ($53), <TARGET> ($59), <USER> ($5a). */
  name?(code: number): string;
  /** `text_ram`: the string at a RAM address. */
  ram?(address: number): string;
  /** `text_bcd` and `text_decimal`: the number at a RAM address, as the game prints it. */
  number?(command: "bcd" | "decimal", address: number, format: number): string;
}

const PLACEHOLDER_NAMES: Record<number, string> = { 0x52: "‹player›", 0x53: "‹rival›", 0x59: "‹target›", 0x5a: "‹user›" };
/** Placeholders for names and numbers when no fill is given. */
export const RAM_NAME = "‹name›";
export const RAM_NUMBER = "‹123›";

const PHRASES: Record<number, string> = { 0x4a: "PKMN", 0x54: "POKé", 0x56: "……", 0x5b: "PC", 0x5c: "TM", 0x5d: "TRAINER", 0x5e: "ROCKET" };
/** Argument bytes of the text commands. */
const ARGS: Record<number, number> = { 0x01: 2, 0x02: 3, 0x03: 2, 0x04: 4, 0x09: 3, 0x0c: 1 };
const BANK_SIZE = 0x4000;
const offsetOf = (bank: number, address: number) => (address < BANK_SIZE ? address : bank * BANK_SIZE + (address - BANK_SIZE));

/** Reads the text script at a CPU address with `bank` switched in. */
export function readMessage(rom: Uint8Array, bank: number, address: number, fill: MessageFill = {}): Message {
  const pages: MessagePage[] = [];
  let simple = true;
  let asm: Message["asm"];
  const box: [string, string] = ["", ""];
  let row: 0 | 1 = 0;
  const stop = (wait: MessagePage["wait"], next?: NextPage) =>
    pages.push({ lines: [box[0].trimEnd(), box[1].trimEnd()], wait, ...(next ? { next } : {}) });
  const scroll = () => {
    box[0] = box[1];
    box[1] = "";
    row = 1;
  };
  const put = (s: string) => (box[row] += s);

  /** Prints one string; returns where it ended and how. */
  const chars = (at: number): { end: number; how: "end" | "prompt" | "done" } => {
    for (let i = at; i < Math.min(rom.length, at + 1024); i++) {
      const c = rom[i]!;
      if (c === 0x50) return { end: i + 1, how: "end" };
      if (c === 0x57) return { end: i + 1, how: "done" };
      if (c === 0x58) return { end: i + 1, how: "prompt" };
      if (c === 0x4f) row = 1; // <LINE>
      else if (c === 0x4e) { // <NEXT>
        if (row === 0) row = 1;
        else scroll();
      } else if (c === 0x55 || c === 0x4b) { // <CONT>, <_CONT>
        stop("arrow", "scroll");
        scroll();
      } else if (c === 0x4c) scroll(); // <SCROLL>: no pause
      else if (c === 0x51 || c === 0x49) { // <PARA>, <PAGE>
        stop("arrow", "page");
        box[0] = box[1] = "";
        row = 0;
      } else if (c >= 0x80) put(FONT_CHARS[c - 0x80]!);
      else if (c === 0x7f) put(" ");
      else if (PLACEHOLDER_NAMES[c]) put(fill.name?.(c) ?? PLACEHOLDER_NAMES[c]);
      else if (PHRASES[c]) put(PHRASES[c]);
      else if (c >= 0x60 && TEXT_BOX_CHARS[c - 0x60]) put(TEXT_BOX_CHARS[c - 0x60]!);
    }
    return { end: at, how: "end" };
  };

  /** Runs text commands; returns how the text ended, or null at `text_end` (back to the caller). */
  const commands = (bank: number, at: number, depth: number): MessageEnding | null => {
    let i = at;
    const end = (wait: MessagePage["wait"], how: MessageEnding, next?: NextPage) => {
      stop(wait, next);
      return how;
    };
    for (let n = 0; n < 64 && i < rom.length; n++) {
      const code = rom[i]!;
      if (code === 0x00) {
        const { end: after, how } = chars(i + 1);
        if (how === "prompt") return end("arrow", "prompt", "end");
        if (how === "done") return end("end", "done");
        i = after;
        continue;
      }
      if (code === 0x17) {
        const farBank = rom[i + 3]!;
        const ending = depth < 4 ? commands(farBank, offsetOf(farBank, rom[i + 1]! | (rom[i + 2]! << 8)), depth + 1) : null;
        if (ending) return ending;
        i += 4;
        continue;
      }
      if (code === 0x50) return null; // text_end
      if (code === 0x08) {
        // text_asm: the code right after it runs.
        const offset = i + 1;
        asm = { bank, address: bank ? 0x4000 + (offset % BANK_SIZE) : offset };
        return end("end", "code");
      }
      if (code >= 0x17) {
        simple = false; // a mart, the nurse, the PC…
        return end("end", "code");
      }
      // Commands that move the cursor, draw a box or play a sound need the game's own routine.
      if (code === 0x03 || code === 0x04 || code >= 0x0b) simple = false;
      const arg = rom[i + 1]! | (rom[i + 2]! << 8);
      if (code === 0x01) put(fill.ram?.(arg) ?? RAM_NAME); // text_ram
      else if (code === 0x02) put(fill.number?.("bcd", arg, rom[i + 3]!) ?? RAM_NUMBER); // text_bcd
      else if (code === 0x09) put(fill.number?.("decimal", arg, rom[i + 3]!) ?? RAM_NUMBER); // text_decimal
      else if (code === 0x05) row = 1; // text_low
      else if (code === 0x06) stop("arrow"); // text_promptbutton
      else if (code === 0x07) scroll(); // text_scroll
      else if (code === 0x0d) stop("button"); // text_waitbutton
      else if (code === 0x0c) put("…".repeat(rom[i + 1]!)); // text_dots
      // Others: text_move (moves the cursor), text_box (draws a box elsewhere), pauses, sounds.
      i += 1 + (ARGS[code] ?? 0);
    }
    return end("end", "done");
  };

  let ending = commands(bank, offsetOf(bank, address), 0);
  if (!ending) {
    stop("end");
    ending = "done";
  }
  // A stop right after another with nothing new printed isn't a page the player sees.
  const seen = pages.filter((p, i) => p.wait !== "end" || i === 0 || p.lines.join() !== pages[i - 1]!.lines.join());
  return { pages: seen, ending, simple, ...(asm ? { asm } : {}) };
}

/** True if the message prints anything at all (some scripts start straight into code). */
export const hasText = (message: Message) => message.pages.some((p) => p.lines.some(Boolean));

/** How many times the game waits for A or B while printing the message, its last ▼ included. */
export const waitsOf = (message: Message) => message.pages.filter((p) => p.wait !== "end").length;

/** Ends a sentence: . ! ? and the game's … (closing quotes and brackets may follow). */
export const SENTENCE_END = /[.!?…]["')\]]*$/;

/**
 * The message as HD boxes of up to `max` lines: a page's lines join the box before them while
 * that box hasn't ended its sentence and they fit. A scroll repeats the line before it, which a
 * box already holds, so it adds one line; a new page adds two. A box after a finished sentence
 * leaves out that repeated line (it was just read); after a full box it keeps it, for context.
 */
export function messageBoxes(message: Message, max = 4): string[][] {
  const boxes: string[][] = [];
  let box: string[] = [];
  let prev: MessagePage | undefined;
  for (const page of message.pages) {
    const lines = page.lines.filter(Boolean);
    const fresh = prev?.next === "scroll" && lines.length > 1 ? lines.slice(1) : lines;
    prev = page;
    if (!fresh.length) continue;
    const ended = SENTENCE_END.test((box.at(-1) ?? "").trim());
    if (box.length > 0 && !ended && box.length + fresh.length <= max) box.push(...fresh);
    else {
      if (box.length) boxes.push(box);
      box = [...(ended ? fresh : lines)];
    }
  }
  if (box.length) boxes.push(box);
  return boxes;
}
