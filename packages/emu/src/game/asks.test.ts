// ROM test for the game's questions answered by the page: the bag and party menus in a battle,
// and the list and quantity a Poké Mart sale asks for. Skips without the dev ROM.
import { existsSync, readFileSync } from "node:fs";
import { SYMBOLS, type Message, type SymbolName } from "@pokehd/rom";
import { beforeAll, describe, expect, it } from "vitest";
import { Button, GameBoy } from "../core.ts";
import { CARRY } from "../ffi.ts";
import { fromBcd } from "../gifts/gifts.ts";
import { SafePoint } from "../gifts/safepoint.ts";
import { playIntro, setBag, setParty } from "../testing.ts";
import { askedText, GameAsks, twoOptions, type AskAnswer, type GameAsk } from "./asks.ts";

const ROM_PATH = new URL("../../../../rom/pokeblue.gb", import.meta.url);
const WASM_PATH = new URL("../generated/sameboy.wasm", import.meta.url);

const PIKACHU = 0x54;
const SQUIRTLE = 0xb1;
const RATTATA = 0xa5;
const POTION = 0x14;
const ANTIDOTE = 0x0b;
const PARTYMON = 44;
const ITEMLISTMENU = 3;
const PRICEDITEMLISTMENU = 2;
const HEAL_CANCEL_MENU = 6;
/** wStatusFlags4's BIT_USED_POKECENTER. */
const USED_POKECENTER = 1 << 2;

const addr = (name: SymbolName) => SYMBOLS[name].address;
const r = (gb: GameBoy, name: SymbolName, offset = 0) => gb.read(addr(name) + offset);
const hp = (gb: GameBoy, slot: number) => (r(gb, "wPartyMons", slot * PARTYMON + 1) << 8) | r(gb, "wPartyMons", slot * PARTYMON + 2);
const frames = (gb: GameBoy, n: number) => {
  for (let i = 0; i < n; i++) gb.runFrame();
};

describe("askedText", () => {
  const welcome: Message = {
    pages: [
      { lines: ["Welcome to our", "POKéMON CENTER!"], wait: "arrow", next: "page" },
      { lines: ["We heal your", "POKéMON back to"], wait: "arrow", next: "scroll" },
      { lines: ["POKéMON back to", "perfect health!"], wait: "arrow", next: "end" },
    ],
    ending: "prompt",
  };

  it("gives the whole last box of the message the screen still ends with", () => {
    expect(askedText(["POKéMON back to", "perfect health!"], welcome)).toBe("We heal your\nPOKéMON back to\nperfect health!");
  });

  it("falls back to the screen when the last message isn't what it shows", () => {
    expect(askedText(["Is that OK?"], welcome)).toBe("Is that OK?");
    expect(askedText(["Is that OK?"], null)).toBe("Is that OK?");
    expect(askedText([], welcome)).toBe("");
  });
});

