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
}

export function newScriptView(id: number, message: Message): ScriptView {
  const lines = new Set(message.pages.flatMap((p) => p.lines.map((l) => l.trim())).filter(Boolean));
  return { id, boxes: messageBoxes(message), index: 0, closed: false, ended: false, unfit: 0, lines };
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
  return { lines: script.boxes[script.index] ?? null };
}
