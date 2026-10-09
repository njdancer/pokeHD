// The game's dialog as the HD message box will show it (/dev/dialog). Each text in the ROM is run
// through a model of the game's message box (two lines; `line`, `cont`, `para`, `prompt`, `done`),
// and the pages it stops at are fed to the real DialogJoiner, frame by frame, the way Game.tsx
// does. Text is read from the player's ROM in the browser; nothing here holds any of it.
import type { DialogState, ScreenText } from "@pokehd/emu";
import { FONT_CHARS, TEXT_BOX_CHARS } from "@pokehd/rom";
import { labelDb, romOffset, type Label } from "@pokehd/rom/explore";
import { DialogJoiner, MAX_DIALOG_LINES, type NextPage } from "../game/dialog-join.ts";

/** A stand-in for names the game fills in: the player's and rival's, and values from RAM. */
const NAMES: Record<number, string> = { 0x52: "NICK", 0x53: "JACK", 0x59: "the foe's PIDGEY", 0x5a: "PIKACHU" };
const PHRASES: Record<number, string> = { 0x4a: "PKMN", 0x54: "POKé", 0x56: "……", 0x5b: "PC", 0x5c: "TM", 0x5d: "TRAINER", 0x5e: "ROCKET" };
/** What `text_ram` and the number commands print, shown as a marked placeholder. */
export const RAM_NAME = "‹name›";
export const RAM_NUMBER = "‹123›";

/** Argument bytes of the text commands (home/text.asm). */
const ARGS: Record<number, number> = { 0x01: 2, 0x02: 3, 0x03: 2, 0x04: 4, 0x09: 3, 0x0c: 1 };

/** The message box stopped: what its two lines show and how it waits. */
export interface Page {
  lines: [string, string];
  /** `arrow`: a ▼ waits for A (the joiner may press it). `button`: waits with no ▼. `end`: no wait. */
  wait: "arrow" | "button" | "end";
  /** What the game does after an arrow. */
  next?: NextPage;
}

/**
 * Why a box stops for the player: the sentence ends (or asks), the box is full, the game waits
 * without a ▼, or the text ends (`end` at a ▼, `done` without one: a tap, a menu or more script
 * follows, `code` where a routine takes over).
 */
export type StopReason = "sentence" | "question" | "full" | "button" | "end" | "done" | "code";

/** `current`: the joiner as it runs in the game today. `peek`: told what follows each ▼. */
export type Rule = "current" | "peek";

/** One box the player reads: the game's pages it joins, and what it shows. */
export interface Box {
  pages: Page[];
  lines: string[];
  reason: StopReason;
  /** The joiner pressed A at the end of the text: the game moves on to whatever follows. */
  pressedPastEnd?: boolean;
}

export interface DialogText {
  label: Label;
  pages: Page[];
  /** How the text ends after its last page. */
  ending: "prompt" | "done" | "code";
  boxes: Record<Rule, Box[]>;
}

