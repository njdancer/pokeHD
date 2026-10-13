// Whole messages from the script (tap-first UI). When the game starts printing a message, the
// page is handed the whole of it, read from the ROM's text script with the names and numbers the
// game is about to fill in, and shows it in its own box. The game's own text engine still prints
// every bit of the message, runs its sounds, boxes and code, at its own "no text delay" speed.
// Only its waits for a button are ours: at each one (`ManualTextScroll`, the ▼ between pages, or
// `WaitForTextScrollButtonPress` called directly, as after a message from a person) the CPU waits
// a frame at a time (DelayFrame, returning to the wait) until the page has read that far, then
// returns from the wait as if A had been pressed, without the press or its click. So the Game Boy
// shows the message's first page while the page shows all of it, and music and sprites carry on.
// The player's buttons are held back meanwhile and reach the page instead.
//
// - `readOn`: the page shows the message's last box. Let the waits inside the message pass.
// - `close`: the player taps past it. Let the last wait pass too (its final ▼, or the "press a
//   button" that closes a message box), and the message is over.
// A menu taking input, the message box closing or a new message also end it.
import { decodeText, hasText, readMessage, romOffset, SYMBOLS, waitsOf, type Message, type MessageFill } from "@pokehd/rom";
import type { GameBoy } from "./core.ts";
import { acting } from "./game/acting.ts";

export interface ScriptMessage {
  id: number;
  message: Message;
  /**
   * Frames the game would spend printing each letter at the player's text speed (0 when it
   * prints at once). The game's ▼ only takes a press once its letters are out, so the page
   * doesn't read on from a box until it has been up that long.
   */
  letterFrames: number;
}

export interface ScriptTextOptions {
  rom: Uint8Array;
  /** A message starts: the page shows it. */
  onMessage(message: ScriptMessage): void;
  /** The message is over for the game (a menu, the box closed, the next message). */
  onEnd(id: number): void;
}

/** wStatusFlags5 bit: the game's own switch for printing text without letter delays. */
const NO_TEXT_DELAY = 1 << 6;
/** wLetterPrintingDelayFlags bits (PrintLetterDelay): a delay at all, and the options' speed. */
const TEXT_DELAY = 1 << 1;
const FAST_TEXT_DELAY = 1 << 0;
/** wLinkState in a link battle: ManualTextScroll waits on a timer there, not on buttons. */
const LINK_STATE_BATTLING = 4;
/** Frames a closing message may take before it's given up on (a wait we didn't expect). */
const CLOSE_TIMEOUT = 600;
/**
 * Frames after the player closes a `done` message within which the game's next wait still counts
 * as the one that closes its box. One that comes later is for something else.
 */
