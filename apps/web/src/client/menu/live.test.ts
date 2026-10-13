// Which read of the game the menu shows while the game asks (QA bug 24: a Poké Mart's money).
import type { GameSnapshot } from "@pokehd/emu";
import { describe, expect, it } from "vitest";
import { currentGame } from "./live.ts";

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
