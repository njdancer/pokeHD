// ROM test for an item used on a Pokémon in a battle from the HD battle menu's bag (QA bug 55): a
// POTION from the bag sheet, on the Pokémon picked in the party sheet. The game's ItemUseMedicine
// then draws its party screen over the battle, counts the HP bar up and says "SQUIRTLE recovered
// by 20!". None of that party screen may show over the HD battle; its message shows in HD and a
// tap on it reads on, back to the battle menu. The HD bag picks the Pokémon up front ("Use POTION
// on GEODUDE"): the menu answers the game's party question itself, and that answer too must start
// the item's screens (QA bug 57). Skips without the ROM.
import { existsSync, readFileSync } from "node:fs";
import { GameBoy, type AskAnswer, type GameAsk } from "@pokehd/emu";
import { SYMBOLS } from "@pokehd/rom";
import { beforeAll, describe, expect, it } from "vitest";
import { playIntro, setBag, setParty } from "../../../../../packages/emu/src/testing.ts";
import { battlePage } from "./battle-page.testing.ts";

const ROM_PATH = new URL("../../../../../rom/pokeblue.gb", import.meta.url);
const WASM_PATH = new URL("../../../../../packages/emu/src/generated/sameboy.wasm", import.meta.url);
const SQUIRTLE = 0xb1;
const PIKACHU = 0x54;
const RATTATA = 0xa5;
const GEODUDE = 0xa9;
const CHARMELEON = 0xb2;
const ZUBAT = 0x6b;
const ANTIDOTE = 0x0b;
const POTION = 0x14;
/** party_struct's HP, after the species (big-endian). */
const PARTY_HP = 1;
const PARTY_MON_LENGTH = 44;

describe.skipIf(!existsSync(ROM_PATH))("an item used in a battle from the HD bag", () => {
  let rom: Uint8Array;
  let wasm: Uint8Array;
  let start: Uint8Array;
  beforeAll(async () => {
    rom = new Uint8Array(readFileSync(ROM_PATH));
    wasm = new Uint8Array(readFileSync(WASM_PATH));
    const gb = await GameBoy.create({ rom, wasmBinary: wasm });
    playIntro(gb);
    start = gb.saveState();
  }, 240_000);

  const CASES = [0, 4, 15].flatMap((lag) => [
    { lag, target: 0, name: "SQUIRTLE" },
    { lag, target: 1, name: "PIKACHU" },
  ]);
  it.each(CASES)("keeps the party screen behind the HD battle and says the HP in HD: $name, lag $lag (QA bug 55)", { timeout: 120_000 }, async ({ lag, target, name }) => {
    const setup = await GameBoy.create({ rom, wasmBinary: wasm });
    setup.loadState(start);
    setParty(setup, rom, [{ species: SQUIRTLE, level: 10 }, { species: PIKACHU, level: 10 }]);
    setBag(setup, [[ANTIDOTE, 1], [POTION, 3]]);
    // Both down to 5 HP: the POTION goes to the one in the battle, or the other (like GEODUDE).
    for (const n of [0, 1]) setup.write(SYMBOLS.wPartyMons.address + n * PARTY_MON_LENGTH + PARTY_HP + 1, 5);
    setup.write(SYMBOLS.wCurOpponent.address, RATTATA);
    setup.write(SYMBOLS.wCurEnemyLevel.address, 2);
    const asked: GameAsk[] = [];
    const sheet = (ask: GameAsk): AskAnswer => {
      asked.push(ask);
      return ask.kind === "items" ? { index: 1 } : ask.kind === "party" ? { index: target } : null;
    };
    const p = await battlePage(setup.saveState(), { rom, wasm, lag, sheet });
    p.play(() => p.asked() !== null);
    const hp = () => p.gb.read(SYMBOLS.wPartyMons.address + target * PARTY_MON_LENGTH + PARTY_HP + 1);
    expect(hp()).toBe(5);

    const shown = p.answer({ choice: "item" });
    expect(asked.map((a) => a.kind)).toEqual(["items", "party"]);
    expect(asked[1]).toMatchObject({ purpose: "item", inBattle: true });
    expect(shown.leaks).toEqual([]);
    expect(shown.hd).toContain(`${name} / recovered by 20!`);
    // 25, less what the Rattata took off on its turn if it was the one fighting.
    expect(hp()).toBeGreaterThan(15);
    expect(p.asked()).toMatchObject({ ask: { kind: "menu" } });
  });

  // QA bug 57: Mt Moon, GEODUDE (the leader, in the battle) at 8/31 against a ZUBAT, the bag's
  // "Use POTION on GEODUDE". The party question never reaches a sheet: the menu answers it.
  it.each([0, 4, 15])("keeps the party screen behind the HD battle with the Pokémon picked in the bag: lag %i (QA bug 57)", { timeout: 120_000 }, async (lag) => {
    const setup = await GameBoy.create({ rom, wasmBinary: wasm });
    setup.loadState(start);
    setParty(setup, rom, [{ species: GEODUDE, level: 11 }, { species: CHARMELEON, level: 30 }]);
    setBag(setup, [[ANTIDOTE, 1], [POTION, 3]]);
    setup.write(SYMBOLS.wPartyMons.address + PARTY_HP + 1, 8);
    setup.write(SYMBOLS.wCurOpponent.address, ZUBAT);
    setup.write(SYMBOLS.wCurEnemyLevel.address, 11);
    const sheets: GameAsk[] = [];
    const p = await battlePage(setup.saveState(), {
      rom,
      wasm,
      lag,
      bag: { item: POTION, mon: 0 },
      sheet: (ask) => (sheets.push(ask), null),
    });
    p.play(() => p.asked() !== null);
    const hp = () => p.gb.read(SYMBOLS.wPartyMons.address + PARTY_HP + 1);
    expect(hp()).toBe(8);

    const shown = p.answer({ choice: "item" });
    expect(sheets).toEqual([]);
    expect(p.gameAsks.map((a) => a.kind)).toEqual(["items", "party"]);
    expect(p.gameAsks[1]).toMatchObject({ purpose: "item", inBattle: true });
    expect(shown.leaks).toEqual([]);
    expect(shown.hd).toContain("GEODUDE / recovered by 20!");
    expect(hp()).toBeGreaterThan(8);
    expect(p.asked()).toMatchObject({ ask: { kind: "menu" } });
  });
});
