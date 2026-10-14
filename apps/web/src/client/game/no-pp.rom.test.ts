// ROM test for moves with no PP chosen from the HD battle menu (QA bugs 46, 51). The game says "No
// PP left for this move!" and puts its move list up again, as on the Game Boy. Between a tap and
// the next question none of the Game Boy's menus may show over the HD battle (the move list it
// draws either side of asking, read as loose text with its corner drawn over, and the battle menu
// still in video memory while the game holds back the screen copy), and the HD message box shows
// the message alone, not the move's TYPE box above it. Nor while the page's question or answer is
// still on its way to or from the emulator worker: the game's menu is up then without anyone
// asking (QA bug 51). Skips without the ROM.
import { existsSync, readFileSync } from "node:fs";
import {
  BATTLE_WATCHES, BattleMenus, Button, GameBoy, OVERWORLD_WATCHES, ScreenTextDecoder, TEXT_WATCHES,
  type BattleAnswer, type BattleAsk, type TextWatched, type Watch,
} from "@pokehd/emu";
import { readGlyphs, SYMBOLS } from "@pokehd/rom";
import { beforeAll, describe, expect, it } from "vitest";
import { playIntro, setParty } from "../../../../../packages/emu/src/testing.ts";
import { BattleTracker, BattleMenuCover, battleCovered, battleText, battleTextShown, maskBattleScreen } from "./battle.ts";
import { battleTextFits } from "./hd-text.ts";

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

