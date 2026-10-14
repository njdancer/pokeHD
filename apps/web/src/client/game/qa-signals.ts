// For scripted play (?stats, the QA harness in apps/qa): whether the page would take the player's
// next input now, and every line the message box showed, in order. Read only through
// `window.__pokehd`; nothing here changes what the page does.
import type { GameInputWait } from "@pokehd/emu";

/** The message box's state as the page shows it (see @pokehd/emu's DialogState and withScriptState). */
export type BoxState = "printing" | "waiting" | "idle";

/** What the page knows this frame about who has the player's next input. */
export interface PageInputFacts {
  mode: "overworld" | "dialog" | "battle" | null;
  inWorld: boolean;
  /** The message box the player sees (the HD one, or the Game Boy's): its state, or null with none up. */
  dialog: BoxState | null;
  /** A menu on screen takes input (its cursor is ▶). */
  menu: boolean;
  /** The HD message box shows a whole message from the script that isn't over: a tap is the page's (scriptTap). */
  pageHolds: boolean;
  /** Where the game itself waits for buttons this frame (@pokehd/emu's gameInputWait). */
  game: GameInputWait | null;
  /** The HD battle menu is asking (the game waits in HandleMenuInput for its answer). */
  battleAsk: boolean;
  /** A page menu is up over the game: the Pokédex menu, a question as a sheet, the HD Pokédex. */
  sheet: boolean;
  /** One of the Pokédex menu's actions is running the game's own routine. */
  acting: boolean;
}

/**
 * Whether a tap now does something:
 * - `message`: the box shows its ▼, a tap reads on (scriptReady, or the game's own ▼); or the game
 *   waits for A or B with no ▼ (the stats box after a level).
 * - `battle-menu`, `sheet`, `menu`: a menu waits for a choice.
 * - `free`: the player can walk (the game's overworld loop with nothing holding it).
 *
 * Or why not: `printing` (the box's words are still coming), `message-held` (read, or with no ▼:
 * the game keeps it up while it does something, an animation or a jingle), `battle` (between a
 * battle's messages and menus: its animations), `busy` (walking, a script, a warp, or the page
 * on its way into the game), `acting`. The page's own screens (its start screen, the name prompt,
 * its dialogs) take taps whatever this says: the harness sees those itself.
 */
export type PageInput =
  | { ready: true; on: "message" | "battle-menu" | "sheet" | "menu" | "free" }
  | { ready: false; why: "printing" | "message-held" | "battle" | "busy" | "acting" };

export function pageInput(f: PageInputFacts): PageInput {
  if (f.battleAsk) return { ready: true, on: "battle-menu" };
  if (f.sheet) return { ready: true, on: "sheet" };
  if (f.acting) return { ready: false, why: "acting" };
  if (f.dialog === "waiting") return { ready: true, on: "message" };
  if (f.menu) return { ready: true, on: "menu" };
  // The page answers the game's waits for a message it shows: only its ▼ says a tap reads on.
  if (f.pageHolds) return { ready: false, why: f.dialog === "printing" ? "printing" : "message-held" };
  if (f.game === "button") return { ready: true, on: "message" };
  // Not the game's `menu` wait: the page's stand-ins (the HD battle menu, the sheets) idle in
  // HandleMenuInput until their question reaches the page. A menu the player sees is `menu` above.
  if (f.dialog === "printing") return { ready: false, why: "printing" };
  if (f.dialog === "idle") return { ready: false, why: "message-held" };
  if (f.mode === "battle") return { ready: false, why: "battle" };
  // Before the world (the page's start, Oak's introduction) the page's own screens and messages
  // take taps, and those are above; what's left is the page or the game on its way.
  if (f.inWorld && f.game === "overworld") return { ready: true, on: "free" };
  return { ready: false, why: "busy" };
}

export interface LoggedLine {
  /** Counts up from 1 for this page. */
  seq: number;
  /** Lines of one box (or one box's scroll) share a group, so they read back as one message. */
  group: number;
  text: string;
}

/** How many lines are kept: far more than one action shows. */
const KEEP = 200;

/**
 * Every line the message box showed, in order, once its words were out. Battle messages the game
 * moves on from by itself ("Enemy BULBASAUR used GROWL!" before "But, it failed!") are gone by the
 * time anyone looks; this keeps them (QA bug 65).
 */
export class MessageLog {
  readonly lines: LoggedLine[] = [];
  #seq = 0;
  #group = 0;
  /** The box's lines as last logged. */
  #shown: string[] = [];

  /**
   * The box this frame: its lines, or null when it's closed. `settled`: its words are all out
   * (a whole message is, from the start; the game's own text once it stops printing).
   */
  show(lines: readonly string[] | null, settled: boolean): void {
    if (!lines) {
      this.#shown = [];
      return;
    }
    if (!settled) return;
    const now = lines.map((l) => l.trim()).filter(Boolean);
    if (!now.length) return;
    const was = this.#shown;
    this.#shown = now;
    // The same box, further on: its lines so far, then more; or the same lines with the last a
    // letter longer (the ▼ over a full line's last letter went; "'s" is one letter, two here).
    const last = was.length - 1;
    const grown = (i: number) => now.length === was.length && i === last && now[i]!.startsWith(was[i]!) && now[i]!.length <= was[i]!.length + 2;
    const goesOn = was.length > 0 && now.length >= was.length && was.every((l, i) => now[i] === l || grown(i));
    if (goesOn) {
      const logged = this.lines.at(-1);
      if (logged && now[last] !== was[last] && logged.text === was[last]) {
        logged.text = now[last]!;
        logged.seq = ++this.#seq;
      }
      this.#add(now.slice(was.length));
      return;
    }
    // The box scrolled up a line: its last line is now its first.
    if (was.length && now.length > 1 && now[0] === was[last]) return this.#add(now.slice(1));
    this.#group++;
    this.#add(now);
  }

  #add(lines: string[]): void {
    for (const text of lines) this.lines.push({ seq: ++this.#seq, group: this.#group, text });
    if (this.lines.length > KEEP) this.lines.splice(0, this.lines.length - KEEP);
  }

  /** The lines logged (or grown) after `seq`, in the order they showed. */
  since(seq: number): LoggedLine[] {
    return this.lines.filter((l) => l.seq > seq);
  }

  get seq(): number {
    return this.#seq;
  }
}
