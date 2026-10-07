// One player's gift desk (D20): gifts from friends wait here for the safe point, and gifts for
// friends are taken out of the game and saved. It also tracks which received gifts are only in
// WRAM so far: a gift counts as delivered once a save holds it.
import type { Gift } from "@pokehd/protocol";
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
  /**
   * Hands the save RAM to whoever keeps it (and then calls `saved()`). Called before a gift
   * lands if a save is still unflushed, so that save isn't mistaken for one holding the gift.
   */
  flushSram(): void;
}

export class GiftDesk {
  readonly #options: GiftDeskOptions;
  readonly #safe: SafePoint;
  /** Received gifts queued, held or landed but not saved: a repeat of one of these is ignored. */
  readonly #known = new Set<string>();
  readonly #unsaved: string[] = [];

  constructor(gb: GameBoy, options: GiftDeskOptions) {
    this.#options = options;
    this.#safe = SafePoint.of(gb);
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
        this.#unsaved.push(id);
        this.#options.emit({ type: "landed", id, where });
      },
      held: (reason) => {
        if (reason === lastHold) return;
        lastHold = reason;
        this.#options.emit({ type: "held", id, reason });
      },
    });
    const check = job.check;
    job.check = (gb) => {
      const verdict = check?.(gb);
      if (!verdict && gb.sramDirty) this.#options.flushSram();
      return verdict;
    };
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
   * store the save RAM before the gift leaves (and then call `saved()`: the save also holds any
   * gift that landed before it).
   */
  take(spec: GiftSpec, done: (result: TakeResult) => void): void {
    this.#safe.enqueue(takeJob(this.#options.rom, spec, done));
  }

  /** Call after handing over save RAM: every gift that landed before it is now saved. */
  saved(): void {
    if (this.#unsaved.length === 0) return;
    const ids = this.#unsaved.splice(0);
    for (const id of ids) this.#known.delete(id);
    this.#options.emit({ type: "settled", ids });
  }

  get pending(): number {
    return this.#safe.pending;
  }

  dispose(): void {
    this.#safe.dispose();
  }
}
