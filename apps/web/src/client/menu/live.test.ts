// Which read of the game the menu shows while the game asks (QA bug 24: a Poké Mart's money).
import type { GameAsk, GameSnapshot } from "@pokehd/emu";
import { describe, expect, it } from "vitest";
import { currentGame, momentOf, requestOf } from "./live.ts";

const game = (money: number) => ({ money }) as GameSnapshot;

describe("currentGame", () => {
  it("shows the menu's own read with no question up", () => {
    expect(currentGame(null, { game: game(3093), during: null })?.money).toBe(3093);
    expect(currentGame(null, null)).toBeNull();
  });

  it("prefers the question's game to a read from before it", () => {
    expect(currentGame({ id: 7, game: game(3093) }, { game: game(3500), during: null })?.money).toBe(3093);
    expect(currentGame({ id: 7, game: game(3093) }, { game: game(3500), during: 6 })?.money).toBe(3093);
  });

  it("follows the game while the question stays up (the money a purchase took)", () => {
    expect(currentGame({ id: 7, game: game(3093) }, { game: game(2793), during: 7 })?.money).toBe(2793);
  });

  it("falls back to the last read until the question's game has been read", () => {
    expect(currentGame({ id: 7, game: null }, { game: game(3093), during: null })?.money).toBe(3093);
    expect(currentGame({ id: 7, game: null }, null)).toBeNull();
  });
});

// QA bug 34: the battle's bag never reads as the Poké Mart's sell list.
describe("momentOf and requestOf for a bag ask", () => {
  const rom = new Uint8Array(0);
  const bag = (inBattle: boolean, selling: boolean): GameAsk => ({ kind: "items", list: "bag", entries: [{ item: 0x14, quantity: 1 }], inBattle, selling, text: "" });

  it("is the battle bag in battle, even if the ask says selling", () => {
    expect(momentOf({ inBattle: true, battleKind: "trainer" } as GameSnapshot, bag(true, true))).toBe("trainer");
    expect(requestOf(rom, bag(true, true))).toEqual({ kind: "battle-bag" });
    expect(momentOf({ inBattle: true, battleKind: "wild" } as GameSnapshot, bag(true, false))).toBe("wild");
  });

  it("is the shop only for the Mart's sell list", () => {
    const walking = { inBattle: false, battleKind: null } as GameSnapshot;
    expect(momentOf(walking, bag(false, true))).toBe("shop");
    expect(requestOf(rom, bag(false, true))).toEqual({ kind: "sell" });
    expect(momentOf(walking, bag(false, false))).toBe("explore");
  });
});
