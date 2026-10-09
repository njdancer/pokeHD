// The HD Pokédex (p2-dex): wherever the game opens its own Pokédex (the start menu's POKéDEX, or
// a Pokémon's data page after a catch, from Oak's starters or the people who show you one), the
// page shows its own over it. The game's Pokédex still runs underneath, so nothing in the game
// changes: the player's buttons are held back while the HD one is up, and when the page closes
// it, B is pressed until the game has left its own the usual way.
import { romOffset, SYMBOLS } from "@pokehd/rom";
import { Button, type GameBoy } from "./core.ts";

/** What the game opened: its Pokédex list, or one Pokémon's data page (internal species index). */
export type DexOpened = { kind: "menu" } | { kind: "data"; species: number };

export interface DexGuardOptions {
  rom: Uint8Array;
  onOpen(opened: DexOpened): void;
  /** The game has left its Pokédex. */
  onClosed(): void;
  /**
   * The player is talking to someone (or a map script has them speak): the map and their index in
   * its objects. For the Pokédex's people (p2-dex).
   */
  onTalk?(map: number, npc: number): void;
}

/** `pop af` straight after the data page's wait for A or B (its `jr z, .waitForButtonPress`). */
const POP_AF = 0xf1;

/** Where the game opens and leaves its Pokédex. */
export function dexHooks(rom: Uint8Array) {
  const wait = SYMBOLS["ShowPokedexDataInternal.waitForButtonPress"];
  // call JoypadLowSensitivity (3), ldh a, [hJoy5] (2), and PAD_A | PAD_B (2), jr z (2).
  const dataLeft = { bank: wait.bank, address: wait.address + 9 };
  if (rom[romOffset(dataLeft)] !== POP_AF) throw new Error("No Pokédex data page wait where expected");
  return { menu: SYMBOLS.ShowPokedexMenu, menuLeft: SYMBOLS["ShowPokedexMenu.exitPokedex"], data: SYMBOLS.ShowPokedexData, dataLeft };
}

export class DexGuard {
  readonly #gb: GameBoy;
  readonly #removeHooks: (() => void)[] = [];
  readonly #next: (mask: number) => void;
  #player = 0;
  #open = false;
  #closing = false;
  #frame = 0;

  /** `next` takes the player's buttons when the Pokédex isn't holding them. */
  constructor(gb: GameBoy, options: DexGuardOptions, next: (mask: number) => void = (m) => gb.setButtons(m)) {
    this.#gb = gb;
    this.#next = next;
    const { menu, menuLeft, data, dataLeft } = dexHooks(options.rom);
    const open = (opened: DexOpened) => {
      this.#open = true;
      this.#closing = false;
      gb.setButtons(0);
      options.onOpen(opened);
    };
    const left = () => {
      if (!this.#open) return;
      this.#open = false;
      this.#closing = false;
      this.#next(this.#player);
      options.onClosed();
    };
    this.#removeHooks.push(
      gb.addHook(menu, () => open({ kind: "menu" })),
      gb.addHook(data, (g) => open({ kind: "data", species: g.read(SYMBOLS.wPokedexNum.address) })),
      gb.addHook(menuLeft, left),
      gb.addHook(dataLeft, left),
    );
    // DisplayTextID with a text ID up to wNumSprites is someone on the map speaking: sprite slot
    // n is the map's nth object.
    const talk = options.onTalk;
    if (talk) {
      this.#removeHooks.push(
        gb.addHook("DisplayTextID", (g) => {
          const id = g.read(SYMBOLS.hSpriteIndex.address);
          if (id >= 1 && id <= g.read(SYMBOLS.wNumSprites.address)) talk(g.read(SYMBOLS.wCurMap.address), id - 1);
        }),
      );
    }
  }

  /** True while the HD Pokédex is up: the player's buttons are held back. */
  get open(): boolean {
    return this.#open;
  }

  setButtons(mask: number): void {
    this.#player = mask;
    if (!this.#open) this.#next(mask);
  }

  /** The page closed its Pokédex: leave the game's. */
  close(): void {
    if (this.#open) this.#closing = true;
  }

  /** The page isn't showing its Pokédex this time: the game's own runs as usual. */
  pass(): void {
    if (!this.#open) return;
    this.#open = false;
    this.#closing = false;
    this.#next(this.#player);
  }

  /** Call once per emulated frame, before it runs: taps B until the game has left. */
  frame(): void {
    if (!this.#open || !this.#closing) return;
    this.#gb.setButtons(this.#frame++ % 4 < 2 ? Button.B : 0);
  }

  dispose(): void {
    for (const remove of this.#removeHooks) remove();
  }
}
