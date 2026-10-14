// ROM test for the Poké Mart through the menu's shop sheet (QA bug 25): the game's own
// DisplayPokemartDialogue_ runs with the Pewter Mart's stock, the page answers its questions as
// Game.tsx does (LiveActions first, a sheet for the rest) and shows its messages, but a message
// under the shop's sheet can't be seen or tapped. Four quick taps on a Potion buy four, and
// closing the sheet takes the game back to BUY / SELL / QUIT, where QUIT ends the shop. The
// quantity picker (QA #70) buys ten POKé BALLs in one go and sells them back in two lots, its
// number answering the game's own "How many?" and "OK?". Skips without the dev ROM.
import { existsSync, readFileSync } from "node:fs";
import { Controls, GameAsks, GameBoy, SafePoint, type AskAnswer, type GameAsk } from "@pokehd/emu";
import { messageBoxes, SYMBOLS } from "@pokehd/rom";
import { describe, expect, it } from "vitest";
import { playIntro } from "../../../../../packages/emu/src/testing.ts";
import { itemPrice } from "./items.ts";
import { LiveActions, type LiveHost } from "./live.ts";
import { buyMax, sellTotal } from "./quantity.ts";

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
const SELL = 1;
const QUIT = 2;

const bcd = (n: number) => [Math.floor(n / 10000) % 100, Math.floor(n / 100) % 100, n % 100].map((v) => ((v / 10) << 4) | v % 10);
const fromBcd = (b: Uint8Array) => [...b].reduce((n, v) => n * 100 + (v >> 4) * 10 + (v & 15), 0);

/**
 * The Pewter Mart's clerk with ₽2793 and an empty bag: the game's shop running, the page's
 * messages, sheet and taps on BUY / SELL / QUIT (`choose`) as Game.tsx has them.
 */
