// Gifts between friends over the room (D20). Framework-free: the gift panel calls `send` and
// reads `state`; the emulator's gift events come in through `onGiftEvent`.
//
// Sending: the emulator takes the gift out of the game and saves; the save and the gift go
// into IndexedDB together (the outbox); then the gift goes to the room, and leaves the outbox
// when the room says it has stored it. The outbox is resent on every connect until then.
//
// Receiving: the room hands over every gift it holds for us on each connect. A gift goes to
// the emulator unless the ledger says a stored save already holds it. Once the game saves with
// it, its ID goes in the ledger and the room is told to forget it.
import type { GiftEvent, GiftSpec, Landed, TakenGift, TakeResult } from "@pokehd/emu";
import type { ClientMessage, Gift, PlayerInfo, ServerMessage } from "@pokehd/protocol";
import type { GiftStorage } from "../saves/gift-store.ts";

export interface GiftRoom {
  /** False (or nothing) if it couldn't be sent now; the courier resends on the next welcome. */
  send(message: ClientMessage): boolean | void;
  subscribe(listener: (message: ServerMessage) => void): () => void;
}

export interface GiftHost {
  giveGift(id: string, gift: Gift): void;
  takeGift(spec: GiftSpec): Promise<TakenGift>;
}

export type GiftNotice =
  | { kind: "received"; id: string; from: PlayerInfo; gift: Gift; where: Landed }
  | { kind: "waiting"; id: string; from: PlayerInfo; gift: Gift; reason: string }
  | { kind: "refused"; id: string; from: PlayerInfo; gift: Gift; reason: string }
  | { kind: "sent"; id: string; toName: string; gift: Gift };

export interface GiftCourierState {
  /** Newest last; the panel shows and dismisses them. */
  notices: readonly GiftNotice[];
}

export interface GiftCourierOptions {
  room: GiftRoom;
  host: GiftHost;
  storage: GiftStorage;
  newId?: () => string;
}

const MAX_NOTICES = 8;

export class GiftCourier {
  readonly #options: GiftCourierOptions;
  readonly #unsubscribe: () => void;
  readonly #listeners = new Set<() => void>();
  /** Received gifts seen this session, for naming them in notices. */
  readonly #incoming = new Map<string, { from: PlayerInfo; gift: Gift }>();
  /** Room messages wait for the ledger to load, then run in order. */
  #ready: Promise<Set<string>>;
  #state: GiftCourierState = { notices: [] };

  constructor(options: GiftCourierOptions) {
    this.#options = options;
    this.#ready = options.storage.settled();
    this.#unsubscribe = options.room.subscribe((message) => {
      this.#ready = this.#ready.then(async (settled) => {
        await this.#onRoom(message, settled);
        return settled;
      });
    });
  }

  get state(): GiftCourierState {
    return this.#state;
  }

  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /** Takes the gift out of the game (which saves), stores it, then sends it to `to`. */
  async send(to: PlayerInfo, spec: GiftSpec): Promise<TakeResult> {
    const { result, sram } = await this.#options.host.takeGift(spec);
    if (!result.ok || !sram) return result;
    const entry = { id: this.#options.newId?.() ?? crypto.randomUUID(), to: to.id, toName: to.name, gift: result.gift };
    await this.#options.storage.storeTaken(sram, entry);
    this.#options.room.send({ type: "gift", to: entry.to, id: entry.id, gift: entry.gift });
    return result;
  }

  /** The emulator's gift events (`EmulatorHost`'s `onGift`). */
  onGiftEvent(event: GiftEvent): void {
    this.#ready = this.#ready.then(async (settled) => {
      await this.#onGame(event, settled);
      return settled;
    });
  }

  dismiss(id: string): void {
    this.#update(this.#state.notices.filter((n) => n.id !== id));
  }

  dispose(): void {
    this.#unsubscribe();
    this.#listeners.clear();
  }

  async #onRoom(message: ServerMessage, settled: Set<string>): Promise<void> {
    const { room, host, storage } = this.#options;
    switch (message.type) {
      case "welcome":
        for (const entry of await storage.outbox()) room.send({ type: "gift", to: entry.to, id: entry.id, gift: entry.gift });
        return;
      case "gift-stored": {
        const entry = (await storage.outbox()).find((e) => e.id === message.id);
        await storage.removeOutbox(message.id);
        if (entry) this.#notice({ kind: "sent", id: entry.id, toName: entry.toName, gift: entry.gift });
        return;
      }
      case "gift":
        this.#incoming.set(message.id, { from: message.from, gift: message.gift });
        // Already in a stored save: the last acknowledgement was lost.
        if (settled.has(message.id)) room.send({ type: "gift-ack", id: message.id });
        else host.giveGift(message.id, message.gift);
        return;
    }
  }

  async #onGame(event: GiftEvent, settled: Set<string>): Promise<void> {
    const { room, storage } = this.#options;
    if (event.type === "settled") {
      await storage.addSettled(event.ids);
      for (const id of event.ids) {
        settled.add(id);
        room.send({ type: "gift-ack", id });
      }
      return;
    }
    const known = this.#incoming.get(event.id);
    if (!known) return;
    switch (event.type) {
      case "landed":
        return this.#notice({ kind: "received", id: event.id, ...known, where: event.where });
      case "held":
        return this.#notice({ kind: "waiting", id: event.id, ...known, reason: event.reason });
      case "rejected":
        // It can never land; the room can let it go.
        room.send({ type: "gift-ack", id: event.id });
        return this.#notice({ kind: "refused", id: event.id, ...known, reason: event.reason });
    }
  }

  /** Adds a notice, replacing any older one about the same gift. */
  #notice(notice: GiftNotice): void {
    this.#update([...this.#state.notices.filter((n) => n.id !== notice.id), notice].slice(-MAX_NOTICES));
  }

  #update(notices: readonly GiftNotice[]): void {
    this.#state = { notices };
    for (const listener of this.#listeners) listener();
  }
}
