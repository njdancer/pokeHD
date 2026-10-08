// Kid-proofing the save menu: when the game asks "The older file will be erased to save.
// Okay?" (saving a NEW GAME over an existing save), the page shows its own big question
// instead. Until it's answered the player's buttons don't reach the game, so a mashed A can't
// say YES. The page's answer is then given the game's own way: A on YES, or B for NO, pressed
// until the game reads it. Nothing in the game changes; only who presses the button.
import { romOffset, SYMBOLS, type RomSymbol } from "@pokehd/rom";
import { Button, type GameBoy } from "./core.ts";

export interface EraseGuardOptions {
  rom: Uint8Array;
  /** The prompt is on its way: show the question. */
  onPrompt(): void;
  /** The game has its answer: `erase` true means it's about to overwrite the old save. */
  onAnswered(erase: boolean): void;
}

/**
 * Where the prompt starts (`ld hl, OlderFileWillBeErasedText` in SaveMenu) and where its answer
 * is read (the instruction after the `call SaveTheGame_YesOrNo` that follows, with the choice
 * in A: 0 for YES).
 */
export function erasePromptHooks(rom: Uint8Array): { prompt: RomSymbol; answered: RomSymbol } {
  const menu = SYMBOLS.SaveMenu;
  const base = romOffset(menu);
  const text = SYMBOLS.OlderFileWillBeErasedText.address;
  const ask = SYMBOLS.SaveTheGame_YesOrNo.address;
  const at = (i: number, op: number, word: number) =>
    rom[base + i] === op && rom[base + i + 1] === (word & 0xff) && rom[base + i + 2] === word >> 8;
  for (let i = 0; i < 0x40; i++) {
    if (!at(i, 0x21, text)) continue;
    for (let j = i + 3; j < i + 0x10; j++) {
      if (at(j, 0xcd, ask)) {
        return { prompt: { bank: menu.bank, address: menu.address + i }, answered: { bank: menu.bank, address: menu.address + j + 3 } };
      }
    }
  }
  throw new Error("No erase prompt in SaveMenu");
}

export class EraseGuard {
  readonly #gb: GameBoy;
  readonly #options: EraseGuardOptions;
  readonly #removeHooks: (() => void)[];
  /** The player's own buttons, held back while the question is up. */
  #player = 0;
  #asking = false;
  #answer: boolean | undefined;
  #frame = 0;

  constructor(gb: GameBoy, options: EraseGuardOptions) {
    this.#gb = gb;
    this.#options = options;
    const { prompt, answered } = erasePromptHooks(options.rom);
    this.#removeHooks = [
      gb.addHook(prompt, () => {
        this.#asking = true;
        this.#answer = undefined;
        gb.setButtons(0);
        options.onPrompt();
      }),
      gb.addHook(answered, (g) => {
        if (!this.#asking) return;
        this.#asking = false;
        this.#answer = undefined;
        g.setButtons(this.#player);
        options.onAnswered(g.registers.af >> 8 === 0);
      }),
    ];
  }

  /** True while the question is up: the player's buttons are held back. */
  get asking(): boolean {
    return this.#asking;
  }

  /** The player's buttons. While asking they're remembered, and applied once it's answered. */
  setButtons(mask: number): void {
    this.#player = mask;
    if (!this.#asking) this.#gb.setButtons(mask);
  }

  /** The page's answer: true to erase the old save (YES), false to keep it (NO). */
  answer(erase: boolean): void {
    if (this.#asking) this.#answer = erase;
  }

  /** Call once per emulated frame, before it runs: presses the answer until the game reads it. */
  frame(): void {
    if (!this.#asking || this.#answer === undefined) return;
    // The prompt's text and menu read new presses, so tap: two frames down, two up. The cursor
    // starts on YES and nothing moves it while the player's buttons are held back.
    const down = this.#frame++ % 4 < 2;
    this.#gb.setButtons(down ? (this.#answer ? Button.A : Button.B) : 0);
  }

  dispose(): void {
    for (const remove of this.#removeHooks) remove();
  }
}