describe.skipIf(!existsSync(ROM_PATH))("moves with no PP from the HD battle menu", () => {
  let rom: Uint8Array;
  let start: Uint8Array;
  beforeAll(async () => {
    rom = new Uint8Array(readFileSync(ROM_PATH));
    const gb = await GameBoy.create({ rom, wasmBinary: readFileSync(WASM_PATH) });
    playIntro(gb);
    start = gb.saveState();
  }, 240_000);

  /**
   * A wild battle: `mon` with `moves` and their `pp`, against `foe`, played as Game shows it up to
   * the first question of the HD battle menu.
   */
  async function battle(mon: number, foe: number, moves: number[], pp: number[], lag = 0) {
    const gb = await GameBoy.create({ rom, wasmBinary: readFileSync(WASM_PATH) });
    gb.loadState(start);
    setParty(gb, rom, [{ species: mon, level: 10 }]); // obeys without badges
    const party = SYMBOLS.wPartyMons.address;
    for (let i = 0; i < 4; i++) {
      gb.write(party + PARTY_MOVES + i, moves[i] ?? 0);
      gb.write(party + PARTY_PP + i, pp[i] ?? 0);
    }
    gb.write(SYMBOLS.wCurOpponent.address, foe);
    gb.write(SYMBOLS.wCurEnemyLevel.address, 2);
    const menus = new BattleMenus(gb, { rom, onAsk: () => {} });
    let watches: Record<string, Watch> = {};
    const battles = new BattleTracker(rom, { ...OVERWORLD_WATCHES, ...TEXT_WATCHES, ...BATTLE_WATCHES }, (w) => (watches = w));
    const decoder = new ScreenTextDecoder(readGlyphs(rom));
    const cover = new BattleMenuCover();

    /** The question as the page has it: questions and answers cross the worker boundary `lag` frames late. */
    let page: { id: number; ask: BattleAsk } | null = null;
    let askAge = 0;
    let sending: { id: number; answer: BattleAnswer; in: number } | null = null;
    const answered = new Set<number>();
    /**
     * One frame as Game shows it: the Game Boy pixels left over the HD battle (with what the screen
     * read as, for a failure), and the HD text.
     */
    const step = (buttons = 0) => {
      gb.setButtons(buttons);
      gb.runFrame();
      if (sending && --sending.in <= 0) {
        menus.answer(sending.id, sending.answer);
        sending = null;
      }
      const asked = menus.asking;
      if (asked && page?.id !== asked.id && !sending && !answered.has(asked.id)) {
        if (++askAge > lag) {
          page = asked;
          askAge = 0;
        }
      }
      const watched = Object.fromEntries(Object.entries(watches).map(([k, [a, n]]) => [k, gb.readBytes(a, n)]));
      const fight = battles.frame(watched);
      const screen = fight.scene === "scene" ? fight.screen : null;
      if (!screen) {
        cover.covering(null, !!page);
        // The Game Boy's own menu screen in a battle (the party, the bag) shows whole.
        return { visible: fight.scene === "menu" ? -1 : 0, hd: null, dialog: null, read: String(fight.scene) };
      }
      const onScreen = decoder.decode(battleText(watched as unknown as TextWatched, screen));
      const text = battleTextShown(onScreen);
      const choosing = cover.covering(onScreen, !!page);
      const fits = !choosing && battleTextFits(text);
      const data = new Uint8ClampedArray(gb.frame);
      maskBattleScreen(data, screen, battleCovered(onScreen, fits, choosing));
      let visible = 0;
      for (let i = 3; i < data.length; i += 4) if (data[i]) visible++;
      const hd = fits ? text.boxes.flatMap((b) => b.lines.map((l) => l.text)).join(" / ") : null;
      const read = JSON.stringify({ boxes: onScreen.boxes.map((b) => [b.x, b.y, b.width, b.height, b.lines.map((l) => l.text).join("|")]), loose: onScreen.loose.map((l) => l.text) });
      return { visible, hd, dialog: text.dialog, read };
    };

    for (let i = 0; i < 4000 && !page; i++) step(i % 16 < 2 ? Button.A : 0);
    expect(page).toMatchObject({ ask: { kind: "menu" } });

    /**
     * Answers the question (the page drops its menu at once), then plays on, reading each message
     * with A, until `done` (by default, the next question): what showed meanwhile.
     */
    const answer = (a: BattleAnswer, done: (hd: string | null) => boolean = () => page !== null) => {
      const id = page!.id;
      page = null;
      answered.add(id);
      sending = { id, answer: a, in: lag };
      if (!lag) {
        menus.answer(id, a);
        sending = null;
      }
      cover.answered();
      const shown = { leaks: [] as string[], hd: [] as string[] };
      for (let f = 0, waiting = 0; ; f++) {
        if (f > 2000) throw new Error(`Stuck: ${shown.hd.join(" | ")}`);
        const s = step(waiting % 16 === 15 ? Button.A : 0);
        waiting = s.dialog?.state === "waiting" ? waiting + 1 : 0;
        if (s.visible) shown.leaks.push(`frame ${f}: ${s.read}`);
        if (s.hd && shown.hd.at(-1) !== s.hd) shown.hd.push(s.hd);
        if (done(s.hd)) return shown;
      }
    };
    return { gb, answer, asked: () => page as { id: number; ask: BattleAsk } | null };
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

    // TAIL WHIP from that list: nothing of the list shows on the way to the turn's message.
    const used = answer({ move: 1 }, (hd) => !!hd?.includes("TAIL WHIP"));
    expect(used.leaks).toEqual([]);
  });

  // The page's questions and answers cross to the emulator worker and back a few frames late.
  it.each([0, 4, 15])("stays in HD through spent moves picked again from the list, and back, %i frames apart (QA bug 51)", { timeout: 120_000 }, async (lag) => {
    const { answer, asked } = await battle(CHARMELEON, GEODUDE, [SCRATCH, MEGA_PUNCH, EMBER, LEER], [0, 0, 0, 30], lag);
    // [answer, what, whether the game turns it down]
    const steps: [BattleAnswer, string, boolean][] = [
      [{ fight: 3 }, "LEER, a turn first", false],
      [{ fight: 2 }, "EMBER from the battle menu", true],
      [{ move: 2 }, "EMBER again from the list", true],
      [{ move: 0 }, "SCRATCH from the list", true],
      [{ move: 1 }, "MEGA PUNCH from the list", true],
      [null, "Back", false],
      [{ fight: 1 }, "MEGA PUNCH from the battle menu", true],
      [{ move: 3 }, "LEER from the list", false],
      [{ fight: 0 }, "SCRATCH after a turn", true],
    ];
    for (const [a, what, noPp] of steps) {
      const shown = answer(a);
      expect({ what, leaks: shown.leaks }).toEqual({ what, leaks: [] });
      expect(shown.hd.join(" | ")).not.toMatch(/TYPE\/|FIGHT/);
      if (noPp) expect({ what, hd: shown.hd }).toEqual({ what, hd: expect.arrayContaining(["No PP left for / this move!"]) as string[] });
    }
    expect(asked()).toMatchObject({ ask: { kind: "moves" } });
    const used = answer({ move: 3 }, (hd) => !!hd?.includes("LEER"));
    expect(used.leaks).toEqual([]);
  });
});
