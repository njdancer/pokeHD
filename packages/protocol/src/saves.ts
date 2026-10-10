// Save slots: a player keeps any number of adventures per ROM, each with its own battery save,
// resume point and earlier saves. The list of slots (the index) lives on the device and, for
// signed-in players, in the cloud; either side merges the other's in, so two devices that each
// changed it never lose a slot.
import * as v from "valibot";

/** The slot every player already had before slots: its data keeps the old keys (the bare ROM SHA-1). */
export const MAIN_SLOT = "main";
/** A new slot's ID: 8 lower-case letters and digits. */
const SLOT_ID = /^[0-9a-z]{8}$/;
/** The most slots a player can make per ROM, the bin included. Merging never drops one. */
export const MAX_SLOTS = 100;

const time = v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(1e13));

export const SlotMetaSchema = v.strictObject({
  id: v.union([v.literal(MAIN_SLOT), v.pipe(v.string(), v.regex(SLOT_ID))]),
  /** A name the player gave it; otherwise it's shown by its trainer. */
  name: v.optional(v.pipe(v.string(), v.maxLength(40))),
  createdAt: time,
  /** When the name or the bin last changed: the newer side's wins on a merge. */
  updatedAt: time,
  /** When it was last played: the later of the two wins on a merge. */
  playedAt: time,
  /** In the bin since then. Nothing is erased, so the slot can always come back. */
  deletedAt: v.optional(time),
});
export type SlotMeta = v.InferOutput<typeof SlotMetaSchema>;

export const SlotIndexSchema = v.strictObject({
  slots: v.pipe(v.array(SlotMetaSchema), v.maxLength(MAX_SLOTS * 4)),
});
export type SlotIndex = v.InferOutput<typeof SlotIndexSchema>;

/**
 * Where a slot's data is kept, locally and in the cloud: the main slot keeps the ROM's SHA-1,
 * so the save everyone already had is the main slot without moving a byte.
 */
export const slotKey = (romSha1: string, id: string) => (id === MAIN_SLOT ? romSha1 : `${romSha1}-${id}`);
/** A slot list from JSON, or null if it isn't one. */
export function parseSlotIndex(json: unknown): SlotIndex | null {
  const parsed = v.safeParse(SlotIndexSchema, json);
  return parsed.success ? parsed.output : null;
}

/** A slot's key: a ROM's SHA-1, and a slot ID after a dash for every slot but the main one. */
export const SLOT_KEY = /^[0-9a-f]{40}(-[0-9a-z]{8})?$/;

/** One slot's two copies made one: the newer edit's name and bin state, the latest play. */
function mergeSlot(a: SlotMeta, b: SlotMeta): SlotMeta {
  // Same-time edits fall back to a fixed order, so both sides settle on the same copy.
  const tie = (s: SlotMeta) => `${s.deletedAt ?? ""}|${s.name ?? ""}`;
  const newer = b.updatedAt > a.updatedAt || (b.updatedAt === a.updatedAt && tie(b) > tie(a)) ? b : a;
  return { ...newer, createdAt: Math.min(a.createdAt, b.createdAt), playedAt: Math.max(a.playedAt, b.playedAt) };
}

/** Both indexes' slots, oldest first. Merging is order-free and repeatable, so either side can do it. */
export function mergeSlotIndex(a: SlotIndex, b: SlotIndex): SlotIndex {
  const byId = new Map<string, SlotMeta>();
  for (const s of [...a.slots, ...b.slots]) {
    const there = byId.get(s.id);
    byId.set(s.id, there ? mergeSlot(there, s) : s);
  }
  return { slots: [...byId.values()].sort((x, y) => x.createdAt - y.createdAt || (x.id < y.id ? -1 : 1)) };
}

/** The slot played most recently, not counting the bin. */
export function lastPlayedSlot(index: SlotIndex): SlotMeta | null {
  const live = index.slots.filter((s) => s.deletedAt === undefined);
  return live.sort((a, b) => b.playedAt - a.playedAt)[0] ?? null;
}
