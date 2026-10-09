// Whole sentences at once (tap-first UI). The game's message box shows two lines and stops at a ▼
// whenever it is full, even mid-sentence. The HD box has room for more, so when a page stops
// before its sentence ends, the page presses A for the player and keeps the lines it read, and the
// box grows to show them together. It stops at the end of a sentence, a question, or when the box
// is full; the player taps on from there as usual. The game still prints every page itself.
import type { ScreenText } from "@pokehd/emu";

/** The most lines the HD message box shows at once. */
export const MAX_DIALOG_LINES = 4;

/** Ends a sentence: . ! ? and the game's … (closing quotes and brackets may follow). */
const SENTENCE_END = /[.!?…]["')\]]*$/;

export class DialogJoiner {
  /** Lines from pages already read past, oldest first. */
  #read: string[] = [];
  /** `pressed`: A was pressed for the player; waiting for the game to move on from the ▼. */
  #phase: "idle" | "pressed" | "continuing" = "idle";

  /**
   * Call with each frame's text (only while the HD text shows it). Returns the lines to show in
   * the message box (null: the game's own two) and whether to press A now.
   */
  frame(text: ScreenText): { lines: string[] | null; press: boolean } {
    const dialog = text.dialog;
    if (!dialog || text.menus.some((m) => m.active)) {
      this.#reset();
      return { lines: null, press: false };
    }
    const page = dialog.lines.filter(Boolean);
    if (this.#phase === "pressed") {
      if (dialog.state === "waiting") return { lines: this.#join(page), press: false };
      this.#phase = "continuing";
    }
    if (dialog.state !== "waiting") {
      // The player read on from the end of a sentence: start afresh.
      if (this.#phase === "idle") this.#read = [];
      return { lines: this.#read.length ? this.#join(page) : null, press: false };
    }
    // Stopped at a ▼.
    this.#phase = "idle";
    const lines = this.#join(page);
    const last = lines.at(-1) ?? "";
    if (!SENTENCE_END.test(last.trim()) && lines.length + 2 <= MAX_DIALOG_LINES) {
      this.#read = lines;
      this.#phase = "pressed";
      return { lines, press: true };
    }
    return { lines: this.#read.length ? lines : null, press: false };
  }

  /** The lines read so far and this page's, without the lines already among them. */
  #join(page: string[]): string[] {
    const read = this.#read;
    if (read.length === 0) return page;
    // The longest run of this page's first lines that are the last lines read (a scroll carries
    // one over; a page not yet moved on carries them all).
    let overlap = Math.min(read.length, page.length);
    while (overlap > 0 && !page.slice(0, overlap).every((line, i) => line === read[read.length - overlap + i])) overlap--;
    return [...read, ...page.slice(overlap)];
  }

  #reset(): void {
    this.#read = [];
    this.#phase = "idle";
  }
}
