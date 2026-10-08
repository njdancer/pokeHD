// One player's gift desk (D20): gifts from friends wait here for the safe point, and gifts for
// friends are taken out of the game and saved. It also tracks which received gifts are only in
// WRAM so far: a gift counts as delivered once a save holds it.
import type { Gift } from "@pokehd/protocol";
import { romOffset, SYMBOLS, type RomSymbol, type SymbolName } from "@pokehd/rom";
import type { GameBoy } from "../core.ts";
import { invalidGift, receiveJob, takeJob, type GiftSpec, type Landed, type TakeResult } from "./gifts.ts";
import { SafePoint } from "./safepoint.ts";

export type GiftEvent =
  /** In the game, not yet in a save. */
  | { type: "landed"; id: string; where: Landed }
  /** Waiting for room ("bag full", …). Sent when the reason changes, not every frame. */
  | { type: "held"; id: string; reason: string }
  /** Can't ever be accepted (a glitch species, a key item); the room can forget it. */
  | { type: "rejected"; id: string; reason: string }
  /** These landed gifts are in a save now. */
  | { type: "settled"; ids: string[] };

export interface GiftDeskOptions {
  rom: Uint8Array;
  emit(event: GiftEvent): void;
}

/**
 * The game's three save routines, each with where it ends: the write of the save's checksum,
 * which comes after every byte it copies. SaveGameData (the start menu's SAVE, the Cable Club,
 * the Hall of Fame, changing boxes) calls all three; the Cable Club also saves the party alone
 * after a trade. Battery RAM writes alone prove nothing: the game decompresses Pokémon pictures
 * into SRAM too.
 */
const SAVE_ROUTINES: [SymbolName, Landed[]][] = [
  ["SaveMainData", ["money", "bag", "box"]],
  ["SaveCurrentBoxData", ["box"]],
  ["SavePartyAndDexData", ["party"]],
];

/** `ld [sMainDataCheckSum], a` inside each save routine. */
export function saveCommits(rom: Uint8Array): { at: RomSymbol; holds: Landed[] }[] {
  const { address } = SYMBOLS.sMainDataCheckSum;
  return SAVE_ROUTINES.map(([name, holds]) => {
    const start = SYMBOLS[name];
    const base = romOffset(start);
    for (let i = 0; i < 0x80; i++) {
      if (rom[base + i] === 0xea && rom[base + i + 1] === (address & 0xff) && rom[base + i + 2] === address >> 8) {
        return { at: { bank: start.bank, address: start.address + i }, holds };
      }
    }
    throw new Error(`No checksum write in ${name}`);
  });
}

export class GiftDesk {
  readonly #options: GiftDeskOptions;
  readonly #safe: SafePoint;
  /** Received gifts queued, held or landed but not saved: a repeat of one of these is ignored. */
  readonly #known = new Set<string>();
  /** Landed gifts the game hasn't saved yet. */
  readonly #unsaved: { id: string; where: Landed }[] = [];
  /** Landed gifts a save routine has written to battery RAM, not yet handed over. */
  readonly #inSave: string[] = [];
  readonly #removeHooks: (() => void)[];

  constructor(gb: GameBoy, options: GiftDeskOptions) {
    this.#options = options;
    this.#safe = SafePoint.of(gb);
    this.#removeHooks = saveCommits(options.rom).map(({ at, holds }) =>
      gb.addHook(at, () => {
        const saved = this.#unsaved.filter((gift) => holds.includes(gift.where));
        if (saved.length === 0) return;
        this.#unsaved.splice(0, Infinity, ...this.#unsaved.filter((gift) => !saved.includes(gift)));
        this.#inSave.push(...saved.map((gift) => gift.id));
      }),
    );
  }

  /** Queues a friend's gift. Repeats of a gift already here (a room resend) are ignored. */
  give(id: string, gift: Gift): void {
    if (this.#known.has(id)) return;
    const invalid = invalidGift(this.#options.rom, gift);
    if (invalid) return this.#options.emit({ type: "rejected", id, reason: invalid });
    this.#known.add(id);
    let lastHold = "";
    const job = receiveJob(gift, {
      landed: (where) => {
        this.#unsaved.push({ id, where });
        this.#options.emit({ type: "landed", id, where });
      },
      held: (reason) => {
        if (reason === lastHold) return;
        lastHold = reason;
        this.#options.emit({ type: "held", id, reason });
      },
    });
    job.done = (completed) => {
      if (completed) return;
      // The game turned it down at the last moment: try again on a later pass.
      this.#known.delete(id);
      this.give(id, gift);
    };
    this.#safe.enqueue(job);
  }

  /**
   * Takes a gift out of the game at the next idle point and saves. On success the caller must
   * store the save RAM before the gift leaves (and then call `saved()`).
   */
  take(spec: GiftSpec, done: (result: TakeResult) => void): void {
    this.#safe.enqueue(takeJob(this.#options.rom, spec, done));
  }

  /** Call after handing over battery RAM: gifts the game had saved into it are now delivered. */
  saved(): void {
    if (this.#inSave.length === 0) return;
    const ids = this.#inSave.splice(0);
    for (const id of ids) this.#known.delete(id);
    this.#options.emit({ type: "settled", ids });
  }

  /** Received gifts in the game that aren't yet handed over in a save. */
  get unsettled(): number {
    return this.#unsaved.length + this.#inSave.length;
  }

  get pending(): number {
    return this.#safe.pending;
  }

  dispose(): void {
    for (const remove of this.#removeHooks.splice(0)) remove();
    this.#safe.dispose();
  }
}
