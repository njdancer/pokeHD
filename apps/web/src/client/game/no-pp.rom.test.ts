// ROM test for moves with no PP chosen from the HD battle menu (QA bugs 46, 51). The game says "No
// PP left for this move!" and puts its move list up again, as on the Game Boy. Between a tap and
// the next question none of the Game Boy's menus may show over the HD battle (the move list it
// draws either side of asking, read as loose text with its corner drawn over, and the battle menu
// still in video memory while the game holds back the screen copy), and the HD message box shows
// the message alone, not the move's TYPE box above it. Nor while the page's question or answer is
// still on its way to or from the emulator worker: the game's menu is up then without anyone
// asking (QA bug 51). The page plays as Game does: whole messages from the script, read on with a
// tap on the message box, and a game resumed in the middle of the battle. Skips without the ROM.
import { existsSync, readFileSync } from "node:fs";
import { GameBoy, type BattleAnswer } from "@pokehd/emu";
import { SYMBOLS } from "@pokehd/rom";
import { beforeAll, describe, expect, it } from "vitest";
import { playIntro, setParty } from "../../../../../packages/emu/src/testing.ts";
import { battlePage } from "./battle-page.testing.ts";

const ROM_PATH = new URL("../../../../../rom/pokeblue.gb", import.meta.url);
const WASM_PATH = new URL("../../../../../packages/emu/src/generated/sameboy.wasm", import.meta.url);
const SQUIRTLE = 0xb1;
const CHARMELEON = 0xb2;
const RATTATA = 0xa5;
const GEODUDE = 0xa9;
const TACKLE = 0x21;
const TAIL_WHIP = 0x27;
const MEGA_PUNCH = 0x05;
const SCRATCH = 0x0a;
const LEER = 0x2b;
const EMBER = 0x34;
/** party_struct: the moves, then the PP (PARTYMON_STRUCT_LENGTH 44). */
const PARTY_MOVES = 8;
const PARTY_PP = 29;

interface Options {
  /** Frames the page's questions and answers take to cross to the emulator worker and back. */
  lag?: number;
  /** The game is put away at the first question and resumed in a new emulator (restart_game). */
  resume?: boolean;
}

describe.skipIf(!existsSync(ROM_PATH))("moves with no PP from the HD battle menu", () => {
  let rom: Uint8Array;
  let wasm: Uint8Array;
  let start: Uint8Array;
  beforeAll(async () => {
    rom = new Uint8Array(readFileSync(ROM_PATH));
    wasm = new Uint8Array(readFileSync(WASM_PATH));
    const gb = await GameBoy.create({ rom, wasmBinary: readFileSync(WASM_PATH) });
    playIntro(gb);
    start = gb.saveState();
  }, 240_000);

  /**
   * A wild battle: `mon` with `moves` and their `pp`, against `foe`, played as Game shows it up to
   * the first question of the HD battle menu.
   */
  async function battle(mon: number, foe: number, moves: number[], pp: number[], { lag = 0, resume = false }: Options = {}) {
    const setup = await GameBoy.create({ rom, wasmBinary: readFileSync(WASM_PATH) });
    setup.loadState(start);
    setParty(setup, rom, [{ species: mon, level: 10 }]); // obeys without badges
    const party = SYMBOLS.wPartyMons.address;
    for (let i = 0; i < 4; i++) {
      setup.write(party + PARTY_MOVES + i, moves[i] ?? 0);
      setup.write(party + PARTY_PP + i, pp[i] ?? 0);
    }
    setup.write(SYMBOLS.wCurOpponent.address, foe);
    setup.write(SYMBOLS.wCurEnemyLevel.address, 2);
    let p = await battlePage(setup.saveState(), { rom, wasm, lag });
    p.play(() => p.asked() !== null);
    expect(p.asked()).toMatchObject({ ask: { kind: "menu" } });
    if (resume) {
      p = await battlePage(p.gb.saveState(), { rom, wasm, lag });
      const shown = p.play(() => p.asked() !== null);
      expect(shown.leaks.filter((l) => !l.includes("transition"))).toEqual([]);
    }
    return p;
  }

  it("shows no Game Boy menu, and the message alone in HD (QA bug 46)", { timeout: 120_000 }, async () => {
    const { gb, answer, asked } = await battle(SQUIRTLE, RATTATA, [TACKLE, TAIL_WHIP], [0, 20]);
    expect(asked()).toMatchObject({ ask: { kind: "menu", moves: [{ name: "TACKLE", pp: 0 }, { name: "TAIL WHIP" }] } });

    // TACKLE, from the battle menu: "No PP left for this move!", then the move list on its own.
    const noPp = answer({ fight: 0 });
    expect(noPp.leaks).toEqual([]);
    expect(noPp.hd).toContain("No PP left for / this move!");
    expect(noPp.hd.join(" | ")).not.toContain("TYPE/");
    expect(asked()).toMatchObject({ ask: { kind: "moves", purpose: "fight", cancel: true } });
    expect(gb.read(SYMBOLS.wBattleMonPP.address) & 0x3f).toBe(0);
  });

  // [answer, what, whether the game turns it down]
  const STEPS: [BattleAnswer, string, boolean][] = [
    [{ fight: 0 }, "SCRATCH from the battle menu", true],
    [{ move: 0 }, "SCRATCH again from the list", true],
    [{ move: 2 }, "EMBER from the list", true],
    [null, "Back", false],
    [{ fight: 3 }, "LEER, a turn", false],
    [{ fight: 2 }, "EMBER from the battle menu", true],
    [{ move: 1 }, "MEGA PUNCH from the list", true],
    [{ move: 3 }, "LEER from the list", false],
    [{ fight: 1 }, "MEGA PUNCH after a turn", true],
  ];
  const CASES = [0, 4, 15].flatMap((lag) => [false, true].map((resume) => ({ lag, resume })));

  it.each(CASES)("stays in HD through spent moves, the list and back: lag $lag, resumed $resume (QA bug 51)", { timeout: 120_000 }, async (options) => {
    const { answer } = await battle(CHARMELEON, GEODUDE, [SCRATCH, MEGA_PUNCH, EMBER, LEER], [0, 0, 0, 30], options);
    for (const [a, what, noPp] of STEPS) {
      const shown = answer(a);
      expect({ what, leaks: shown.leaks }).toEqual({ what, leaks: [] });
      expect(shown.hd.join(" | ")).not.toMatch(/TYPE\/|FIGHT/);
      if (noPp) expect({ what, hd: shown.hd }).toEqual({ what, hd: expect.arrayContaining(["No PP left for / this move!"]) as string[] });
    }
  });
});
