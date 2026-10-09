// Whole messages from the script (tap-first UI). When the game starts printing a message, the
// page is handed the whole of it, read from the ROM's text script with the names and numbers the
// game is about to fill in, and shows it in its own box. The Game Boy prints the message's first
// page and waits at its ▼ as usual; the player's buttons are held back meanwhile and reach the page
// instead. Once the page has shown the last of it, the game runs through the rest at its own
// "no text delay" speed, with A pressed for the player at each wait it was always going to stop
// at, so every step of the message (and any code in it) still runs the game's own way.
//
// - `readOn`: the page shows the message's last box. Press the waits inside the message.
// - `close`: the player taps past it. Press the last wait too (its final ▼, or the "press a button"
//   that closes a message box), and the message is over.
// A menu taking input, the message box closing or a new message also end it.
import { decodeText, hasText, readMessage, romOffset, SYMBOLS, waitsOf, type Message, type MessageFill } from "@pokehd/rom";
import { Button, type GameBoy } from "./core.ts";

export interface ScriptMessage {
  id: number;
  message: Message;
}

export interface ScriptTextOptions {
  rom: Uint8Array;
  /** A message starts: the page shows it. */
  onMessage(message: ScriptMessage): void;
  /** The message is over for the game (a menu, the box closed, the next message). */
  onEnd(id: number): void;
  /** Presses a button once for the player (Controls.tap). */
  tap(mask: number): void;
}

/** wStatusFlags5 bit: the game's own switch for printing text without letter delays. */
const NO_TEXT_DELAY = 1 << 6;
/** Frames a closing message may take before it's given up on (a wait we didn't expect). */
const CLOSE_TIMEOUT = 600;
const NAME_LENGTH = 11;

type Phase = "held" | "reading" | "closing";

export class ScriptText {
  readonly #gb: GameBoy;
  readonly #options: ScriptTextOptions;
  readonly #removeHooks: (() => void)[];
  readonly #enemy: string;
  #ids = 0;
  #current: {
    id: number;
    phase: Phase;
    /** Waits inside the message (not its last). */
    inner: number;
    /** All the waits to press once closing (the last one included). */
    total: number;
    pressed: number;
    /** The game is at a wait we haven't pressed yet. */
    waiting: boolean;
    closingFrames: number;
  } | null = null;
  /** wStatusFlags5's no-delay bit before we set it, if we did. */
  #setNoDelay = false;

  constructor(gb: GameBoy, options: ScriptTextOptions) {
    this.#gb = gb;
    this.#options = options;
    const at = romOffset(SYMBOLS.EnemyText);
    this.#enemy = decodeText(options.rom.subarray(at, at + 16));
    this.#removeHooks = [
      gb.addHook("PrintText_NoCreatingTextBox", (g) => this.#start(g)),
      gb.addHook("WaitForTextScrollButtonPress", () => this.#wait()),
      gb.addHook("HandleMenuInput", () => this.#end()),
      gb.addHook("CloseTextDisplay", () => this.#end()),
    ];
  }

  /** A message is showing on the page: the player's buttons go to the page, not the game. */
  get holding(): boolean {
    return this.#current !== null && this.#current.phase !== "closing";
  }

  /** A message is under way (no resume point now: the no-delay flag may be set). */
  get active(): boolean {
    return this.#current !== null;
  }

  /** The page shows the message's last box: run the game through the waits inside it. */
  readOn(id: number): void {
    const m = this.#current;
    if (!m || m.id !== id || m.phase !== "held") return;
    m.phase = "reading";
    if (m.waiting) this.#wait(false);
  }

  /** The player has read the message: run the game through the rest of it. */
  close(id: number): void {
    const m = this.#current;
    if (!m || m.id !== id || m.phase === "closing") return;
    m.phase = "closing";
    if (m.waiting) this.#wait(false);
    if (m.pressed >= m.total) this.#end();
  }

  /** The page can't show the message after all: the game's own text takes over, untouched. */
  release(id: number): void {
    if (this.#current?.id === id) this.#end();
  }

  /** Call once per emulated frame. */
  frame(): void {
    const m = this.#current;
    if (m?.phase === "closing" && ++m.closingFrames > CLOSE_TIMEOUT) this.#end();
  }

  dispose(): void {
    for (const remove of this.#removeHooks) remove();
    this.#end();
  }

  #start(g: GameBoy): void {
    const hl = g.registers.hl;
    const bank = hl < 0x4000 ? 0 : g.read(SYMBOLS.hLoadedROMBank.address);
    const message = readMessage(this.#options.rom, bank, hl, this.#fill(g));
    if (!hasText(message)) return;
    this.#end();
    const waits = waitsOf(message);
    const inner = message.ending === "prompt" ? waits - 1 : waits;
    // A `done` message ends with no ▼ of its own; a message box from a person then waits for a
    // button before it closes. Code taking over decides for itself.
    const total = message.ending === "done" ? waits + 1 : waits;
    this.#current = { id: ++this.#ids, phase: "held", inner, total, pressed: 0, waiting: false, closingFrames: 0 };
    this.#noDelay(true);
    this.#options.onMessage({ id: this.#ids, message });
  }

  /** The game waits for A or B: press it when the page has read that far. */
  #wait(entered = true): void {
    const m = this.#current;
    if (!m) return;
    if (entered) m.waiting = true;
    const press = m.phase === "closing" ? m.pressed < m.total : m.phase === "reading" && m.pressed < m.inner;
    if (!press) return;
    m.waiting = false;
    m.pressed++;
    this.#options.tap(Button.A);
    if (m.phase === "closing" && m.pressed >= m.total) this.#end();
  }

  #end(): void {
    const m = this.#current;
    if (!m) return;
    this.#current = null;
    this.#noDelay(false);
    this.#options.onEnd(m.id);
  }

  #noDelay(on: boolean): void {
    const address = SYMBOLS.wStatusFlags5.address;
    const flags = this.#gb.read(address);
    if (on && !(flags & NO_TEXT_DELAY)) {
      this.#gb.write(address, flags | NO_TEXT_DELAY);
      this.#setNoDelay = true;
    } else if (!on && this.#setNoDelay) {
      this.#gb.write(address, flags & ~NO_TEXT_DELAY);
      this.#setNoDelay = false;
    }
  }

  /** Names and numbers as the game is about to print them. */
  #fill(g: GameBoy): MessageFill {
    const name = (address: number) => decodeText(g.readBytes(address, NAME_LENGTH));
    const mon = (side: number) => (side === 0 ? name(SYMBOLS.wBattleMonNick.address) : this.#enemy + name(SYMBOLS.wEnemyMonNick.address));
    return {
      name: (code) => {
        if (code === 0x52) return name(SYMBOLS.wPlayerName.address);
        if (code === 0x53) return name(SYMBOLS.wRivalName.address);
        const turn = g.read(SYMBOLS.hWhoseTurn.address);
        return mon(code === 0x5a ? turn : turn ^ 1);
      },
      ram: (address) => decodeText(g.readBytes(address, 20)),
      number: (command, address, format) => {
        if (command === "bcd") {
          const length = format & 0x1f;
          let digits = [...g.readBytes(address, length)].map((b) => `${b >> 4}${b & 0xf}`).join("");
          if (format & 0x80) digits = digits.replace(/^0+(?=\d)/, "");
          return (format & 0x20 ? "¥" : "") + digits;
        }
        const bytes = format >> 4;
        let value = 0;
        for (const b of g.readBytes(address, bytes)) value = value * 256 + b;
        return String(value);
      },
    };
  }
}