/** Runs a text script through the game's message box and returns the pages it stops at. */
export function pagesOf(rom: Uint8Array, offset: number): { pages: Page[]; ending: DialogText["ending"] } {
  const pages: Page[] = [];
  const box: [string, string] = ["", ""];
  let row: 0 | 1 = 0;
  const stop = (wait: Page["wait"], next?: NextPage) =>
    pages.push({ lines: [box[0].trimEnd(), box[1].trimEnd()], wait, ...(next ? { next } : {}) });
  const scroll = () => {
    box[0] = box[1];
    box[1] = "";
    row = 1;
  };
  const put = (s: string) => (box[row] += s);

  /** Prints one string; returns how it ended. */
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
      else if (NAMES[c]) put(NAMES[c]);
      else if (PHRASES[c]) put(PHRASES[c]);
      else if (c >= 0x60 && TEXT_BOX_CHARS[c - 0x60]) put(TEXT_BOX_CHARS[c - 0x60]!);
    }
    return { end: at, how: "end" };
  };

  /** Runs text commands; returns how the text ended, or null at `text_end` (back to the caller). */
  const commands = (at: number, depth: number): DialogText["ending"] | null => {
    let i = at;
    const end = (wait: Page["wait"], how: DialogText["ending"], next?: NextPage) => {
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
        const target = romOffset(rom[i + 3]!, rom[i + 1]! | (rom[i + 2]! << 8));
        const ending = depth < 4 ? commands(target, depth + 1) : null;
        if (ending) return ending;
        i += 4;
        continue;
      }
      if (code === 0x50) return null; // text_end
      if (code === 0x08 || code >= 0x17) return end("end", "code"); // text_asm, or a mart, the nurse…
      if (code === 0x01) put(RAM_NAME); // text_ram
      else if (code === 0x02 || code === 0x09) put(RAM_NUMBER); // text_bcd, text_decimal
      else if (code === 0x05) row = 1; // text_low
      else if (code === 0x06) stop("arrow"); // text_promptbutton
      else if (code === 0x07) scroll(); // text_scroll
      else if (code === 0x0d) stop("button"); // text_waitbutton
      else if (code === 0x0c) put("…".repeat(rom[i + 1]!)); // text_dots
      // Arguments: text_ram, text_move (moves the cursor), text_box (draws a box elsewhere)…
      i += 1 + (ARGS[code] ?? 0);
    }
    return end("end", "done");
  };

  let ending = commands(offset, 0);
  if (!ending) {
    stop("end");
    ending = "done";
  }
  return { pages: dropBlank(pages), ending };
}

/** A stop right after another with nothing new printed isn't a page the player sees. */
function dropBlank(pages: Page[]): Page[] {
  return pages.filter((p, i) => p.wait !== "end" || i === 0 || p.lines.join() !== pages[i - 1]!.lines.join());
}

const screen = (page: Page, state: DialogState, menu = false) =>
  ({
    dialog: { box: { x: 0, y: 12, width: 20, height: 6, lines: [] }, lines: page.lines, state },
    menus: menu ? [{ active: true }] : [],
    boxes: [],
  }) as unknown as ScreenText;

const QUESTION = /\?["')\]]*$/;
const SENTENCE_END = /[.!?…]["')\]]*$/;

/** Feeds the pages to the DialogJoiner and records the boxes the player reads. */
export function boxesOf(pages: Page[], ending: DialogText["ending"], rule: Rule = "current"): Box[] {
  const joiner = new DialogJoiner();
  joiner.reset();
  const boxes: Box[] = [];
  let current: Page[] = [];
  pages.forEach((page, i) => {
    const last = i === pages.length - 1;
    joiner.frame(screen(page, "printing"));
    const state: DialogState = page.wait === "arrow" ? "waiting" : "idle";
    const r = joiner.frame(screen(page, state), rule === "peek" ? page.next : undefined);
    current.push(page);
    if (r.press && !last) return;
    const lines = r.lines ?? page.lines.filter(Boolean);
    const end = (lines.at(-1) ?? "").trim();
    const reason: StopReason = last
      ? ending === "code" ? "code" : ending === "done" ? "done" : "end"
      : page.wait === "button" ? "button"
      : QUESTION.test(end) ? "question"
      : SENTENCE_END.test(end) ? "sentence"
      : "full";
    boxes.push({ pages: current, lines, reason, ...(r.press && last ? { pressedPastEnd: true } : {}) });
    current = [];
    // The player taps on: the next page prints.
  });
  return boxes;
}

/** Message text in the disassembly's text files (not Pokédex entries, which have their own box). */
const isDialog = (l: Label) =>
  !l.local && l.name.startsWith("_") && /^(text|data\/text)\//.test(l.file ?? "") && !/dex_entries/.test(l.file ?? "");

/** Every dialog text in the ROM, in the disassembly's order. */
export function dialogTexts(rom: Uint8Array): DialogText[] {
  const db = labelDb();
  return db.labels
    .filter((l) => l.kind === "text" && isDialog(l))
    .map((label) => {
      const { pages, ending } = pagesOf(rom, romOffset(label.bank, label.address));
      return { label, pages, ending, boxes: { current: boxesOf(pages, ending), peek: boxesOf(pages, ending, "peek") } };
    })
    .filter((t) => t.pages.some((p) => p.lines.some(Boolean)));
}

export { MAX_DIALOG_LINES };
