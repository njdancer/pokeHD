// ROM test for a catch's Pokédex page (QA bug 68): a wild SPEAROW caught with a ball from the HD
// battle menu's bag. ItemUseBall says "New POKéDEX data will be added for SPEAROW!", then
// ShowPokedexData whites the screen out and draws the game's own Pokédex page over the battle,
// waiting for A or B. The page shows the Pokémon in its HD Pokédex instead (DexGuard), and the
// game's page, its white-out and the cleared screen after it stay behind the HD battle: nothing of
// the Game Boy screen shows from the catch to the nickname question, and one tap on the HD
// Pokédex goes on to it. The Pokédex menu opens on the caught Pokémon's page (dexMenuStart), as
// after a MAGIKARP hooked with the OLD ROD from the menu's bag (QA bug 73). Skips without the ROM.
import { existsSync, readFileSync } from "node:fs";
import { Button, GameBoy, type AskAnswer, type GameAsk } from "@pokehd/emu";
import { SYMBOLS } from "@pokehd/rom";
import { beforeAll, describe, expect, it } from "vitest";
import { playIntro, setBag, setParty } from "../../../../../packages/emu/src/testing.ts";
import { GameActions } from "../../../../../packages/emu/src/game/actions.ts";
import { dexMenuStart } from "./battle.ts";
import { battlePage } from "./battle-page.testing.ts";

const ROM_PATH = new URL("../../../../../rom/pokeblue.gb", import.meta.url);
const WASM_PATH = new URL("../../../../../packages/emu/src/generated/sameboy.wasm", import.meta.url);
const SQUIRTLE = 0xb1;
const SPEAROW = 0x05;
const MASTER_BALL = 0x01;
const POKE_BALL = 0x04;
const MAGIKARP = 0x85;
const OLD_ROD = 0x4c;
const VERMILION_CITY = 5;
const NICKNAME = /^Do you want to\ngive a nickname\nto SPEAROW\?$/;
const addr = (name: keyof typeof SYMBOLS) => SYMBOLS[name].address;

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
    // The menu opens on SPEAROW's page (No. 21), and backing out of it shuts the menu.
    expect(dexMenuStart(rom, p.dexOpened[0]!)).toEqual({ tab: "dex", screen: { k: "entry", dex: 21 }, backCloses: true });
    const dexTaps = shown.taps.filter((t) => t.tap === "dex");
    expect(dexTaps).toHaveLength(1);
    expect(p.dexUp()).toBe(false);
    // It's in the party, caught.
    expect(p.gb.read(SYMBOLS.wPartyCount.address)).toBe(2);
  });

  it("opens on MAGIKARP's page after one hooked with the OLD ROD from the menu's bag (QA bug 73)", { timeout: 120_000 }, async () => {
    const setup = await GameBoy.create({ rom, wasmBinary: wasm });
    setup.loadState(start);
    setParty(setup, rom, [{ species: SQUIRTLE, level: 10 }]);
    setBag(setup, [[MASTER_BALL, 1], [OLD_ROD, 1]]);
    // At Vermilion's water, where the QA player fished: (6, 4), facing it on the left.
    let entered = false;
    const remove = setup.addHook("OverworldLoop", (g) => {
      if (entered) return;
      entered = true;
      const [x, y, width] = [6, 4, 20];
      g.write(addr("wCurMap"), VERMILION_CITY);
      g.write(addr("wXCoord"), x);
      g.write(addr("wYCoord"), y);
      const view = addr("wOverworldMap") + 7 + width + (width + 6) * (y >> 1) + (x >> 1);
      g.write(addr("wCurrentTileBlockMapViewPointer"), view & 0xff);
      g.write(addr("wCurrentTileBlockMapViewPointer") + 1, view >> 8);
      g.write(addr("wYBlockCoord"), y & 1);
      g.write(addr("wXBlockCoord"), x & 1);
      g.setRegisters({ pc: addr("EnterMap") });
    });
    for (let i = 0; i < 300; i++) setup.runFrame();
    remove();
    setup.setButtons(Button.Left);
    for (let i = 0; i < 4; i++) setup.runFrame();
    setup.setButtons(0);
    for (let i = 0; i < 30; i++) setup.runFrame();
    // The menu's Fish: UseItem with the rod, until OverworldLoop starts the battle it hooked.
    const actions = new GameActions(setup, { rom });
    let fished = false;
    actions.run({ kind: "use-item", item: OLD_ROD }, (r) => (fished = r.ok));
    for (let i = 0; i < 3000 && setup.read(addr("wIsInBattle")) !== 1; i++) setup.runFrame();
    actions.dispose();
    expect(fished).toBe(true);
    expect(setup.read(addr("wIsInBattle"))).toBe(1);

    const sheet = (ask: GameAsk): AskAnswer => (ask.kind === "items" ? { index: 0 } : null);
    const p = await battlePage(setup.saveState(), { rom, wasm, sheet });
    p.play(() => p.asked() !== null);
    const nickname = () => p.gameAsks.some((a) => a.kind === "yes-no" && /^Do you want to\ngive a nickname\nto MAGIKARP\?$/.test(a.text));
    const shown = p.answer({ choice: "item" }, nickname);
    expect(shown.leaks).toEqual([]);
    expect(p.dexOpened).toEqual([{ kind: "data", species: MAGIKARP }]);
    expect(dexMenuStart(rom, p.dexOpened[0]!)).toEqual({ tab: "dex", screen: { k: "entry", dex: 129 }, backCloses: true });
    expect(shown.taps.filter((t) => t.tap === "dex")).toHaveLength(1);
    expect(p.dexUp()).toBe(false);
  });
});
