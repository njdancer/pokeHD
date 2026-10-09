// The page's own start (tap-first UI): instead of the title screen and the CONTINUE / NEW GAME
// menu on the Game Boy screen, the page shows its own start screen, then presses the game's
// buttons for the player's choice. START until the main menu shows, then the choice; for
// CONTINUE, A on the box with the save's details, until the world loads. The game's title and
// menus still run, unseen; nothing in them changes.
import { Button, type ScreenText } from "@pokehd/emu";

export type StartChoice = "continue" | "new";

export interface Presser {
  tap(mask: number): void;
  select(item: number, press: boolean): void;
}

/** Frames between START taps on the way to the main menu (the intro and title read new presses). */
const START_EVERY = 10;
/** Frames between A taps on the CONTINUE box, so one tap is read before the next. */
const CONFIRM_EVERY = 24;
/** Frames to wait for the CONTINUE box before going back to look for the menu. */
const CONFIRM_TIMEOUT = 180;

const mainMenu = (text: ScreenText) => text.menus.find((m) => m.items.some((i) => i.text === "NEW GAME"));
/** The box CONTINUE shows: the trainer, badges, Pokédex and time, waiting for A. */
const saveDetails = (text: ScreenText) => text.boxes.some((b) => b.lines.some((l) => l.text.startsWith("PLAYER")));

export class Starter {
  readonly choice: StartChoice;
  readonly #press: Presser;
  #phase: "menu" | "confirm" | "done" = "menu";
  #last = -Infinity;
  #since = 0;

  constructor(choice: StartChoice, press: Presser) {
    this.choice = choice;
    this.#press = press;
  }

  get done(): boolean {
    return this.#phase === "done";
  }

  /** Call with every frame's decoded text; `count` is the emulator's frame number. */
  frame(text: ScreenText, inWorld: boolean, count: number): void {
    if (this.#phase === "done") return;
    if (inWorld) {
      this.#phase = "done";
      return;
    }
    const menu = mainMenu(text);
    if (this.#phase === "menu") {
      if (menu) {
        const want = this.choice === "continue" ? "CONTINUE" : "NEW GAME";
        const index = menu.items.findIndex((i) => i.text === want);
        // No CONTINUE (the save went bad since): start a new game rather than stall.
        this.#press.select(index >= 0 ? index : menu.items.findIndex((i) => i.text === "NEW GAME"), true);
        this.#phase = this.choice === "continue" && index >= 0 ? "confirm" : "done";
        this.#last = count;
        this.#since = count;
      } else if (count - this.#last >= START_EVERY) {
        this.#press.tap(Button.Start);
        this.#last = count;
      }
      return;
    }
    // Confirming CONTINUE.
    if (saveDetails(text)) {
      if (count - this.#last >= CONFIRM_EVERY) {
        this.#press.tap(Button.A);
        this.#last = count;
      }
    } else if (menu && count - this.#since > CONFIRM_TIMEOUT) {
      this.#phase = "menu"; // the choice didn't take: pick it again
    }
  }
}
