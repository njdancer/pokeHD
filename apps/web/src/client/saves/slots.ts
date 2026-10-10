// Save slots on this device: any number of adventures per ROM (packages/protocol saves.ts).
// Each slot's battery save, resume point, earlier saves, Pokédex journal and gift ledger sit
// under its own key, exactly as the one save did before, so everything else in the page works
// on a slot by being handed its key. The main slot's key is the ROM's SHA-1, the key the one
// save always had: nothing moves when a player first gets slots.
//
// The list itself is kept in IndexedDB next to the saves and, for signed-in players, in the
// cloud, where a write merges rather than replaces. Deleting only moves a slot to the bin; its
// data stays, so a slot can always be brought back.
import { lastPlayedSlot, MAIN_SLOT, MAX_SLOTS, mergeSlotIndex, parseSlotIndex, slotKey, type SlotIndex, type SlotMeta } from "@pokehd/protocol";
import { run } from "../idb.ts";
import { fetchCloudSave, uploadCloudSave, writeSynced } from "./cloud-save.ts";
import { pickResumePoint, readResumePoint, uploadResumePoint } from "./resume-store.ts";
import { loadSave } from "./save-store.ts";

export { lastPlayedSlot, MAIN_SLOT, slotKey, type SlotIndex, type SlotMeta };

type Fetch = typeof fetch;
const indexKey = (romSha1: string) => `${romSha1}:slots`;

async function readLocal(romSha1: string): Promise<SlotIndex> {
  const stored = await run<unknown>("saves", "readonly", (s) => s.get(indexKey(romSha1)));
  return (stored ? parseSlotIndex(stored) : null) ?? { slots: [] };
}
const writeLocal = (romSha1: string, index: SlotIndex) => run("saves", "readwrite", (s) => s.put(index, indexKey(romSha1)));

/** Changes to a ROM's list take turns, so two at once can't drop one. */
const queues = new Map<string, Promise<unknown>>();
function update(romSha1: string, change: (index: SlotIndex) => SlotIndex | Promise<SlotIndex>): Promise<SlotIndex> {
  const next = (queues.get(romSha1) ?? Promise.resolve()).then(async () => {
    const index = await change(await readLocal(romSha1));
    await writeLocal(romSha1, index);
    return index;
  });
  queues.set(romSha1, next.catch(() => {}));
  return next;
}

/**
 * Sends this device's list to the cloud, which merges it with its own and sends the result
 * back; that is merged in here too. Signed out or offline, the device's list stands.
 */
async function sync(romSha1: string, f: Fetch): Promise<SlotIndex> {
  const local = await readLocal(romSha1);
  let cloud: SlotIndex | null = null;
  try {
    const res = await f(`/api/saves/${romSha1}/slots`, {
      method: "PUT",
      body: JSON.stringify(local),
      headers: { "content-type": "application/json" },
    });
    if (res.ok) cloud = parseSlotIndex(await res.json());
  } catch {
    // Offline.
  }
  return cloud ? update(romSha1, (now) => mergeSlotIndex(now, cloud)) : local;
}

/** Whether the main slot's key holds anything: a save or a resume point here, or a save in the cloud. */
async function mainHasData(romSha1: string, f: Fetch): Promise<{ playedAt: number } | null> {
  const point = await readResumePoint(romSha1).catch(() => null);
  if (point) return { playedAt: point.takenAt };
  if (await loadSave(romSha1).catch(() => null)) return { playedAt: 0 };
  const cloud = await fetchCloudSave(romSha1, f).catch(() => null);
  return cloud && cloud !== "signed-out" ? { playedAt: 0 } : null;
}

/**
 * The player's slots for a ROM, merged with the cloud's. The first time, the save they already
 * had (on this device or in the cloud) is listed as the main slot.
 */
export async function loadSlots(romSha1: string, f: Fetch = fetch): Promise<SlotIndex> {
  const index = await sync(romSha1, f);
  if (index.slots.some((s) => s.id === MAIN_SLOT)) return index;
  const main = await mainHasData(romSha1, f);
  if (!main) return index;
  await update(romSha1, (now) => mergeSlotIndex(now, { slots: [newMeta(MAIN_SLOT, 0, main.playedAt)] }));
  return sync(romSha1, f);
}

function newMeta(id: string, createdAt: number, playedAt = 0, name?: string): SlotMeta {
  return { id, createdAt, updatedAt: createdAt, playedAt, ...(name ? { name } : {}) };
}

/** A new slot's ID. A page can pick one before the slot exists, to start its game early. */
export function newSlotId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return Array.from(bytes, (b) => "0123456789abcdefghijklmnopqrstuvwxyz"[b % 36]).join("");
}

