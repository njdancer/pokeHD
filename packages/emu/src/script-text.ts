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
//
// Standing in: for a simple message (only text, names, numbers and waits; see Message.simple),
// the game's printing routine doesn't run at all. Where it would start, the CPU instead waits a
// frame at a time (DelayFrame, returning to the same spot) while the page shows the message, so
// music, sprites and timers carry on. The message's first page is written into the box, so the
// Game Boy screen shows it. When the page has read far enough (to the end for a `prompt`, to the
// last box otherwise), the last page goes into the box and the routine returns to its caller,
// as if it had printed everything, or jumps to the message's `text_asm` code the way the text
// engine does. Messages with sounds, boxes or special scripts use the routine as before.
import { decodeText, FONT_CHARS, hasText, readMessage, romOffset, SYMBOLS, TEXT_BOX_CHARS, waitsOf, type Message, type MessageFill } from "@pokehd/rom";
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
  /**
   * Stand in for the game's printing routine on simple messages (default true): the game doesn't
   * print them at all, it waits while the page shows them (see "Standing in" below).
   */
  replace?: boolean;
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
  /** Standing in for the printing routine: the message the CPU is waiting on. */
  #standIn: {
    id: number;
    /** The routine's arguments, to hand it back untouched. */
    hl: number;
    bc: number;
    /** `close`: return once the player has read it all (a `prompt`). `readOn`: at the last box. */
    returnAt: "readOn" | "close";
    last: [string, string];
    asm?: { bank: number; address: number };
  } | null = null;
  readonly #codes: Map<string, number>;

  constructor(gb: GameBoy, options: ScriptTextOptions) {
    this.#gb = gb;
    this.#options = options;
    const at = romOffset(SYMBOLS.EnemyText);
    this.#enemy = decodeText(options.rom.subarray(at, at + 16));
    this.#codes = new Map<string, number>([[" ", 0x7f]]);
    TEXT_BOX_CHARS.forEach((c, i) => c?.length === 1 && c !== " " && this.#codes.set(c, 0x60 + i));
    FONT_CHARS.forEach((c, i) => c.length === 1 && c !== " " && this.#codes.set(c, 0x80 + i));
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
    if (m.pressed >= m.total && !this.#standIn) this.#end();
  }

  /** The page can't show the message after all: the game's own text takes over, untouched. */
  release(id: number): void {
    if (this.#current?.id !== id) return;
    // Standing in: the routine runs after all, from the start, at the next frame.
    this.#end();
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
    // Back from a frame's wait while standing in.
    if (this.#standIn) return this.#standingIn(g);
    const { hl, bc } = g.registers;
    const loaded = g.read(SYMBOLS.hLoadedROMBank.address);
    const bank = hl < 0x4000 ? 0 : loaded;
    const message = readMessage(this.#options.rom, bank, hl, this.#fill(g));
    if (!hasText(message)) return;
    this.#end();
    const asm = message.asm;
    if (this.#options.replace !== false && message.simple && (!asm || asm.address < 0x4000 || asm.bank === loaded)) {
      // A message from a person (`done`) leaves the box open until a button is pressed.
      this.#current = { id: ++this.#ids, phase: "held", inner: 0, total: message.ending === "done" ? 1 : 0, pressed: 0, waiting: false, closingFrames: 0 };
      const pages = message.pages.filter((p) => p.lines.some(Boolean));
      this.#standIn = {
        id: this.#ids,
        hl,
        bc,
        returnAt: message.ending === "prompt" ? "close" : "readOn",
        last: pages.at(-1)?.lines ?? ["", ""],
        ...(asm ? { asm } : {}),
      };
      this.#draw(g, pages[0]?.lines ?? ["", ""]);
      this.#options.onMessage({ id: this.#ids, message });
      this.#standingIn(g);
      return;
    }
    const waits = waitsOf(message);
    const inner = message.ending === "prompt" ? waits - 1 : waits;
    // A `done` message ends with no ▼ of its own; a message box from a person then waits for a
    // button before it closes. Code taking over decides for itself.
    const total = message.ending === "done" ? waits + 1 : waits;
    this.#current = { id: ++this.#ids, phase: "held", inner, total, pressed: 0, waiting: false, closingFrames: 0 };
    this.#noDelay(true);
    this.#options.onMessage({ id: this.#ids, message });
  }

  /** Standing in for the printing routine: wait another frame, or return as if it had printed. */
  #standingIn(g: GameBoy): void {
    const s = this.#standIn!;
    const m = this.#current;
    if (m?.id === s.id && (s.returnAt === "readOn" ? m.phase === "held" : m.phase !== "closing")) {
      // DelayFrame returns here, to the routine's start, and this runs again next frame.
      this.#push(g, SYMBOLS.PrintText_NoCreatingTextBox.address);
      g.setRegisters({ pc: SYMBOLS.DelayFrame.address });
      return;
    }
    this.#standIn = null;
    if (m?.id !== s.id) {
      // Released: the routine prints it after all.
      g.setRegisters({ hl: s.hl, bc: s.bc });
      return;
    }
    this.#draw(g, s.last);
    if (s.asm) {
      // As the text engine runs `text_asm`: its saved delay flags, then NextTextCommand to
      // return to, under the code.
      this.#push(g, g.read(SYMBOLS.wLetterPrintingDelayFlags.address) << 8);
      this.#push(g, SYMBOLS.NextTextCommand.address);
      g.setRegisters({ hl: s.asm.address, pc: s.asm.address });
    } else {
      const sp = g.registers.sp;
      g.setRegisters({ pc: g.read(sp) | (g.read(sp + 1) << 8), sp: sp + 2 });
    }
    if (m.phase === "closing" && m.pressed >= m.total) this.#end();
  }

  #push(g: GameBoy, value: number): void {
    const sp = (g.registers.sp - 2) & 0xffff;
    g.write(sp, value & 0xff);
    g.write(sp + 1, (value >> 8) & 0xff);
    g.setRegisters({ sp });
  }

  /** Writes a page into the message box (its two text rows), as printing it would have. */
  #draw(g: GameBoy, lines: readonly string[]): void {
    const map = SYMBOLS.wTileMap.address;
    const COLS = 20;
    for (let row = 13; row <= 16; row++) for (let col = 1; col <= 18; col++) g.write(map + row * COLS + col, 0x7f);
    lines.forEach((line, i) => {
      [...line].slice(0, 18).forEach((c, col) => g.write(map + (14 + i * 2) * COLS + 1 + col, this.#codes.get(c) ?? 0x7f));
    });
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
    // Standing in, the CPU is still waiting: it hands the message back to the routine next frame.
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
