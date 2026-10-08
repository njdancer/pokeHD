// What the gift courier (room/gifts.ts) keeps next to the battery save, in the same IndexedDB
// store and write queue (D20):
// - the outbox: gifts taken out of this game and saved, not yet stored by the room. Written in
//   the same transaction as the save that no longer has them, so a gift is never in neither.
// - the ledger: IDs of received gifts that a stored save holds, so a resend never lands twice.
import type { Gift } from "@pokehd/protocol";
import { run } from "../idb.ts";
import type { SaveSlot } from "./save-store.ts";

export interface OutboxEntry {
  id: string;
  to: string;
  toName: string;
  gift: Gift;
}

export interface GiftStorage {
  /** Stores the sender's save and the gift that left it, together. */
  storeTaken(sram: Uint8Array, entry: OutboxEntry): Promise<void>;
  outbox(): Promise<OutboxEntry[]>;
  removeOutbox(id: string): Promise<void>;
  settled(): Promise<Set<string>>;
  addSettled(ids: readonly string[]): Promise<void>;
}

const range = (prefix: string) => IDBKeyRange.bound(prefix, `${prefix}￿`);

export function giftStorage(slot: Pick<SaveSlot, "key" | "enqueue" | "backup">): GiftStorage {
  const out = `${slot.key}#gift-out:`;
  const ledger = `${slot.key}#gift-in:`;
  return {
    storeTaken: (sram, entry) =>
      slot.enqueue(() =>
        run("saves", "readwrite", (s) => {
          s.put(sram.slice().buffer, slot.key);
          return s.put(entry, out + entry.id);
        }).then(() => slot.backup?.onSram(sram)),
      ),
    outbox: () => run<OutboxEntry[]>("saves", "readonly", (s) => s.getAll(range(out)) as IDBRequest<OutboxEntry[]>),
    removeOutbox: (id) => slot.enqueue(() => run("saves", "readwrite", (s) => s.delete(out + id))),
    settled: async () => {
      const keys = await run("saves", "readonly", (s) => s.getAllKeys(range(ledger)));
      return new Set(keys.map((k) => String(k).slice(ledger.length)));
    },
    addSettled: (ids) =>
      slot.enqueue(() =>
        run("saves", "readwrite", (s) => {
          for (const id of ids) s.put(true, ledger + id);
          return s.count(); // resolves when the transaction commits
        }).then(() => undefined),
      ),
  };
}
