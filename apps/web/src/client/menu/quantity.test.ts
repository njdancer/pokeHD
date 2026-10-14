// The Poké Mart quantity picker's limits and sums (QA #70), against the game's rules:
// DisplayPokemartDialogue_, DisplayChooseQuantityMenu, AddItemToInventory_ and AddBCD.
import { describe, expect, it } from "vitest";
import { bagTakes, buyMax, buyTotal, limitOf, moneyAfter, sellMax, sellTotal, type Stack } from "./quantity.ts";

const POKE_BALL = 0x04;
const POTION = 0x14;
const ANTIDOTE = 0x0b;
const full = (except: number[] = []): Stack[] => Array.from({ length: 20 }, (_, i) => ({ item: 0x30 + i, quantity: 1 })).filter((s) => !except.includes(s.item));

describe("bagTakes (AddItemToInventory_)", () => {
  it("takes a new item while fewer than 20 stacks are used", () => {
    expect(bagTakes([], POKE_BALL, 99)).toBe(true);
    expect(bagTakes(full().slice(0, 19), POKE_BALL, 1)).toBe(true);
    expect(bagTakes(full(), POKE_BALL, 1)).toBe(false);
  });

  it("tops up a stack below 100 even with the bag full", () => {
    const bag = [...full().slice(0, 19), { item: POTION, quantity: 90 }];
    expect(bagTakes(bag, POTION, 9)).toBe(true);
    // 100 or more: 99 in this stack, the rest needs a new one, and there's no room.
    expect(bagTakes(bag, POTION, 10)).toBe(false);
  });

  it("splits past 99 into a new stack when there's room", () => {
    expect(bagTakes([{ item: POTION, quantity: 90 }], POTION, 99)).toBe(true);
  });
});

describe("buyMax", () => {
  it("is 99 at most, as wMaxItemQuantity", () => {
    expect(buyMax(999_999, 200, [], POKE_BALL)).toBe(99);
  });

  it("stops at what the money pays for (the game would say it isn't enough)", () => {
    expect(buyMax(2793, 200, [], POKE_BALL)).toBe(13);
    expect(buyMax(199, 200, [], POKE_BALL)).toBe(0);
    expect(buyMax(200, 200, [], POKE_BALL)).toBe(1);
  });

  it("stops at what the bag takes (the game would say there's no more room)", () => {
    const bag = [...full().slice(0, 19), { item: POTION, quantity: 95 }];
    expect(buyMax(999_999, 300, bag, POTION)).toBe(4);
    expect(buyMax(999_999, 300, full(), ANTIDOTE)).toBe(0);
  });
});

describe("selling", () => {
  it("offers up to the stack's count, nothing for what has no price", () => {
    expect(sellMax(12, 300)).toBe(12);
    expect(sellMax(99, 300)).toBe(99);
    expect(sellMax(5, 0)).toBe(0);
  });

  it("pays half of the whole, rounded down, with money stopping at ₽999999", () => {
    expect(sellTotal(300, 7)).toBe(1050);
    expect(sellTotal(25, 3)).toBe(37);
    expect(moneyAfter(999_000, 5000, true)).toBe(999_999);
    expect(moneyAfter(1000, 150, true)).toBe(1150);
  });
});

describe("sums and words", () => {
  it("costs price × count and takes it off the money", () => {
    expect(buyTotal(200, 10)).toBe(2000);
    expect(moneyAfter(2793, 2000, false)).toBe(793);
  });

  it("says why it stops where it does", () => {
    expect(limitOf("buy", 13, 2793, 200, 0)).toBe("You can afford 13");
    expect(limitOf("buy", 99, 999_999, 200, 0)).toBe("Up to 99 at a time");
    expect(limitOf("buy", 0, 100, 200, 0)).toBe("Not enough money");
    expect(limitOf("buy", 0, 999_999, 200, 0)).toBe("No room in your bag");
    expect(limitOf("buy", 4, 999_999, 300, 95)).toBe("Room for 4 more in your bag");
    expect(limitOf("sell", 12, 0, 300, 12)).toBe("You have 12");
  });
});
