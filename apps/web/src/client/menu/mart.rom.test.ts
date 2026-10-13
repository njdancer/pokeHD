// ROM test for the Poké Mart through the menu's shop sheet (QA bug 25): the game's own
// DisplayPokemartDialogue_ runs with the Pewter Mart's stock, the page answers its questions as
// Game.tsx does (LiveActions first, a sheet for the rest) and shows its messages, but a message
// under the shop's sheet can't be seen or tapped. Four quick taps on a Potion buy four, and
// closing the sheet takes the game back to BUY / SELL / QUIT, where QUIT ends the shop.
// Skips without the dev ROM.
import { existsSync, readFileSync } from "node:fs";
import { Controls, GameAsks, GameBoy, SafePoint, type AskAnswer, type GameAsk } from "@pokehd/emu";
import { messageBoxes, SYMBOLS } from "@pokehd/rom";
import { describe, expect, it } from "vitest";
import { playIntro } from "../../../../../packages/emu/src/testing.ts";
import { LiveActions, type LiveHost } from "./live.ts";

const ROM_PATH = new URL("../../../../../rom/pokeblue.gb", import.meta.url);
const WASM_PATH = new URL("../../../../../packages/emu/src/generated/sameboy.wasm", import.meta.url);

const POKE_BALL = 0x04;
const POTION = 0x14;
const ESCAPE_ROPE = 0x1d;
const ANTIDOTE = 0x0b;
const BURN_HEAL = 0x0c;
const AWAKENING = 0x0d;
const PARLYZ_HEAL = 0x0e;
const PEWTER_STOCK = [POKE_BALL, POTION, ESCAPE_ROPE, ANTIDOTE, BURN_HEAL, AWAKENING, PARLYZ_HEAL];
const PRICEDITEMLISTMENU = 2;
// WRAM the generated symbols leave out (pokeblue.sym).
const W_ITEM_LIST = 0xcf7b;
const BUY = 0;
const QUIT = 2;

const bcd = (n: number) => [Math.floor(n / 10000) % 100, Math.floor(n / 100) % 100, n % 100].map((v) => ((v / 10) << 4) | v % 10);
const fromBcd = (b: Uint8Array) => [...b].reduce((n, v) => n * 100 + (v >> 4) * 10 + (v & 15), 0);

describe.skipIf(!existsSync(ROM_PATH))("the Poké Mart through the shop sheet (ROM)", () => {
  it("buys on every tap, even while the game says its thanks, and closes when asked (QA bug 25)", { timeout: 120_000 }, async () => {
    const rom = new Uint8Array(readFileSync(ROM_PATH));
    const gb = await GameBoy.create({ rom, wasmBinary: new Uint8Array(readFileSync(WASM_PATH)) });
    playIntro(gb);
    bcd(2793).forEach((v, i) => gb.write(SYMBOLS.wPlayerMoney.address + i, v));
    gb.write(SYMBOLS.wNumBagItems.address, 0);
    gb.write(SYMBOLS.wNumBagItems.address + 1, 0xff);

    // The page: messages show in the HD box unless the sheet covers it; the player reads the ones
    // they can see. Game.tsx's onScriptMessage and onAsk, with the player's taps.
    let sheet = null as { id: number; ask: GameAsk } | null;
    const notices: string[] = [];
    let toRead: { id: number; at: number } | null = null;
    let frame = 0;
    const controls: Controls = new Controls(gb, {
      setButtons: (m) => gb.setButtons(m),
      script: {
        message: ({ id, message }) => {
          const heard = actions.heard(message);
          if (heard === "reply") {
            controls.readOn(id);
            controls.closeMessage(id);
            return;
          }
          if (heard === "away") sheet = null;
          // All of it fits in one HD box: the game prints the rest while the player reads.
          if (messageBoxes(message).length <= 1) controls.readOn(id);
          toRead = { id, at: frame + 10 };
        },
        end: () => {},
        press: () => {},
      },
    });
    controls.setScriptText(rom);
    const host: { current: LiveHost } = {
      current: {
        act: () => Promise.reject(new Error("no actions here")),
        answer: (id: number, answer: AskAnswer) => asks.answer(id, answer),
        notice: (text) => notices.push(text),
        setApp: () => {},
        game: null,
      },
    };
    const actions = new LiveActions(rom, host);
    const asks = new GameAsks(gb, {
      rom,
      busy: () => false,
      onAsk: (id, ask) => {
        if (!actions.asked(id, ask)) sheet = { id, ask };
      },
    });
    // The game's own BUY / SELL / QUIT menu: the player taps `choose` when it next opens.
    let choose: number | null = null;
    let tapAt: { item: number; at: number } | null = null;
    gb.addHook("HandleMenuInput", () => {
      if (choose !== null) tapAt = { item: choose, at: frame + 20 };
      choose = null;
    });
    const run = (n: number, until?: () => boolean) => {
      for (let i = 0; i < n && !until?.(); i++, frame++) {
        // Only a message the sheet doesn't cover can be read.
        if (toRead && !sheet && frame >= toRead.at) {
          controls.readOn(toRead.id);
          controls.closeMessage(toRead.id);
          toRead = null;
        }
        if (tapAt && frame >= tapAt.at) {
          controls.select(tapAt.item, true);
          tapAt = null;
        }
        controls.frame();
        gb.runFrame();
      }
    };

    // The clerk's shop, as the text script calls it: the stock in wItemList, then the dialogue.
    let shopDone = false;
    [PEWTER_STOCK.length, ...PEWTER_STOCK, 0xff].forEach((v, i) => gb.write(W_ITEM_LIST + i, v));
    const shop = SYMBOLS.DisplayPokemartDialogue_;
    SafePoint.of(gb).enqueue({
      scratch: [],
      steps: [
        {
          routine: "Bankswitch",
          before: (g) => {
            g.write(SYMBOLS.wListMenuID.address, PRICEDITEMLISTMENU);
            choose = BUY;
          },
          registers: () => ({ bc: shop.bank << 8, hl: shop.address }),
        },
      ],
      done: () => (shopDone = true),
    });
    run(3000, () => sheet?.ask.kind === "mart");
    expect(sheet?.ask).toEqual({ kind: "mart", entries: PEWTER_STOCK });
    const money = () => fromBcd(gb.readBytes(SYMBOLS.wPlayerMoney.address, 3));
    const potions = () => (gb.read(SYMBOLS.wNumBagItems.address) > 0 && gb.read(SYMBOLS.wNumBagItems.address + 1) === POTION ? gb.read(SYMBOLS.wNumBagItems.address + 2) : 0);

    // One tap, and three more in quick succession while the game is still on the first.
    actions.buy(POTION, 1);
    for (let t = 0; t < 3; t++) {
      run(20);
      actions.buy(POTION, 1);
    }
    run(3000, () => potions() === 4 && actions.isAsking(sheet?.id ?? -1));
    expect(potions()).toBe(4);
    expect(money()).toBe(2793 - 4 * 300);
    expect(notices).toEqual(Array(4).fill("Here you are! Thank you!"));
    expect(sheet?.ask.kind).toBe("mart");

    // One more, and the sheet's ✕ while the game still thanks the player for it: the purchase
    // goes through, then the game leaves its list for BUY / SELL / QUIT, and the sheet goes.
    choose = QUIT;
    actions.buy(POTION, 1);
    run(20);
    actions.cancel();
    run(3000, () => shopDone);
    expect(potions()).toBe(5);
    expect(money()).toBe(2793 - 5 * 300);
    expect(sheet).toBeNull();
    expect(shopDone).toBe(true);
  });
});