describe.skipIf(!existsSync(ROM_PATH))("the game's questions (ROM)", () => {
  let rom: Uint8Array;
  let start: Uint8Array;
  beforeAll(async () => {
    rom = new Uint8Array(readFileSync(ROM_PATH));
    const gb = await GameBoy.create({ rom, wasmBinary: new Uint8Array(readFileSync(WASM_PATH)) });
    playIntro(gb);
    start = gb.saveState();
  }, 120_000);

  async function game(answers: (ask: GameAsk) => AskAnswer) {
    const gb = await GameBoy.create({ rom, wasmBinary: new Uint8Array(readFileSync(WASM_PATH)) });
    gb.loadState(start);
    setParty(gb, rom, [{ species: SQUIRTLE, level: 12 }, { species: PIKACHU, level: 10 }]);
    setBag(gb, [[ANTIDOTE, 1], [POTION, 3]]);
    const asked: GameAsk[] = [];
    let pending: number | null = null;
    const asks = new GameAsks(gb, { rom, busy: () => false, onAsk: (id, ask) => {
      asked.push(ask);
      pending = id;
    } });
    /** Runs frames, answering each question after a short pause, as a player would. */
    const play = (n: number, until?: () => boolean) => {
      for (let i = 0; i < n && !until?.(); i++) {
        gb.runFrame();
        if (pending !== null && asks.asking) {
          const id = pending;
          pending = null;
          frames(gb, 5);
          asks.answer(id, answers(asks.asking.ask));
        }
      }
    };
    return { gb, asks, asked, play };
  }

  it("answers the bag and the party menu in a wild battle: the Potion heals and the turn goes", async () => {
    const { gb, asked, play } = await game((ask) => (ask.kind === "items" ? { index: 1 } : ask.kind === "party" ? { index: 1 } : null));
    const base = addr("wPartyMons") + PARTYMON;
    gb.write(base + 1, 0);
    gb.write(base + 2, 4);
    // A wild Rattata, the way a script starts a battle: wCurOpponent at the idle point.
    gb.write(addr("wCurOpponent"), RATTATA);
    gb.write(addr("wCurEnemyLevel"), 2);
    let menus = 0;
    const remove = gb.addHook({ bank: 0x0f, address: 0x4eb3 }, () => menus++);
    for (let i = 0; i < 3000 && menus === 0; i++) {
      // Through "Wild RATTATA appeared!" and "Go! SQUIRTLE!".
      gb.setButtons(i % 16 < 2 ? Button.A : 0);
      gb.runFrame();
    }
    gb.setButtons(0);
    expect(menus, "battle menu").toBeGreaterThan(0);
    // The player picks ITEM on the game's battle menu (the HD battle menu's tap does the same).
    frames(gb, 30);
    gb.setButtons(Button.Down);
    frames(gb, 3);
    gb.setButtons(0);
    frames(gb, 10);
    gb.setButtons(Button.A);
    frames(gb, 3);
    gb.setButtons(0);
    play(2000, () => hp(gb, 1) > 4 && menus > 1);
    remove();
    expect(asked.map((a) => a.kind)).toEqual(["items", "party"]);
    expect(asked[0]).toMatchObject({ kind: "items", list: "bag", inBattle: true, entries: [{ item: ANTIDOTE, quantity: 1 }, { item: POTION, quantity: 3 }] });
    expect(asked[1]).toMatchObject({ kind: "party", purpose: "item", inBattle: true });
    expect(hp(gb, 1)).toBe(24);
    expect(r(gb, "wNumBagItems", 4)).toBe(2);
  }, 30_000);

  it("switches in battle: the party answer, then SWITCH on the game's small menu", async () => {
    const { gb, asked, play } = await game((ask) => (ask.kind === "party" ? { index: 1 } : null));
    gb.write(addr("wCurOpponent"), RATTATA);
    gb.write(addr("wCurEnemyLevel"), 2);
    let menus = 0;
    const remove = gb.addHook({ bank: 0x0f, address: 0x4eb3 }, () => menus++);
    for (let i = 0; i < 3000 && menus === 0; i++) {
      gb.setButtons(i % 16 < 2 ? Button.A : 0);
      gb.runFrame();
    }
    gb.setButtons(0);
    expect(menus, "battle menu").toBeGreaterThan(0);
    // PKMN, to the right of FIGHT on the game's battle menu.
    frames(gb, 30);
    gb.setButtons(Button.Right);
    frames(gb, 3);
    gb.setButtons(0);
    frames(gb, 10);
    gb.setButtons(Button.A);
    frames(gb, 3);
    gb.setButtons(0);
    play(2500, () => r(gb, "wBattleMonSpecies") === PIKACHU && menus > 1);
    remove();
    expect(asked.map((a) => a.kind)).toEqual(["party"]);
    expect(asked[0]).toMatchObject({ purpose: "switch", inBattle: true });
    expect(r(gb, "wBattleMonSpecies")).toBe(PIKACHU);
    expect(r(gb, "wPlayerMonNumber")).toBe(1);
  }, 30_000);

  it("answers a sale's list and quantity with the game's own price", async () => {
    const { gb, play } = await game((ask) => (ask.kind === "items" ? { index: 1 } : ask.kind === "quantity" ? { quantity: 2 } : null));
    const out: { list?: number; quantity?: number; item?: number; price?: number; max?: number; money?: number; chosen?: number } = {};
    // The Poké Mart's sell path, as its own code calls them: the bag list, then the quantity.
    SafePoint.of(gb).enqueue({
      scratch: [],
      steps: [
        {
          routine: "DisplayListMenuID",
          before: (g) => {
            g.write(addr("wListMenuID"), ITEMLISTMENU);
            g.write(addr("wListPointer"), addr("wNumBagItems") & 0xff);
            g.write(addr("wListPointer") + 1, addr("wNumBagItems") >> 8);
            g.write(addr("hHalveItemPrices"), 1);
            // As the Poké Mart sets it: prices from the ROM's own table.
            g.write(addr("wItemPrices"), SYMBOLS.ItemPrices.address & 0xff);
            g.write(addr("wItemPrices") + 1, SYMBOLS.ItemPrices.address >> 8);
          },
          after: (g, regs) => {
            out.list = regs.af & CARRY;
            out.item = r(g, "wCurItem");
            out.chosen = r(g, "wWhichPokemon");
            out.max = r(g, "wMaxItemQuantity");
            out.price = fromBcd(g.readBytes(addr("hItemPrice"), 3));
          },
        },
        {
          routine: "DisplayChooseQuantityMenu",
          before: (g) => g.write(addr("wListMenuID"), PRICEDITEMLISTMENU),
          after: (g, regs) => {
            out.quantity = regs.af >> 8 === 0 ? r(g, "wItemQuantity") : -1;
            out.money = fromBcd(g.readBytes(addr("hMoney"), 3));
          },
        },
      ],
    });
    play(600, () => out.money !== undefined);
    expect(out).toEqual({ list: 0, item: POTION, chosen: 1, max: 3, price: 300, quantity: 2, money: 300 });
  });

  it("reads the two-option menus' own words from the ROM", () => {
    expect(twoOptions(rom, 0)).toEqual(["YES", "NO"]);
    expect(twoOptions(rom, HEAL_CANCEL_MENU)).toEqual(["HEAL", "CANCEL"]);
    expect(twoOptions(rom, 7)).toEqual(["NO", "YES"]);
  });

  // QA bug 13: on a later visit the nurse skips "Shall we heal your POKéMON?", so the screen's
  // two lines are only the end of her welcome ("POKéMON back to / perfect health!").
  it.each([
    { visited: false, text: "Shall we heal your\nPOKéMON?" },
    { visited: true, text: "We heal your\nPOKéMON back to\nperfect health!" },
  ])("asks the nurse's whole question (visited before: $visited)", async ({ visited, text }) => {
    const { gb, asked, play } = await game(() => ({ yes: false }));
    const flags = r(gb, "wStatusFlags4");
    gb.write(addr("wStatusFlags4"), visited ? flags | USED_POKECENTER : flags & ~USED_POKECENTER);
    let done = false;
    const center = SYMBOLS.DisplayPokemonCenterDialogue_;
    SafePoint.of(gb).enqueue({
      scratch: [],
      steps: [{ routine: "Bankswitch", registers: () => ({ bc: center.bank << 8, hl: center.address }), after: () => void (done = true) }],
    });
    // A through the game's own text waits (nobody shows the messages here).
    for (let i = 0; i < 3000 && !done; i++) {
      gb.setButtons(i % 16 < 2 ? Button.A : 0);
      play(1);
    }
    gb.setButtons(0);
    expect(done).toBe(true);
    expect(asked).toEqual([{ kind: "yes-no", text, yes: "HEAL", no: "CANCEL" }]);
    // CANCEL: nothing healed, and the menu's ID is back to YES/NO as the game leaves it.
    expect(r(gb, "wCurrentMenuItem")).toBe(1);
    expect(r(gb, "wTwoOptionMenuID")).toBe(0);
  }, 30_000);

  it("cancels a list with carry, as B does", async () => {
    const { gb, play } = await game(() => null);
    let carry: number | undefined;
    SafePoint.of(gb).enqueue({
      scratch: [],
      steps: [
        {
          routine: "DisplayListMenuID",
          before: (g) => {
            g.write(addr("wListMenuID"), ITEMLISTMENU);
            g.write(addr("wListPointer"), addr("wNumBagItems") & 0xff);
            g.write(addr("wListPointer") + 1, addr("wNumBagItems") >> 8);
          },
          after: (_g, regs) => void (carry = regs.af & CARRY),
        },
      ],
    });
    play(300, () => carry !== undefined);
    expect(carry).toBe(CARRY);
  });
});