async function martSession() {
  const rom = new Uint8Array(readFileSync(ROM_PATH));
  const gb = await GameBoy.create({ rom, wasmBinary: new Uint8Array(readFileSync(WASM_PATH)) });
  playIntro(gb);
  bcd(2793).forEach((v, i) => gb.write(SYMBOLS.wPlayerMoney.address + i, v));
  gb.write(SYMBOLS.wNumBagItems.address, 0);
  gb.write(SYMBOLS.wNumBagItems.address + 1, 0xff);

  // The page: messages show in the HD box unless the sheet covers it; the player reads the ones
  // they can see. Game.tsx's onScriptMessage and onAsk, with the player's taps.
  const s = {
    sheet: null as { id: number; ask: GameAsk } | null,
    notices: [] as string[],
    /** Every question the game asked, answered by the sheet or by LiveActions. */
    asked: [] as GameAsk[],
    /** The game's own BUY / SELL / QUIT menu: the player taps this when it next opens. */
    choose: null as number | null,
    shopDone: false,
  };
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
        if (heard === "away") s.sheet = null;
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
      notice: (text) => s.notices.push(text),
      setApp: () => {},
      game: null,
    },
  };
  const actions = new LiveActions(rom, host);
  const asks = new GameAsks(gb, {
    rom,
    busy: () => false,
    onAsk: (id, ask) => {
      s.asked.push(ask);
      if (!actions.asked(id, ask)) s.sheet = { id, ask };
    },
  });
  let tapAt: { item: number; at: number } | null = null;
  gb.addHook("HandleMenuInput", () => {
    if (s.choose !== null) tapAt = { item: s.choose, at: frame + 20 };
    s.choose = null;
  });
  const run = (n: number, until?: () => boolean) => {
    for (let i = 0; i < n && !until?.(); i++, frame++) {
      // Only a message the sheet doesn't cover can be read.
      if (toRead && !s.sheet && frame >= toRead.at) {
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
  [PEWTER_STOCK.length, ...PEWTER_STOCK, 0xff].forEach((v, i) => gb.write(W_ITEM_LIST + i, v));
  const shop = SYMBOLS.DisplayPokemartDialogue_;
  SafePoint.of(gb).enqueue({
    scratch: [],
    steps: [
      {
        routine: "Bankswitch",
        before: (g) => {
          g.write(SYMBOLS.wListMenuID.address, PRICEDITEMLISTMENU);
          s.choose = BUY;
        },
        registers: () => ({ bc: shop.bank << 8, hl: shop.address }),
      },
    ],
    done: () => (s.shopDone = true),
  });
  const money = () => fromBcd(gb.readBytes(SYMBOLS.wPlayerMoney.address, 3));
  const bag = () => Array.from({ length: gb.read(SYMBOLS.wNumBagItems.address) }, (_, i) => ({ item: gb.read(SYMBOLS.wNumBagItems.address + 1 + i * 2), quantity: gb.read(SYMBOLS.wNumBagItems.address + 2 + i * 2) }));
  const held = (item: number) => bag().find((b) => b.item === item)?.quantity ?? 0;
  return { rom, s, actions, run, money, bag, held };
}

describe.skipIf(!existsSync(ROM_PATH))("the Poké Mart through the shop sheet (ROM)", () => {
  it("buys on every tap, even while the game says its thanks, and closes when asked (QA bug 25)", { timeout: 120_000 }, async () => {
    const { s, actions, run, money, held } = await martSession();
    run(3000, () => s.sheet?.ask.kind === "mart");
    expect(s.sheet?.ask).toEqual({ kind: "mart", entries: PEWTER_STOCK });

    // One tap, and three more in quick succession while the game is still on the first.
    actions.buy(POTION, 1);
    for (let t = 0; t < 3; t++) {
      run(20);
      actions.buy(POTION, 1);
    }
    run(3000, () => held(POTION) === 4 && actions.isAsking(s.sheet?.id ?? -1));
    expect(held(POTION)).toBe(4);
    expect(money()).toBe(2793 - 4 * 300);
    expect(s.notices).toEqual(Array(4).fill("Here you are! Thank you!"));
    expect(s.sheet?.ask.kind).toBe("mart");

    // One more, and the sheet's ✕ while the game still thanks the player for it: the purchase
    // goes through, then the game leaves its list for BUY / SELL / QUIT, and the sheet goes.
    s.choose = QUIT;
    actions.buy(POTION, 1);
    run(20);
    actions.cancel();
    run(3000, () => s.shopDone);
    expect(held(POTION)).toBe(5);
    expect(money()).toBe(2793 - 5 * 300);
    expect(s.sheet).toBeNull();
    expect(s.shopDone).toBe(true);
  });

  it("buys ten in one go and sells a stack back, through the game's own questions (QA #70)", { timeout: 120_000 }, async () => {
    const { rom, s, actions, run, money, bag, held } = await martSession();
    run(3000, () => s.sheet?.ask.kind === "mart");
    const price = itemPrice(rom, POKE_BALL);
    expect(price).toBe(200);
    // The picker offers what ₽2793 pays for; the game's own menu would go to 99 and then refuse.
    expect(buyMax(money(), price, bag(), POKE_BALL)).toBe(13);

    s.asked.length = 0;
    actions.buy(POKE_BALL, 10);
    run(3000, () => held(POKE_BALL) === 10 && actions.isAsking(s.sheet?.id ?? -1));
    expect(held(POKE_BALL)).toBe(10);
    expect(money()).toBe(2793 - 10 * 200);
    expect(s.notices).toEqual(["Here you are! Thank you!"]);
    // The game asked how many (its 1 to 99, at its price) and "OK?", and the picker's ten answered.
    expect(s.asked.slice(0, 2)).toEqual([
      { kind: "quantity", max: 99, price: 200 },
      expect.objectContaining({ kind: "yes-no", text: "POKé BALL?\nThat will be\n₽2000. OK?" }),
    ]);

    // Out of the list, to SELL: "What would you like to sell?" and the bag.
    s.choose = SELL;
    actions.cancel();
    run(3000, () => s.sheet?.ask.kind === "items");
    expect(s.sheet?.ask).toMatchObject({ kind: "items", list: "bag", selling: true, entries: [{ item: POKE_BALL, quantity: 10 }] });

    // Seven of them: the game asks how many of its ten, at half price, and pays half the whole.
    s.asked.length = 0;
    const before = money();
    actions.sell(POKE_BALL, 7);
    run(3000, () => held(POKE_BALL) === 3 && actions.isAsking(s.sheet?.id ?? -1));
    expect(s.asked.slice(0, 2)).toEqual([{ kind: "quantity", max: 10, price: 100 }, expect.objectContaining({ kind: "yes-no" })]);
    expect(money()).toBe(before + sellTotal(price, 7));

    // The rest of the stack: it leaves the bag.
    actions.sell(POKE_BALL, 3);
    run(3000, () => bag().length === 0 && actions.isAsking(s.sheet?.id ?? -1));
    expect(bag()).toEqual([]);
    expect(money()).toBe(before + sellTotal(price, 10));
    expect(money()).toBe(2793 - 1000);

    s.choose = QUIT;
    actions.cancel();
    run(3000, () => s.shopDone);
    expect(s.shopDone).toBe(true);
  });
});
