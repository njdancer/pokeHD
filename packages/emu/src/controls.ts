// Tap-first controls: the page's own buttons and keyboard press the game's buttons for the
// player, the game's own way. A tap on a menu choice moves the game's cursor there and presses
// A; a name typed on the device's keyboard goes in through the game's naming screen. Nothing in
// the game changes, only who presses the buttons, so every menu still runs its own code.
//
// Names: when the intro asks the player's or the rival's name, or the naming screen opens (a
// nickname), the page is asked instead and the player's buttons are held back until it answers.
// An answer picks NEW NAME in the intro's list, writes the letters into the naming screen's
// buffer (what typing them would have left there) and presses START, which submits it. A null
// answer hands the game's own screen back to the player.
import { SYMBOLS } from "@pokehd/rom";
import { Button, type GameBoy } from "./core.ts";
import { ScriptText, type ScriptMessage } from "./script-text.ts";

/** Whose name is asked for: from the intro's NEW NAME list, or the naming screen itself. */
export interface NameAsk {
  kind: "player" | "rival" | "mon";
  /** `intro`: Oak is asking (before the list of names). `screen`: the naming screen opened. */
  from: "intro" | "screen";
  /** For a Pokémon, its species (to show its name as the default). */
  species?: number;
}

export interface ControlsOptions {
  /** The page answers name questions (see `answerName`); off, the game's own screens show. */
  names?: { ask(ask: NameAsk): void; done(): void };
  /**
   * Whole messages from the script (ScriptText): the page shows each message, and the player's A
   * and B go to the page (`press`) while it does.
   */
  script?: { message(message: ScriptMessage): void; end(id: number): void; press(): void };
  /** Where the buttons go (the erase guard, or the Game Boy). */
  setButtons(mask: number): void;
}

/** A button press: held this many frames, then released this many (menus read new presses). */
const TAP_DOWN = 2;
const TAP_UP = 3;
/** How many cursor moves a `select` may take before it gives up (a menu that closed, …). */
const SELECT_STEPS = 24;

type Step = { mask: number; frames: number };

const NAMING_TYPES: readonly NameAsk["kind"][] = ["player", "rival"];

export class Controls {
  readonly #gb: GameBoy;
  readonly #options: ControlsOptions;
  readonly #removeHooks: (() => void)[] = [];
  #player = 0;
  /**
   * Buttons the player pressed that no frame has run with yet. A tap pressed and let go between
   * two frames (a quick touch, a busy page) would otherwise never reach the game: each is held
   * for at least the next frame.
   */
  #unseen = 0;
  #sent = -1;
  /** Button presses queued by taps, frame by frame. */
  #steps: Step[] = [];
  /** A cursor move in progress: the item it goes to, and whether A follows. */
  #select: { item: number; press: boolean; steps: number } | null = null;
  /** Waiting for the page's name: the player's buttons are held back. */
  #asking: NameAsk | null = null;
  /** The page's name, on its way into the naming screen (null once written). */
  #name: Uint8Array | null = null;
  /** Pressing A on NEW NAME, or START on the naming screen, until the game moves on. */
  #pressing = 0;

  #script: ScriptText | null = null;

