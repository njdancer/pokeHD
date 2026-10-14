// ROM test for a catch's Pokédex page (QA bug 68): a wild SPEAROW caught with a ball from the HD
// battle menu's bag. ItemUseBall says "New POKéDEX data will be added for SPEAROW!", then
// ShowPokedexData whites the screen out and draws the game's own Pokédex page over the battle,
// waiting for A or B. The page shows the Pokémon in its HD Pokédex instead (DexGuard), and the
// game's page, its white-out and the cleared screen after it stay behind the HD battle: nothing of
// the Game Boy screen shows from the catch to the nickname question, and one tap on the HD
// Pokédex goes on to it. Skips without the ROM.
import { existsSync, readFileSync } from "node:fs";
import { GameBoy, type AskAnswer, type GameAsk } from "@pokehd/emu";
import { SYMBOLS } from "@pokehd/rom";
import { beforeAll, describe, expect, it } from "vitest";
import { playIntro, setBag, setParty } from "../../../../../packages/emu/src/testing.ts";
import { battlePage } from "./battle-page.testing.ts";

const ROM_PATH = new URL("../../../../../rom/pokeblue.gb", import.meta.url);
const WASM_PATH = new URL("../../../../../packages/emu/src/generated/sameboy.wasm", import.meta.url);
const SQUIRTLE = 0xb1;
const SPEAROW = 0x05;
const MASTER_BALL = 0x01;
const POKE_BALL = 0x04;
const NICKNAME = /^Do you want to\ngive a nickname\nto SPEAROW\?$/;

describe.skipIf(!existsSync(ROM_PATH))("a catch's Pokédex page", () => {
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

  it.each([0, 4, 15])("shows in HD over the HD battle, and one tap goes on to the nickname: lag %i (QA bug 68)", { timeout: 120_000 }, async (lag) => {
    const setup = await GameBoy.create({ rom, wasmBinary: wasm });
    setup.loadState(start);
    setParty(setup, rom, [{ species: SQUIRTLE, level: 10 }]);
    setBag(setup, [[MASTER_BALL, 1], [POKE_BALL, 5]]);
    setup.write(SYMBOLS.wCurOpponent.address, SPEAROW);
    setup.write(SYMBOLS.wCurEnemyLevel.address, 3);
    const sheet = (ask: GameAsk): AskAnswer => (ask.kind === "items" ? { index: 0 } : null);
    const p = await battlePage(setup.saveState(), { rom, wasm, lag, sheet });
    p.play(() => p.asked() !== null);

    // The ball, its messages read with a tap each, until the game asks about a nickname.
    const nickname = () => p.gameAsks.some((a) => a.kind === "yes-no" && NICKNAME.test(a.text));
    const shown = p.answer({ choice: "item" }, nickname);
    expect(shown.leaks).toEqual([]);
    expect(shown.hd).toContain("New POKéDEX data / will be added for / SPEAROW!");
    // The game opened SPEAROW's page: the page showed it, and one tap shut it.
    expect(p.dexOpened).toEqual([{ kind: "data", species: SPEAROW }]);
    const dexTaps = shown.taps.filter((t) => t.tap === "dex");
    expect(dexTaps).toHaveLength(1);
    expect(p.dexUp()).toBe(false);
    // It's in the party, caught.
    expect(p.gb.read(SYMBOLS.wPartyCount.address)).toBe(2);
  });
});
