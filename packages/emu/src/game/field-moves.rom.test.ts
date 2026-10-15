// ROM test for the field moves from the Pokédex menu beyond CUT (the HD UI pass found only CUT had
// a way in, and with the game's Start menu gone a player on a phone could never SURF, FLY or use
// STRENGTH): each one through GameActions, StartMenu_Pokemon's branch call by call. Skips without
// the dev ROM.
import { existsSync, readFileSync } from "node:fs";
import { MAP_NAMES, parseWorld, SYMBOLS, type SymbolName } from "@pokehd/rom";
import { describe, expect, it } from "vitest";
import { Button, GameBoy } from "../core.ts";
import { enterMap, playIntro, setParty } from "../testing.ts";
import { GameActions, type ActionResult, type FieldMove } from "./actions.ts";

const ROM_PATH = new URL("../../../../rom/pokeblue.gb", import.meta.url);
const WASM_PATH = new URL("../generated/sameboy.wasm", import.meta.url);

const addr = (name: SymbolName) => SYMBOLS[name].address;
const PARTYMON = 44;
const MOVES: Record<FieldMove, number> = { FLY: 0x13, SURF: 0x39, STRENGTH: 0x46, FLASH: 0x94, DIG: 0x5b, TELEPORT: 0x64, SOFTBOILED: 0x87 };
// Species (internal IDs): Blastoise, Pidgeot, Chansey.
const BLASTOISE = 0x1c;
const PIDGEOT = 0x97;
const CHANSEY = 0x28;
const map = (name: string) => MAP_NAMES.indexOf(name);

