// ROM test for the Inventory's filters (QA bug 50: MOON STONE was listed under Healing). Skips
// without the dev ROM.
import { existsSync, readFileSync } from "node:fs";
import { itemUse } from "@pokehd/emu";
import { describe, expect, it } from "vitest";
import { itemPrice } from "./items.ts";
import { itemKind } from "./live.ts";

const ROM_PATH = new URL("../../../../../rom/pokeblue.gb", import.meta.url);

describe.skipIf(!existsSync(ROM_PATH))("itemKind", () => {
  const rom = () => new Uint8Array(readFileSync(ROM_PATH));

  it("files MOON STONE as a boost, still used on a Pokémon", () => {
    const r = rom();
    expect(itemKind(r, 0x0a)).toBe("Boosts");
    expect(itemUse(r, 0x0a).onMon).toBe(true);
  });

  it("files the other stones, vitamins and RARE CANDY as boosts, potions as Healing", () => {
    const r = rom();
    // FIRE, THUNDER, WATER, LEAF STONE; HP UP, PROTEIN, IRON, CARBOS, CALCIUM; RARE CANDY.
    for (const id of [0x20, 0x21, 0x22, 0x2f, 0x23, 0x24, 0x25, 0x26, 0x27, 0x28]) expect(itemKind(r, id)).toBe("Boosts");
    expect(itemKind(r, 0x14)).toBe("Healing");
  });

  it("prices TMs as GetMachinePrice does (Celadon sells them), HMs not at all", () => {
    const r = rom();
    const TM01 = 0xc9;
    // TM01 MEGA PUNCH ₽3000, TM02 RAZOR WIND ₽2000, TM07 HORN DRILL ₽2000; POKé BALL from ItemPrices.
    expect(itemPrice(r, TM01)).toBe(3000);
    expect(itemPrice(r, TM01 + 1)).toBe(2000);
    expect(itemPrice(r, TM01 + 6)).toBe(2000);
    expect(itemPrice(r, 0xc4)).toBe(0);
    expect(itemPrice(r, 0x04)).toBe(200);
  });
});
