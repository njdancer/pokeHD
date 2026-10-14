// Whole messages from the script (ScriptText in @pokehd/emu), as the page shows them: which box
// the player is on, and whether the game's message box is showing this message at all.
import type { ScreenText } from "@pokehd/emu";
import { messageBoxes, type Message } from "@pokehd/rom";

export interface ScriptView {
  id: number;
  boxes: string[][];
  /** The box showing. */
  index: number;
  /** The player has read it: the game is finishing it (its last box stays up meanwhile). */
  closed: boolean;
  /** The game is done with it (a menu took over, the box closed, or another message began). */
  ended: boolean;
  /** Frames the HD text couldn't show it, or the game's box showed something else. */
  unfit: number;
  /** Every line of the message, to tell its pages on screen from anything else. */
  lines: Set<string>;
  /** Frames the game would take to print each letter (ScriptMessage.letterFrames). */
  letterFrames: number;
  /** Frames the box the player is on has been on the page. */
  shown: number;
  /** Frames the box must be on the page before a tap reads on from it (see `scriptTap`). */
  readyAt: number;
}

export function newScriptView(id: number, message: Message, letterFrames = 0): ScriptView {
  const lines = new Set(message.pages.flatMap((p) => p.lines.map((l) => l.trim())).filter(Boolean));
  const script = { id, boxes: messageBoxes(message), index: 0, closed: false, ended: false, unfit: 0, lines, letterFrames, shown: 0, readyAt: 0 };
  script.readyAt = printFrames(script);
  return script;
}

/**
 * Frames a box must have been on the page before a tap reads on from it, however fast the game
 * prints: a tap landing sooner was meant for what was there before.
 */
export const SCRIPT_MIN_SHOWN_FRAMES = 6;

/** Letters in the box the player is on. */
const letters = (script: ScriptView) => (script.boxes[script.index] ?? []).reduce((n, line) => n + line.length, 0);

/** Frames the game would take to print the box the player is on, at the player's text speed. */
function printFrames(script: ScriptView): number {
  return Math.max(SCRIPT_MIN_SHOWN_FRAMES, letters(script) * script.letterFrames);
}

/**
 * A tap (A or B) on a whole message: `next`, on to its next box; `close`, the player has read
 * it; `wait`, the tap goes nowhere (the box is too new to have been read, or the message was
 * read already and the game is finishing it); `none`, no message takes the tap.
 *
 * A box takes a tap once the game would have printed it at the player's text speed. On the Game
 * Boy the ▼ only takes a fresh press once the last letter is out; a tap while the letters print
 * does nothing (holding A hurries them, a letter a frame, but a tap holds it for only a few).
 * Battle messages follow one another with no tap between them ("CHARMANDER used SCRATCH!", then
 * "Enemy PIDGEY fainted!" a few seconds later), and shown whole and at once, a tap meant for the
 * first, or made before the player could have read the second, closed the second unseen (QA bug
 * 26). Mashing through a long message skipped its middle boxes the same way.
 */
export function scriptTap(script: ScriptView | null): "next" | "close" | "wait" | "none" {
  if (!script || script.ended) return "none";
  if (script.closed || script.shown < script.readyAt) return "wait";
  if (script.index < script.boxes.length - 1) {
    script.index++;
    script.shown = 0;
    script.readyAt = printFrames(script);
    return "next";
  }
  script.closed = true;
  return "close";
}

/**
 * A tap on the message reads on (`scriptTap` says "next" or "close"): its box shows the ▼. Not
 * while the game would still be printing it, nor once it's read and the game only keeps it up
 * (a trainer sliding in under "RED defeated BLUE!", a move's animation under "used EMBER!"):
 * a tap then does nothing, and without the ▼ the box looked like the same message again on every
 * tap (QA bug 56).
 */
export function scriptReady(script: ScriptView | null): boolean {
  return !!script && !script.ended && !script.closed && script.shown >= script.readyAt;
}

/**
 * The screen's text with the message box's state as the page shows a whole message: waiting (the
 * ▼) only when a tap reads on (`scriptReady`), printing while the game would still be printing it,
 * and idle once it's read and only kept up.
 */
export function withScriptState(text: ScreenText, script: ScriptView | null): ScreenText {
  if (!text.dialog) return text;
  const state = scriptReady(script) ? "waiting" : script && !script.closed && !script.ended ? "printing" : "idle";
  return text.dialog.state === state ? text : { ...text, dialog: { ...text.dialog, state } };
}

/** Frames the HD text may not show a message before it goes back to the game's own text. */
export const SCRIPT_UNFIT_FRAMES = 10;

/**
 * Whether a line in the game's box is one of the message's. The ▼ sits in the box's last
 * column, over the 18th letter of a full second line, so that line reads one letter short.
 */
function isOurs(script: ScriptView, line: string): boolean {
  const l = line.trim();
  if (!l || script.lines.has(l)) return true;
  for (const s of script.lines) if (s.length === l.length + 1 && s.startsWith(l)) return true;
  return false;
}

/**
 * This frame's message box from a whole message: the box the player is on (`lines`). Null when
 * no message applies, so the game's own pages show (read through by the DialogJoiner).
 *
 * A message the player has read stays up on its last box for as long as the game's box shows it.
 * The game finishes it at once when a person was talking, but some scripts keep their message on
 * screen while they go on: the nurse's "OK. We'll need your POKéMON." stays up through the whole
 * healing machine (QA bug 19). With the box hidden, the room showed with no words for seconds.
 *
 * The page answers the game's waits for a message it shows, so a message the game's box doesn't
 * match for long (a line read wrong, a name filled in differently) goes back to the game: its
 * own pages show, and taps reach its waits instead of boxes the player can't see.
 */
export function scriptView(
  ref: { current: ScriptView | null },
  text: ScreenText,
  fits: boolean,
  release: (id: number) => void,
): { lines: string[] | null } | null {
  const script = ref.current;
  if (!script) return null;
  const dialog = text.dialog;
  // The message box shows this message's pages (or nothing yet).
  const ours = !dialog || dialog.lines.every((l) => isOurs(script, l));
  if (script.ended && (!dialog || !ours)) {
    ref.current = null;
    return null;
  }
  if (!fits || !ours) {
    // The HD text can't show it here (a screen it doesn't draw), or the game's box shows other
    // words: the game's own text takes over.
    if (!script.closed && !script.ended && ++script.unfit > SCRIPT_UNFIT_FRAMES) {
      release(script.id);
      ref.current = null;
    }
    return null;
  }
  script.unfit = 0;
  script.shown++;
  return { lines: script.boxes[script.index] ?? null };
}
