// The game's dialog as the HD message box will show it (/dev/dialog). Each text in the ROM is run
// through a model of the game's message box (two lines; `line`, `cont`, `para`, `prompt`, `done`),
// and the pages it stops at are fed to the real DialogJoiner, frame by frame, the way Game.tsx
// does. Text is read from the player's ROM in the browser; nothing here holds any of it.
import type { DialogState, ScreenText } from "@pokehd/emu";
import { RAM_NAME, RAM_NUMBER, readMessage, SENTENCE_END, type Message, type MessagePage } from "@pokehd/rom";
import { labelDb, romOffset, type Label } from "@pokehd/rom/explore";
import { DialogJoiner, MAX_DIALOG_LINES } from "../game/dialog-join.ts";

/** Stand-ins for the names the game fills in. */
const NAMES: Record<number, string> = { 0x52: "NICK", 0x53: "JACK", 0x59: "the foe's PIDGEY", 0x5a: "PIKACHU" };
export { RAM_NAME, RAM_NUMBER };

/** The message box stopped: what its two lines show and how it waits. */
export type Page = MessagePage;

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
  ending: Message["ending"];
  boxes: Record<Rule, Box[]>;
}

/** Runs a text script (at a file offset) through the game's message box: the pages it stops at. */
export function pagesOf(rom: Uint8Array, offset: number): Message {
  const bank = Math.floor(offset / 0x4000);
  return readMessage(rom, bank, bank ? 0x4000 + (offset % 0x4000) : offset, { name: (code) => NAMES[code]! });
}

const screen = (page: Page, state: DialogState, menu = false) =>
  ({
    dialog: { box: { x: 0, y: 12, width: 20, height: 6, lines: [] }, lines: page.lines, state },
    menus: menu ? [{ active: true }] : [],
    boxes: [],
  }) as unknown as ScreenText;

const QUESTION = /\?["')\]]*$/;

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
