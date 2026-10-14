// ROM test for CUT from the Pokédex menu (QA bug 69): the live menu's action (what the team
// screen's "Use CUT" calls, verbs.test.ts) to the game's own UsedCut, at Vermilion's Gym tree with
// the player facing it. Before, the verb only ever said "There's nothing to cut here". Skips
// without the dev ROM.
import { existsSync, readFileSync } from "node:fs";
import { SYMBOLS, type SymbolName } from "@pokehd/rom";
import { describe, expect, it } from "vitest";
import { Button, GameBoy } from "../../../../../packages/emu/src/core.ts";
import { GameActions } from "../../../../../packages/emu/src/game/actions.ts";
import { playIntro, setParty } from "../../../../../packages/emu/src/testing.ts";
import { LiveActions, type LiveHost } from "./live.ts";

const ROM_PATH = new URL("../../../../../rom/pokeblue.gb", import.meta.url);
const WASM_PATH = new URL("../../../../../packages/emu/src/generated/sameboy.wasm", import.meta.url);

const VERMILION_CITY = 5;
const WIDTH = 20;
const SQUIRTLE = 0xb1;
const CUT = 0x0f;
const addr = (name: SymbolName) => SYMBOLS[name].address;
const frames = (gb: GameBoy, n: number) => {
  for (let i = 0; i < n; i++) gb.runFrame();
};
/** The tree's block, (7, 9): wOverworldMap has a border three blocks wide. */
const treeBlock = (gb: GameBoy) => gb.read(addr("wOverworldMap") + (WIDTH + 6) * (9 + 3) + 7 + 3);

describe.skipIf(!existsSync(ROM_PATH))("CUT from the menu (ROM)", () => {
  it("cuts down the tree beside Vermilion's Gym that the player faces", async () => {
    const rom = new Uint8Array(readFileSync(ROM_PATH));
    const gb = await GameBoy.create({ rom, wasmBinary: readFileSync(WASM_PATH) });
    playIntro(gb);
    setParty(gb, rom, [{ species: SQUIRTLE, level: 20 }]);
    gb.write(addr("wPartyMons") + 8 + 3, CUT);
    gb.write(addr("wPartyMons") + 29 + 3, 30);
    gb.write(addr("wObtainedBadges"), 0b10); // the CASCADEBADGE
    // Where the QA player stood: (14, 18), just left of the tree at (15, 18).
    let entered = false;
    const remove = gb.addHook("OverworldLoop", (g) => {
      if (entered) return;
      entered = true;
      g.write(addr("wCurMap"), VERMILION_CITY);
      g.write(addr("wXCoord"), 14);
      g.write(addr("wYCoord"), 18);
      const view = addr("wOverworldMap") + 7 + WIDTH + (WIDTH + 6) * 9 + 7;
      g.write(addr("wCurrentTileBlockMapViewPointer"), view & 0xff);
      g.write(addr("wCurrentTileBlockMapViewPointer") + 1, view >> 8);
      g.write(addr("wYBlockCoord"), 0);
      g.write(addr("wXBlockCoord"), 0);
      g.setRegisters({ pc: addr("EnterMap") });
    });
    frames(gb, 300);
    remove();
    expect(treeBlock(gb)).toBe(0x35);
    // Turn to face the tree.
    gb.setButtons(Button.Right);
    frames(gb, 4);
    gb.setButtons(0);
    frames(gb, 30);
    expect([gb.read(addr("wXCoord")), gb.read(addr("wYCoord"))]).toEqual([14, 18]);

    const game = new GameActions(gb, { rom });
    const notices: string[] = [];
    const host: LiveHost = {
      act: (action) => new Promise((resolve) => game.run(action, resolve)),
      answer: () => {},
      notice: (text) => notices.push(text),
      setApp: () => {},
      game: null,
    };
    const actions = new LiveActions(rom, { current: host });
    expect(actions.cut(0)).toBe("");
    for (let i = 0; i < 1200 && notices.length === 0; i++) {
      gb.runFrame();
      await Promise.resolve();
    }
    expect(notices).toEqual([expect.stringMatching(/hacked away with CUT!/)]);
    expect(treeBlock(gb)).toBe(0x4c);
  }, 60_000);
});