describe.skipIf(!existsSync(ROM_PATH))("field moves from the menu (ROM)", () => {
  const rom = () => new Uint8Array(readFileSync(ROM_PATH));

  /** A player with Blastoise (SURF, STRENGTH, FLASH, DIG), Pidgeot (FLY, TELEPORT) and a hurt Chansey (SOFTBOILED). */
  async function game(badges = 0xff) {
    const r = rom();
    const world = parseWorld(r);
    const gb = await GameBoy.create({ rom: r, wasmBinary: readFileSync(WASM_PATH) });
    playIntro(gb);
    setParty(gb, r, [{ species: BLASTOISE, level: 50 }, { species: PIDGEOT, level: 40 }, { species: CHANSEY, level: 40 }]);
    const teach = (mon: number, moves: number[]) => moves.forEach((m, k) => (gb.write(addr("wPartyMons") + mon * PARTYMON + 8 + k, m), gb.write(addr("wPartyMons") + mon * PARTYMON + 29 + k, 15)));
    teach(0, [MOVES.SURF, MOVES.STRENGTH, MOVES.FLASH, MOVES.DIG]);
    teach(1, [MOVES.FLY, MOVES.TELEPORT]);
    teach(2, [MOVES.SOFTBOILED]);
    gb.write(addr("wObtainedBadges"), badges);
    gb.write(addr("wTownVisitedFlag"), 0xff);
    gb.write(addr("wTownVisitedFlag") + 1, 0x07);
    gb.write(addr("wLastBlackoutMap"), map("VIRIDIAN_CITY"));
    const actions = new GameActions(gb, { rom: r });
    const go = (name: string, x: number, y: number, last = name) => enterMap(gb, map(name), x, y, world.maps[map(name)]!.widthBlocks, map(last));
    const run = async (action: Parameters<GameActions["run"]>[0], frames = 1500) => {
      let result: ActionResult | null = null;
      actions.run(action, (r) => (result = r));
      for (let i = 0; i < frames && result === null; i++) {
        gb.runFrame();
        await Promise.resolve();
      }
      // And the frames after it: a warp, the map coming back.
      for (let i = 0; i < 400; i++) gb.runFrame();
      return result as ActionResult | null;
    };
    const read = (name: SymbolName) => gb.read(addr(name));
    const where = () => [read("wCurMap"), read("wXCoord"), read("wYCoord")];
    return { gb, go, run, read, where };
  }

  it("SURFs onto the water the player faces", { timeout: 60_000 }, async () => {
    const { gb, go, run, read, where } = await game();
    go("PALLET_TOWN", 5, 13);
    gb.setButtons(Button.Down);
    for (let i = 0; i < 4; i++) gb.runFrame();
    gb.setButtons(0);
    for (let i = 0; i < 30; i++) gb.runFrame();
    expect(where()).toEqual([map("PALLET_TOWN"), 5, 13]);
    const r = await run({ kind: "field-move", move: "SURF", mon: 0 });
    expect(r).toMatchObject({ ok: true });
    expect(read("wWalkBikeSurfState")).toBe(2);
    expect(where()).toEqual([map("PALLET_TOWN"), 5, 14]);
  });

  it("says why it can't SURF on land", { timeout: 60_000 }, async () => {
    const { go, run, read } = await game();
    go("PEWTER_CITY", 18, 22);
    const r = await run({ kind: "field-move", move: "SURF", mon: 0 });
    expect(r?.ok).toBe(false);
    expect(read("wWalkBikeSurfState")).toBe(0);
  });

  it("FLYs to a town the player has visited", { timeout: 60_000 }, async () => {
    const { go, run, where } = await game();
    go("PALLET_TOWN", 10, 8);
    const r = await run({ kind: "field-move", move: "FLY", mon: 1, to: map("PEWTER_CITY") }, 2000);
    expect(r).toMatchObject({ ok: true });
    for (let i = 0; i < 600 && where()[0] !== map("PEWTER_CITY"); i++) (await Promise.resolve(), undefined);
    expect(where()[0]).toBe(map("PEWTER_CITY"));
  });

  it("won't FLY indoors, in the game's words", { timeout: 60_000 }, async () => {
    const { go, run, where } = await game();
    go("PEWTER_POKECENTER", 3, 4, "PEWTER_CITY");
    const r = await run({ kind: "field-move", move: "FLY", mon: 1, to: map("PALLET_TOWN") });
    expect(r).toMatchObject({ ok: false, messages: [expect.stringMatching(/can't\s+FLY here/i)] });
    expect(where()[0]).toBe(map("PEWTER_POKECENTER"));
  });

  it("refuses without the badge", { timeout: 60_000 }, async () => {
    const { go, run } = await game(0);
    go("PALLET_TOWN", 10, 8);
    expect(await run({ kind: "field-move", move: "FLY", mon: 1, to: map("PEWTER_CITY") })).toMatchObject({ ok: false, messages: ["FLY needs the THUNDERBADGE from Vermilion's Gym."] });
  });

  it("STRENGTH lets boulders move", { timeout: 60_000 }, async () => {
    const { go, run, read } = await game();
    go("PALLET_TOWN", 10, 8);
    const r = await run({ kind: "field-move", move: "STRENGTH", mon: 0 });
    expect(r).toMatchObject({ ok: true, messages: expect.arrayContaining([expect.stringMatching(/used\s+STRENGTH/)]) });
    expect(read("wStatusFlags1") & 1).toBe(1);
  });

  it("FLASH lights a dark cave", { timeout: 60_000 }, async () => {
    const { go, run, read } = await game();
    go("ROCK_TUNNEL_1F", 15, 5, "ROUTE_10");
    expect(read("wMapPalOffset")).not.toBe(0);
    const r = await run({ kind: "field-move", move: "FLASH", mon: 0 });
    expect(r).toMatchObject({ ok: true, messages: [expect.stringMatching(/FLASH\s+lights\s+the\s+area/)] });
    expect(read("wMapPalOffset")).toBe(0);
  });

  it("DIGs out of a cave to the last Pokémon Center's town", { timeout: 60_000 }, async () => {
    const { go, run, where } = await game();
    go("ROCK_TUNNEL_1F", 15, 5, "ROUTE_10");
    expect(await run({ kind: "field-move", move: "DIG", mon: 0 }, 2000)).toMatchObject({ ok: true });
    expect(where()[0]).toBe(map("VIRIDIAN_CITY"));
  });

  it("TELEPORTs from outside, and says it can't indoors", { timeout: 60_000 }, async () => {
    const { go, run, where } = await game();
    go("PEWTER_POKECENTER", 3, 4, "PEWTER_CITY");
    expect(await run({ kind: "field-move", move: "TELEPORT", mon: 1 })).toMatchObject({ ok: false, messages: [expect.stringMatching(/can't\s+use TELEPORT now/i)] });
    go("PALLET_TOWN", 10, 8);
    expect(await run({ kind: "field-move", move: "TELEPORT", mon: 1 }, 2000)).toMatchObject({ ok: true });
    expect(where()[0]).toBe(map("VIRIDIAN_CITY"));
  });

  it("SOFTBOILED gives a fifth of Chansey's HP to another", { timeout: 60_000 }, async () => {
    const { gb, go, run } = await game();
    go("PALLET_TOWN", 10, 8);
    const hp = (mon: number) => (gb.read(addr("wPartyMons") + mon * PARTYMON + 1) << 8) | gb.read(addr("wPartyMons") + mon * PARTYMON + 2);
    const maxHp = (mon: number) => (gb.read(addr("wPartyMons") + mon * PARTYMON + 34) << 8) | gb.read(addr("wPartyMons") + mon * PARTYMON + 35);
    gb.write(addr("wPartyMons") + PARTYMON + 1, 0);
    gb.write(addr("wPartyMons") + PARTYMON + 2, 10);
    const before = hp(2);
    const r = await run({ kind: "field-move", move: "SOFTBOILED", mon: 2, target: 1 });
    expect(r).toMatchObject({ ok: true });
    expect(hp(2)).toBe(before - Math.floor(maxHp(2) / 5));
    expect(hp(1)).toBe(10 + Math.floor(maxHp(2) / 5));
  });
});