/** Changes one slot, then tells the cloud. */
async function edit(romSha1: string, id: string, change: (slot: SlotMeta, now: number) => SlotMeta, f: Fetch): Promise<SlotIndex> {
  await update(romSha1, (index) => {
    const now = Date.now();
    // The main slot may not be listed yet (a game from before slots): it's added as it's touched.
    const slot = index.slots.find((s) => s.id === id) ?? (id === MAIN_SLOT ? newMeta(MAIN_SLOT, 0) : null);
    if (!slot) throw new Error(`No save slot ${id}`);
    return mergeSlotIndex({ slots: index.slots.filter((s) => s.id !== id) }, { slots: [change(slot, now)] });
  });
  return sync(romSha1, f);
}

/** Notes a slot as being played now, so Resume picks it. */
export const markPlayed = (romSha1: string, id: string, f: Fetch = fetch) =>
  edit(romSha1, id, (s, now) => ({ ...s, playedAt: Math.max(now, s.playedAt + 1) }), f);

export const renameSlot = (romSha1: string, id: string, name: string, f: Fetch = fetch) =>
  edit(
    romSha1,
    id,
    (s, now) => {
      const { name: _, ...rest } = s;
      const trimmed = name.trim().slice(0, 40);
      return { ...rest, updatedAt: Math.max(now, s.updatedAt + 1), ...(trimmed ? { name: trimmed } : {}) };
    },
    f,
  );

/** Moves a slot to the bin. Its data stays where it is. */
export const binSlot = (romSha1: string, id: string, f: Fetch = fetch) =>
  edit(romSha1, id, (s, now) => ({ ...s, deletedAt: now, updatedAt: Math.max(now, s.updatedAt + 1) }), f);

/** Brings a slot back from the bin. */
export const unbinSlot = (romSha1: string, id: string, f: Fetch = fetch) =>
  edit(
    romSha1,
    id,
    (s, now) => {
      const { deletedAt: _, ...rest } = s;
      return { ...rest, updatedAt: Math.max(now, s.updatedAt + 1) };
    },
    f,
  );

/** A new, empty slot: the game starts at its title screen with no save. */
export async function createSlot(romSha1: string, name?: string, f: Fetch = fetch, id = newSlotId()): Promise<SlotMeta> {
  // The save a player already had is listed first, so it never sits outside the list.
  await loadSlots(romSha1, f);
  const slot = newMeta(id, Date.now(), 0, name?.trim().slice(0, 40));
  await update(romSha1, (index) => {
    if (index.slots.length >= MAX_SLOTS) throw new Error(`At most ${MAX_SLOTS} save slots`);
    return mergeSlotIndex(index, { slots: [slot] });
  });
  await sync(romSha1, f);
  return slot;
}

/** Keys under a slot's own that a copy takes: the Pokédex journal and the gift ledger, not gifts still on their way out. */
const copies = (key: string) => (k: string) => k.startsWith(`${key}#`) && !k.startsWith(`${key}#gift-out:`);

/**
 * A new slot holding a copy of another: its battery save, resume point, Pokédex journal and
 * the record of gifts it holds. Earlier saves stay with the original. A save that's only in the
 * cloud (another device's) is copied from there.
 */
export async function duplicateSlot(romSha1: string, fromId: string, name?: string, f: Fetch = fetch): Promise<SlotMeta> {
  const from = slotKey(romSha1, fromId);
  const sram = (await loadSave(from)) ?? (await fetchCloudSave(from, f).then((c) => (c && c !== "signed-out" ? c.sram : null), () => null));
  // The resume point is copied as stored, checksum and all.
  const range = IDBKeyRange.bound(`${from}#`, `${from}#\uffff`);
  const [keys, values, storedPoint] = await Promise.all([
    run("saves", "readonly", (s) => s.getAllKeys(range)),
    run<unknown[]>("saves", "readonly", (s) => s.getAll(range)),
    run<unknown>("saves", "readonly", (s) => s.get(`${from}:resume`)),
  ]);

  const slot = await createSlot(romSha1, name, f);
  const to = slotKey(romSha1, slot.id);
  await run("saves", "readwrite", (s) => {
    keys.forEach((k, i) => copies(from)(String(k)) && s.put(values[i], `${to}${String(k).slice(from.length)}`));
    if (storedPoint) s.put(storedPoint, `${to}:resume`);
    if (sram) s.put(sram.slice().buffer, to);
    return s.count(); // resolves when the transaction commits
  });
  // And the copy is backed up like any save, its point too if it holds that save. Signed out,
  // this does nothing.
  if (sram) {
    try {
      const savedAt = await uploadCloudSave(to, sram, f);
      if (savedAt !== "signed-out") {
        await writeSynced(to, savedAt);
        const point = await pickResumePoint(sram, [await readResumePoint(to)]);
        if (point) await uploadResumePoint(to, point.state, sram, false, f);
      }
    } catch {
      // Offline: the copy's first save in play backs it up.
    }
  }
  return slot;
}

/** The slot Resume plays: the one played last, or null when there's none. */
export async function resumeSlot(romSha1: string, f: Fetch = fetch): Promise<SlotMeta | null> {
  return lastPlayedSlot(await loadSlots(romSha1, f));
}
