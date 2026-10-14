// ROM test for a move with no PP chosen from the HD battle menu (QA bug 46). The game says "No PP
// left for this move!" and puts its move list up again, as on the Game Boy. Between the tap and
// the next question none of the Game Boy's menus may show over the HD battle (the move list it
// draws either side of asking, read as loose text with its corner drawn over, and the battle menu
// still in video memory while the game holds back the screen copy), and the HD message box shows
// the message alone, not the move's TYPE box above it. Skips without the ROM.
import { existsSync, readFileSync } from "node:fs";
import {
  BATTLE_WATCHES, BattleMenus, Button, GameBoy, OVERWORLD_WATCHES, ScreenTextDecoder, TEXT_WATCHES,
  type BattleAnswer, type BattleAsk, type TextWatched, type Watch,
} from "@pokehd/emu";
import { readGlyphs, SYMBOLS } from "@pokehd/rom";
import { describe, expect, it } from "vitest";
import { playIntro, setParty } from "../../../../../packages/emu/src/testing.ts";
import { BattleTracker, battleCovered, battleMenuShown, battleText, battleTextShown, maskBattleScreen } from "./battle.ts";
import { battleTextFits } from "./hd-text.ts";

const ROM_PATH = new URL("../../../../../rom/pokeblue.gb", import.meta.url);
const WASM_PATH = new URL("../../../../../packages/emu/src/generated/sameboy.wasm", import.meta.url);
const SQUIRTLE = 0xb1;
const RATTATA = 0xa5;
const TACKLE = 0x21;

describe.skipIf(!existsSync(ROM_PATH))("a move with no PP from the HD battle menu", () => {
  it("shows no Game Boy menu, and the message alone in HD (QA bug 46)", { timeout: 240_000 }, async () => {
    const rom = new Uint8Array(readFileSync(ROM_PATH));
    const gb = await GameBoy.create({ rom, wasmBinary: readFileSync(WASM_PATH) });
    playIntro(gb);
    // A wild Rattata against a Squirtle whose TACKLE (its first move) has no PP left.
    setParty(gb, rom, [{ species: SQUIRTLE, level: 12 }]);
    gb.write(SYMBOLS.wCurOpponent.address, RATTATA);
    gb.write(SYMBOLS.wCurEnemyLevel.address, 2);
    let asked: { id: number; ask: BattleAsk } | null = null;
    const menus = new BattleMenus(gb, { rom, onAsk: (id, ask) => (asked = { id, ask }) });
    let watches: Record<string, Watch> = {};
    const battles = new BattleTracker(rom, { ...OVERWORLD_WATCHES, ...TEXT_WATCHES, ...BATTLE_WATCHES }, (w) => (watches = w));
    const decoder = new ScreenTextDecoder(readGlyphs(rom));

    /** One frame as Game shows it: the Game Boy pixels left over the HD battle, and the HD text. */
    const step = (buttons = 0) => {
      gb.setButtons(buttons);
      gb.runFrame();
      const watched = Object.fromEntries(Object.entries(watches).map(([k, [a, n]]) => [k, gb.readBytes(a, n)]));
      const fight = battles.frame(watched);
      const screen = fight.scene === "scene" ? fight.screen : null;
      if (!screen) return { visible: 0, hd: null, dialog: null };
      const onScreen = decoder.decode(battleText(watched as unknown as TextWatched, screen));
      const text = battleTextShown(onScreen);
      const choosing = !!asked || battleMenuShown(onScreen);
      const fits = !choosing && battleTextFits(text);
      const data = new Uint8ClampedArray(gb.frame);
      maskBattleScreen(data, screen, battleCovered(onScreen, fits, choosing));
      let visible = 0;
      for (let i = 3; i < data.length; i += 4) if (data[i]) visible++;
      const hd = fits ? text.boxes.flatMap((b) => b.lines.map((l) => l.text)).join(" / ") : null;
      return { visible, hd, dialog: text.dialog };
    };

    let emptied = false;
    for (let i = 0; i < 4000 && !asked; i++) {
      step(i % 16 < 2 ? Button.A : 0);
      if (!emptied && gb.read(SYMBOLS.wBattleMonSpecies.address) === SQUIRTLE && gb.read(SYMBOLS.wBattleMonMoves.address) === TACKLE) {
        gb.write(SYMBOLS.wBattleMonPP.address, 0);
        emptied = true;
      }
    }
    expect(asked).toMatchObject({ ask: { kind: "menu", moves: [{ name: "TACKLE", pp: 0 }, { name: "TAIL WHIP" }] } });

    /**
     * Answers the question (the page drops its menu at once), then plays on, reading each message
     * with A, until `done`: what showed meanwhile.
     */
    const answer = (a: BattleAnswer, done: (hd: string | null) => boolean) => {
      const id = asked!.id;
      asked = null;
      menus.answer(id, a);
      const shown = { leaks: [] as number[], hd: [] as string[] };
      for (let f = 0, waiting = 0; ; f++) {
        if (f > 2000) throw new Error(`Stuck: ${shown.hd.join(" | ")}`);
        const s = step(waiting % 16 === 15 ? Button.A : 0);
        waiting = s.dialog?.state === "waiting" ? waiting + 1 : 0;
        if (s.visible) shown.leaks.push(f);
        if (s.hd && shown.hd.at(-1) !== s.hd) shown.hd.push(s.hd);
        if (done(s.hd)) return shown;
      }
    };

    // TACKLE, from the battle menu: "No PP left for this move!", then the move list on its own.
    const noPp = answer({ fight: 0 }, () => asked !== null);
    expect(noPp.leaks).toEqual([]);
    expect(noPp.hd).toContain("No PP left for / this move!");
    expect(noPp.hd.join(" | ")).not.toContain("TYPE/");
    expect(asked).toMatchObject({ ask: { kind: "moves", purpose: "fight", cancel: true } });
    expect(gb.read(SYMBOLS.wBattleMonPP.address) & 0x3f).toBe(0);

    // TAIL WHIP from that list: nothing of the list shows on the way to the turn's message.
    const used = answer({ move: 1 }, (hd) => !!hd?.includes("TAIL WHIP"));
    expect(used.leaks).toEqual([]);
  });
});