const CLOSING_WAIT_FRAMES = 30;
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
    /** The message's own waits (its ▼s and text_waitbuttons). */
    own: number;
    /** All the waits to let pass once closing (the last one included). */
    total: number;
    passed: number;
    closingFrames: number;
  } | null = null;
  /** wStatusFlags5's no-delay bit before we set it, if we did. */
  #setNoDelay = false;

  constructor(gb: GameBoy, options: ScriptTextOptions) {
    this.#gb = gb;
    this.#options = options;
    this.#enemy = enemyPrefix(options.rom);
    this.#removeHooks = [
      gb.addHook("PrintText_NoCreatingTextBox", (g) => this.#start(g)),
      gb.addHook("ManualTextScroll", (g) => {
        if (g.read(SYMBOLS.wLinkState.address) !== LINK_STATE_BATTLING) this.#wait(g, SYMBOLS.ManualTextScroll.address);
      }),
      gb.addHook("WaitForTextScrollButtonPress", (g) => this.#wait(g, SYMBOLS.WaitForTextScrollButtonPress.address)),
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

  /** The page shows the message's last box: let the waits inside it pass. */
  readOn(id: number): void {
    const m = this.#current;
    if (m?.id === id && m.phase === "held") m.phase = "reading";
  }

  /** The player has read the message: let the rest of it pass. */
  close(id: number): void {
    const m = this.#current;
    if (!m || m.id !== id || m.phase === "closing") return;
    m.phase = "closing";
    if (m.passed >= m.total) this.#end();
  }

  /** The page can't show the message after all: the game's own waits take over. */
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
    // Printed by one of our own calls (the Pokédex menu's actions): those answer their own waits.
    if (acting.has(g)) return;
    const message = printingMessage(g, this.#options.rom, this.#enemy);
    if (!hasText(message)) return;
    this.#end();
    const waits = waitsOf(message);
    const inner = message.ending === "prompt" ? waits - 1 : waits;
    // A `done` message ends with no ▼ of its own; a message box from a person then waits for a
    // button before it closes. Code taking over decides for itself.
    const total = message.ending === "done" ? waits + 1 : waits;
    this.#current = { id: ++this.#ids, phase: "held", inner, own: waits, total, passed: 0, closingFrames: 0 };
    const letterFrames = letterDelay(g);
    this.#noDelay(true);
    this.#options.onMessage({ id: this.#ids, message, letterFrames });
  }

  /** The game waits for A or B (at `routine`'s start): ours while a message is on the page. */
  #wait(g: GameBoy, routine: number): void {
    const m = this.#current;
    if (!m) return;
    // A `done` message's closing wait only if it was already waiting, or comes right after: in
    // battle the next wait is often for what comes next. After "CHARMANDER grew to level 16!" the
    // game plays its jingle, then waits under the stats box, which a tap during the jingle must
    // not pass unseen (QA bug 26). The game's own wait then; a tap there reads on as usual.
    if (m.phase === "closing" && m.passed >= m.own && m.closingFrames > CLOSING_WAIT_FRAMES) {
      this.#end();
      return;
    }
    const pass = m.phase === "closing" ? m.passed < m.total : m.phase === "reading" && m.passed < m.inner;
    if (pass) {
      // Return from the wait, as if the button had been pressed.
      m.passed++;
      const sp = g.registers.sp;
      g.setRegisters({ pc: g.read(sp) | (g.read(sp + 1) << 8), sp: (sp + 2) & 0xffff });
      if (m.phase === "closing" && m.passed >= m.total) this.#end();
      return;
    }
    // A wait past the ones we expected: the game's own, for the player's buttons.
    if (m.phase === "closing") return;
    // Not read that far yet: wait a frame, then come back to the wait (DelayFrame returns to it).
    const sp = (g.registers.sp - 2) & 0xffff;
    g.write(sp, routine & 0xff);
    g.write(sp + 1, routine >> 8);
    g.setRegisters({ sp, pc: SYMBOLS.DelayFrame.address });
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
}

/**
 * Frames PrintLetterDelay would wait after each letter of the message about to print (read
 * before we turn the delay off). TextCommandProcessor turns the delay on for the message, less
 * any bits in hClearLetterPrintingDelayFlags; battles start with it off, so it's read as it will
 * be, not as it is.
 */
export function letterDelay(g: GameBoy): number {
  if (g.read(SYMBOLS.wStatusFlags5.address) & NO_TEXT_DELAY) return 0;
  const flags = (g.read(SYMBOLS.wLetterPrintingDelayFlags.address) | TEXT_DELAY) ^ g.read(SYMBOLS.hClearLetterPrintingDelayFlags.address);
  if (!(flags & TEXT_DELAY)) return 0;
  return flags & FAST_TEXT_DELAY ? g.read(SYMBOLS.wOptions.address) & 0xf : 1;
}

/** "Enemy " as the game prefixes a foe's Pokémon's name. */
export function enemyPrefix(rom: Uint8Array): string {
  const at = romOffset(SYMBOLS.EnemyText);
  return decodeText(rom.subarray(at, at + 16));
}

/**
 * The message the game is about to print, at `PrintText_NoCreatingTextBox` (hl points at its
 * text script, in the bank switched in), with the names and numbers it will fill in.
 */
export function printingMessage(g: GameBoy, rom: Uint8Array, enemy: string): Message {
  const { hl } = g.registers;
  const bank = hl < 0x4000 ? 0 : g.read(SYMBOLS.hLoadedROMBank.address);
  return readMessage(rom, bank, hl, messageFill(g, enemy));
}

/** Names and numbers as the game is about to print them. */
function messageFill(g: GameBoy, enemy: string): MessageFill {
  const name = (address: number) => decodeText(g.readBytes(address, NAME_LENGTH));
  const mon = (side: number) => (side === 0 ? name(SYMBOLS.wBattleMonNick.address) : enemy + name(SYMBOLS.wEnemyMonNick.address));
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
        return (format & 0x20 ? "₽" : "") + digits;
      }
      const bytes = format >> 4;
      let value = 0;
      for (const b of g.readBytes(address, bytes)) value = value * 256 + b;
      return String(value);
    },
  };
}