  constructor(gb: GameBoy, options: ControlsOptions) {
    this.#gb = gb;
    this.#options = options;
    const names = options.names;
    if (!names) return;
    this.#removeHooks.push(
      // Asked as Oak starts "First, what is your name?", so the page's Oak (who already knows
      // a signed-in player's name) speaks instead; the game's line goes by unseen.
      gb.addHook("PrintText", (g) => {
        const intro = SYMBOLS.IntroducePlayerText;
        if (g.registers.hl === intro.address && g.read(SYMBOLS.hLoadedROMBank.address) === intro.bank) this.#ask({ kind: "player", from: "intro" });
      }),
      gb.addHook("ChoosePlayerName", () => {
        // Already asked (above), or answered and on its way in: carry on.
        if (this.#asking?.kind === "player" || this.#name) return;
        this.#ask({ kind: "player", from: "intro" });
      }),
      gb.addHook("ChooseRivalName", () => this.#ask({ kind: "rival", from: "intro" })),
      gb.addHook("DisplayNamingScreen", (g) => {
        // From the intro with the page's name: carry on. Otherwise (a nickname) ask.
        if (this.#name) {
          this.#pressing = 0;
          return;
        }
        if (this.#asking) return;
        const type = g.read(SYMBOLS.wNamingScreenType.address);
        const kind = NAMING_TYPES[type] ?? "mon";
        this.#ask({ kind, from: "screen", ...(kind === "mon" ? { species: g.read(SYMBOLS.wCurPartySpecies.address) } : {}) });
      }),
      gb.addHook("DisplayNamingScreen.inputLoop", (g) => {
        const name = this.#name;
        if (!name || this.#asking) return;
        // What typing the letters would have left in the buffer; START then submits it.
        name.forEach((code, i) => g.write(SYMBOLS.wStringBuffer.address + i, code));
        this.#name = null;
        this.#pressing = Button.Start;
      }),
      gb.addHook("DisplayNamingScreen.submitNickname", () => {
        if (!this.#pressing && !this.#asking) return;
        this.#pressing = 0;
        this.#asking = null;
        this.#name = null;
        this.#apply();
        names.done();
      }),
    );
  }

  /** True while the game is waiting on the page (a name) or the page is pressing buttons. */
  get busy(): boolean {
    return this.#asking !== null || this.#name !== null || this.#pressing !== 0 || this.#steps.length > 0 || this.#select !== null || !!this.#script?.active;
  }

  /** The player's own buttons (keyboard, gamepad, touch pad). Held back while the page drives. */
  setButtons(mask: number): void {
    // A message on the page: A or B reads on there.
    const pressed = mask & ~this.#player;
    if (this.#script?.holding && pressed & (Button.A | Button.B)) this.#options.script?.press();
    this.#unseen |= pressed;
    this.#player = mask;
    this.#apply();
  }

  /** Taps buttons once (a mask, so A+B is one tap), after any taps already queued. */
  tap(mask: number): void {
    this.#steps.push({ mask, frames: TAP_DOWN }, { mask: 0, frames: TAP_UP });
  }

  /**
   * Moves the open menu's cursor (wCurrentMenuItem) to `item`, then presses A if `press`. The
   * game moves the cursor itself, one Up or Down at a time, so wrapping and lists scroll as usual.
   */
  select(item: number, press: boolean): void {
    this.#select = { item, press, steps: 0 };
  }

  /**
   * The page's name for the question asked (see `NameAsk`), as `encodeName` writes it; null
   * gives the game's own screen back to the player. Ignored if nothing is being asked.
   */
  answerName(name: Uint8Array | null): void {
    const ask = this.#asking;
    if (!ask) return;
    this.#asking = null;
    if (!name) {
      this.#apply();
      return;
    }
    this.#name = name;
    // In the intro, A reads past Oak's question, then picks NEW NAME (where the cursor starts) in
    // the list, which opens the naming screen.
    if (ask.from === "intro") this.#pressing = Button.A;
  }

  /** Turns whole messages from the script (`ControlsOptions.script`) on or off. */
  setScriptText(rom: Uint8Array | null): void {
    this.#script?.dispose();
    this.#script = null;
    const script = this.#options.script;
    if (rom && script) this.#script = new ScriptText(this.#gb, { rom, onMessage: script.message, onEnd: script.end });
    this.#apply();
  }

  /** The page shows the message's last box (ScriptText.readOn). */
  readOn(id: number): void {
    this.#script?.readOn(id);
  }

  /** The page can't show the message (ScriptText.release). */
  releaseMessage(id: number): void {
    this.#script?.release(id);
  }

  /** The player has read the message (ScriptText.close). */
  closeMessage(id: number): void {
    this.#script?.close(id);
  }

  /** Call once per emulated frame, before it runs. */
  frame(): void {
    this.#script?.frame();
    if (this.#steps.length === 0 && this.#select) this.#planSelect();
    const step = this.#steps[0];
    if (step && --step.frames <= 0) this.#steps.shift();
    this.#apply(step?.mask);
    // This frame runs with them; the next has the buttons as they are by then.
    this.#unseen = 0;
  }

  dispose(): void {
    this.#script?.dispose();
    for (const remove of this.#removeHooks) remove();
  }

  #ask(ask: NameAsk): void {
    this.#asking = ask;
    this.#name = null;
    this.#pressing = 0;
    this.#steps = [];
    this.#select = null;
    this.#apply();
    this.#options.names?.ask(ask);
  }

  #planSelect(): void {
    const select = this.#select!;
    const at = this.#gb.read(SYMBOLS.wCurrentMenuItem.address);
    if (at === select.item || select.steps++ >= SELECT_STEPS) {
      this.#select = null;
      if (at === select.item && select.press) this.tap(Button.A);
      return;
    }
    this.tap(at < select.item ? Button.Down : Button.Up);
  }

  /** Sends the buttons for this frame: the page's press, else nothing while it drives, else the player's. */
  #apply(press?: number): void {
    let mask = this.#player | this.#unseen;
    if (press !== undefined) mask = press;
    else if (this.#pressing) mask = this.#tapping(this.#pressing);
    else if (this.#asking || this.#name || this.#steps.length || this.#select || this.#script?.holding) mask = 0;
    if (mask === this.#sent) return;
    this.#sent = mask;
    this.#options.setButtons(mask);
  }

  #frame = 0;
  /** A button pressed and released in turn, so the game sees a new press every few frames. */
  #tapping(mask: number): number {
    return this.#frame++ % (TAP_DOWN + TAP_UP) < TAP_DOWN ? mask : 0;
  }
}
