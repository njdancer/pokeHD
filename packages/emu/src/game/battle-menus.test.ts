// ROM test for the battle's menus answered by the page: a move chosen straight from the battle
// menu, a switch through the right-hand column, running away, and the move list the game puts up
// after turning a move down. Skips without the dev ROM.
import { existsSync, readFileSync } from "node:fs";
import { SYMBOLS, type SymbolName } from "@pokehd/rom";
import { beforeAll, describe, expect, it } from "vitest";
import { Button, GameBoy } from "../core.ts";
import { playIntro, setBag, setParty } from "../testing.ts";
import { GameAsks, type AskAnswer, type GameAsk } from "./asks.ts";
import { BattleMenus, type BattleAnswer, type BattleAsk } from "./battle-menus.ts";

const ROM_PATH = new URL("../../../../rom/pokeblue.gb", import.meta.url);
const WASM_PATH = new URL("../generated/sameboy.wasm", import.meta.url);

const PIKACHU = 0x54;
const SQUIRTLE = 0xb1;
const RATTATA = 0xa5;
const POTION = 0x14;
const TACKLE = 0x21;
const TAIL_WHIP = 0x27;
const NORMAL = 0x00;

const addr = (name: SymbolName) => SYMBOLS[name].address;
const r = (gb: GameBoy, name: SymbolName, offset = 0) => gb.read(addr(name) + offset);
const enemyHp = (gb: GameBoy) => (r(gb, "wEnemyMonHP") << 8) | r(gb, "wEnemyMonHP", 1);

describe.skipIf(!existsSync(ROM_PATH))("the battle's menus (ROM)", () => {
  let rom: Uint8Array;
  let start: Uint8Array;
  beforeAll(async () => {
    rom = new Uint8Array(readFileSync(ROM_PATH));
    const gb = await GameBoy.create({ rom, wasmBinary: new Uint8Array(readFileSync(WASM_PATH)) });
    playIntro(gb);
    start = gb.saveState();
  }, 120_000);

  /**
   * A wild Rattata against a Squirtle (TACKLE, TAIL WHIP) and a Pikachu. `answer` answers the
   * battle's menus by the number of the question; the party menu gets `party`.
   */
  async function battle(answer: (ask: BattleAsk, n: number) => BattleAnswer, party: AskAnswer = null) {
    const gb = await GameBoy.create({ rom, wasmBinary: new Uint8Array(readFileSync(WASM_PATH)) });
    gb.loadState(start);
    setParty(gb, rom, [{ species: SQUIRTLE, level: 12 }, { species: PIKACHU, level: 10 }]);
    setBag(gb, [[POTION, 3]]);
    const asked: BattleAsk[] = [];
    const gameAsked: GameAsk[] = [];
    let pending: number | null = null;
    let gamePending: number | null = null;
    const menus = new BattleMenus(gb, { rom, onAsk: (id, ask) => {
      asked.push(ask);
      pending = id;
    } });
    const asks = new GameAsks(gb, { rom, busy: () => false, onAsk: (id, ask) => {
      gameAsked.push(ask);
      gamePending = id;
    } });
    gb.write(addr("wCurOpponent"), RATTATA);
    gb.write(addr("wCurEnemyLevel"), 2);
    /** Runs frames (A through the messages), answering each question a few frames after it's asked. */
    const play = (n: number, until: () => boolean) => {
      for (let i = 0; i < n && !until(); i++) {
        gb.setButtons(i % 16 < 2 ? Button.A : 0);
        gb.runFrame();
        if (pending !== null && menus.asking) {
          const id = pending;
          pending = null;
          for (let k = 0; k < 5; k++) gb.runFrame();
          menus.answer(id, answer(menus.asking.ask, asked.length));
        }
        if (gamePending !== null && asks.asking) {
          const id = gamePending;
          gamePending = null;
          asks.answer(id, party);
        }
      }
      gb.setButtons(0);
    };
    return { gb, asked, gameAsked, play };
  }

  it("asks with the moves, and a move chosen from the battle menu is used without the move list", async () => {
    const { gb, asked, play } = await battle((ask) => (ask.kind === "menu" ? { fight: 0 } : null));
    play(4000, () => asked.length >= 2);
    expect(asked.map((a) => a.kind)).toEqual(["menu", "menu"]);
    expect(asked[0]).toEqual({
      kind: "menu",
      safari: false,
      balls: expect.any(Number) as number,
      link: false,
      moves: [
        { move: TACKLE, name: "TACKLE", type: NORMAL, pp: 20, maxPp: 35, disabled: false },
        { move: TAIL_WHIP, name: "TAIL WHIP", type: NORMAL, pp: 20, maxPp: 30, disabled: false },
      ],
    });
    // TACKLE took a PP and hurt the Rattata.
    expect(r(gb, "wBattleMonPP")).toBe(19);
    expect(r(gb, "wBattleMonPP", 1)).toBe(20);
    expect(enemyHp(gb)).toBeLessThan((r(gb, "wEnemyMon", 15) << 8) | r(gb, "wEnemyMon", 16));
  }, 30_000);

  it("switches through PKMN, in the menu's right-hand column", async () => {
    const { gb, asked, gameAsked, play } = await battle(() => ({ choice: "pkmn" }), { index: 1 });
    play(4000, () => r(gb, "wBattleMonSpecies") === PIKACHU && asked.length >= 2);
    expect(gameAsked[0]).toMatchObject({ kind: "party", purpose: "switch" });
    expect(r(gb, "wBattleMonSpecies")).toBe(PIKACHU);
  }, 30_000);

  it("comes back to the battle menu when the party menu is cancelled", async () => {
    const { asked, gameAsked, play } = await battle((_, n) => (n === 1 ? { choice: "pkmn" } : { choice: "run" }));
    play(4000, () => asked.length >= 2);
    expect(gameAsked.map((a) => a.kind)).toEqual(["party"]);
    expect(asked.map((a) => a.kind)).toEqual(["menu", "menu"]);
  }, 30_000);

  it("runs away", async () => {
    const { gb, play } = await battle(() => ({ choice: "run" }));
    let started = false;
    play(4000, () => (started ||= r(gb, "wIsInBattle") !== 0) && r(gb, "wIsInBattle") === 0);
    expect(started).toBe(true);
    expect(r(gb, "wIsInBattle")).toBe(0);
  }, 30_000);

  it("asks the move list on its own after the game turns a move down for no PP", async () => {
    const { gb, asked, play } = await battle((ask) => (ask.kind === "menu" ? { fight: 0 } : { move: 1 }));
    let emptied = false;
    play(4000, () => {
      // Once the Squirtle is out, TACKLE has no PP left.
      if (!emptied && r(gb, "wBattleMonSpecies") === SQUIRTLE && r(gb, "wBattleMonMoves") === TACKLE) {
        gb.write(addr("wBattleMonPP"), 0);
        emptied = true;
      }
      return asked.length >= 3;
    });
    expect(asked.map((a) => a.kind)).toEqual(["menu", "moves", "menu"]);
    expect(asked[1]).toMatchObject({ kind: "moves", purpose: "fight", cancel: true, moves: [{ pp: 0 }, { pp: 20 }] });
    // The game took TAIL WHIP; as on the Game Boy, a turn after "No PP left!" goes by without a move.
    expect(r(gb, "wPlayerSelectedMove")).toBe(TAIL_WHIP);
  }, 30_000);
});
