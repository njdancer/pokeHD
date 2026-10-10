import { describe, expect, it } from "vitest";
import { lastPlayedSlot, mergeSlotIndex, parseSlotIndex, SLOT_KEY, slotKey, type SlotMeta } from "./saves.ts";

const ROM = "d7037c83e1ae5b39bde3c30787637ba1d4c48ce2";
const slot = (id: string, over: Partial<SlotMeta> = {}): SlotMeta => ({ id, createdAt: 1, updatedAt: 1, playedAt: 1, ...over });

describe("save slots", () => {
  it("keeps the main slot on the ROM's own key", () => {
    expect(slotKey(ROM, "main")).toBe(ROM);
    expect(slotKey(ROM, "ab12cd34")).toBe(`${ROM}-ab12cd34`);
    expect(SLOT_KEY.test(ROM) && SLOT_KEY.test(`${ROM}-ab12cd34`)).toBe(true);
    expect(SLOT_KEY.test(`${ROM}-main`) || SLOT_KEY.test(`${ROM}/x`)).toBe(false);
  });

  it("never drops a slot either side has", () => {
    const a = { slots: [slot("main"), slot("aaaaaaaa", { createdAt: 5 })] };
    const b = { slots: [slot("main"), slot("bbbbbbbb", { createdAt: 3 })] };
    expect(mergeSlotIndex(a, b).slots.map((s) => s.id)).toEqual(["main", "bbbbbbbb", "aaaaaaaa"]);
  });

  it("takes the newer edit and the latest play, in either order", () => {
    const a = slot("main", { name: "Old", updatedAt: 10, playedAt: 50 });
    const b = slot("main", { deletedAt: 20, updatedAt: 20, playedAt: 30 });
    const ab = mergeSlotIndex({ slots: [a] }, { slots: [b] });
    expect(ab).toEqual(mergeSlotIndex({ slots: [b] }, { slots: [a] }));
    expect(ab.slots[0]).toEqual({ id: "main", createdAt: 1, updatedAt: 20, playedAt: 50, deletedAt: 20 });
    // Same-time edits settle the same way on both sides.
    const x = slot("main", { name: "X", updatedAt: 9 });
    const y = slot("main", { name: "Y", updatedAt: 9 });
    expect(mergeSlotIndex({ slots: [x] }, { slots: [y] })).toEqual(mergeSlotIndex({ slots: [y] }, { slots: [x] }));
  });

  it("resumes the slot played last, not one in the bin", () => {
    const index = { slots: [slot("main", { playedAt: 5 }), slot("aaaaaaaa", { playedAt: 9, deletedAt: 10 }), slot("bbbbbbbb", { playedAt: 7 })] };
    expect(lastPlayedSlot(index)?.id).toBe("bbbbbbbb");
    expect(lastPlayedSlot({ slots: [] })).toBeNull();
  });

  it("checks lists from outside", () => {
    expect(parseSlotIndex({ slots: [slot("main")] })).not.toBeNull();
    expect(parseSlotIndex({ slots: [slot("../x")] })).toBeNull();
    expect(parseSlotIndex({ slots: [{ ...slot("main"), extra: 1 }] })).toBeNull();
    expect(parseSlotIndex("nope")).toBeNull();
  });
});
