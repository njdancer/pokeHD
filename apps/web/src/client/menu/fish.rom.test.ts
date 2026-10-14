// ROM test for fishing from the Pokédex menu's bag (QA bug 72: the OLD ROD had no Use, so there was
// no way to fish). The live menu's action (what the item page's "Use it" calls, verbs.test.ts) to
// the game's own UseItem → ItemUseOldRod, at Vermilion's water where the QA player stood, facing it
// and facing away. The game's "<PLAYER> used OLD ROD!" names the rod, as from the start menu's bag
// (QA bug 73: "used !"). Skips without the dev ROM.
import { existsSync, readFileSync } from "node:fs";
import { SYMBOLS, type SymbolName } from "@pokehd/rom";
import { describe, expect, it } from "vitest";
import { Button, GameBoy } from "../../../../../packages/emu/src/core.ts";
import { GameActions } from "../../../../../packages/emu/src/game/actions.ts";
import { textBoxText } from "../../../../../packages/emu/src/game/asks.ts";
import { playIntro, setBag, setParty } from "../../../../../packages/emu/src/testing.ts";
import { LiveActions, type LiveHost } from "./live.ts";

const ROM_PATH = new URL("../../../../../rom/pokeblue.gb", import.meta.url);
const WASM_PATH = new URL("../../../../../packages/emu/src/generated/sameboy.wasm", import.meta.url);

const VERMILION_CITY = 5;
const WIDTH = 20;
const SQUIRTLE = 0xb1;
const MAGIKARP = 0x85;
const OLD_ROD = 0x4c;
const addr = (name: SymbolName) => SYMBOLS[name].address;
const frames = (gb: GameBoy, n: number) => {
  for (let i = 0; i < n; i++) gb.runFrame();
};

/** Vermilion at (x, y), turned to face `face` (0: as the warp left them, facing up), with an OLD ROD in the bag. */
async function standAt(x: number, y: number, face: number) {
  const rom = new Uint8Array(readFileSync(ROM_PATH));
  const gb = await GameBoy.create({ rom, wasmBinary: readFileSync(WASM_PATH) });
  playIntro(gb);
  setParty(gb, rom, [{ species: SQUIRTLE, level: 20 }]);
  setBag(gb, [[OLD_ROD, 1]]);
  let entered = false;
  const remove = gb.addHook("OverworldLoop", (g) => {
    if (entered) return;
    entered = true;
    g.write(addr("wCurMap"), VERMILION_CITY);
    g.write(addr("wXCoord"), x);
    g.write(addr("wYCoord"), y);
    const view = addr("wOverworldMap") + 7 + WIDTH + (WIDTH + 6) * (y >> 1) + (x >> 1);
    g.write(addr("wCurrentTileBlockMapViewPointer"), view & 0xff);
    g.write(addr("wCurrentTileBlockMapViewPointer") + 1, view >> 8);
    g.write(addr("wYBlockCoord"), y & 1);
    g.write(addr("wXBlockCoord"), x & 1);
    g.setRegisters({ pc: addr("EnterMap") });
  });
  frames(gb, 300);
  remove();
  if (face) {
    gb.setButtons(face);
    frames(gb, 4);
    gb.setButtons(0);
    frames(gb, 30);
  }
  expect([gb.read(addr("wXCoord")), gb.read(addr("wYCoord"))]).toEqual([x, y]);

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
  /** Every text box the game showed on the way, as the HD text layer reads the screen. */
  const boxes: string[] = [];
  const use = async () => {
    expect(actions.useItem(OLD_ROD)).toBe("");
    for (let i = 0; i < 1800 && notices.length === 0; i++) {
      gb.runFrame();
      const box = textBoxText(gb).replace(/\s+/g, " ").trim();
      if (box && boxes.at(-1) !== box) boxes.push(box);
      await Promise.resolve();
    }
    return notices;
  };
  return { gb, use, boxes };
}

describe.skipIf(!existsSync(ROM_PATH))("fishing from the menu (ROM)", () => {
  it("hooks a MAGIKARP with the OLD ROD facing Vermilion's water", async () => {
    // Where the QA player stood: (6, 4), the water to the left.
    const { gb, use, boxes } = await standAt(6, 4, Button.Left);
    // The rod's name, as the bag's USE leaves it in wStringBuffer (QA bug 73: "used !"), on the
    // screen and in what the menu says afterwards.
    expect(await use()).toEqual([expect.stringMatching(/^\S+ used OLD ROD! Oh! It's a bite!$/)]);
    expect(boxes).toContainEqual(expect.stringMatching(/^\S+ used OLD ROD!$/));
    expect(gb.read(addr("wCurOpponent"))).toBe(MAGIKARP);
    expect(gb.read(addr("wCurEnemyLevel"))).toBe(5);
    // And OverworldLoop starts the battle with it, as after the start menu.
    let battle = false;
    for (let i = 0; i < 600 && !battle; i++) {
      gb.runFrame();
      battle = gb.read(addr("wIsInBattle")) === 1;
    }
    expect(battle).toBe(true);
  }, 60_000);

  it("is not the time facing away from the water", async () => {
    const { gb, use } = await standAt(6, 4, 0);
    expect(gb.read(addr("wSpritePlayerStateData1FacingDirection"))).toBe(4); // SPRITE_FACING_UP, at the building
    expect(await use()).toEqual([expect.stringMatching(/isn't the time/i)]);
    expect(gb.read(addr("wCurOpponent"))).toBe(0);
  }, 60_000);
});
