// The game's own questions, answered by the page (the Pokédex menu's sheets). Where the game
// would draw a list to choose from (the bag in battle, the Poké Mart, Bill's PC), the party menu
// or a quantity, it waits at that routine instead (ffi.ts StandIn) and the page is asked; the
// page's answer becomes the routine's outputs, exactly what its callers read after the player
// chose on the Game Boy, and the game carries on from there with its own rules. Questions the
// page doesn't know how to ask are left to the game's own menus.
//
// | routine | outputs written |
// |---|---|
// | `DisplayPartyMenu`, `GoBackToPartyMenu` | wWhichPokemon, wCurPartySpecies, carry for "cancelled" |
// | `DisplayListMenuID` (item, priced item and PC Pokémon lists) | wWhichPokemon, wCurItem or wCurPartySpecies, the name, wMaxItemQuantity, then `GetItemPrice` |
// | `DisplayChooseQuantityMenu` | wItemQuantity, hMoney (the total, halved when selling), a = $ff for "cancelled" |
// | `DisplayTextBoxID` with a yes/no | wCurrentMenuItem, wMenuExitMethod |
// | `HandleMenuInput`, straight after a battle switch or a PC Pokémon list | A on the first item (SWITCH, DEPOSIT, WITHDRAW) |
//
// The page has already said what it wants done with the Pokémon it chose, so the little menu
// the game puts up next (SWITCH / STATS / CANCEL, DEPOSIT / STATS / CANCEL) gets its first item.
import { decodeText, encodeText, itemName, SYMBOLS, type SymbolName } from "@pokehd/rom";
import type { GameBoy } from "../core.ts";
import { readWord, StandIn, type Answer } from "../ffi.ts";
import { fromBcd, toBcd } from "../gifts/gifts.ts";

const addr = (name: SymbolName) => SYMBOLS[name].address;

const PCPOKEMONLISTMENU = 0;
const PRICEDITEMLISTMENU = 2;
const ITEMLISTMENU = 3;
const CHOSE_MENU_ITEM = 1;
const CANCELLED_MENU = 2;
const CHOSE_FIRST_ITEM = 1;
const CHOSE_SECOND_ITEM = 2;
const TWO_OPTION_MENU = 0x14;
const NORMAL_PARTY_MENU = 0;
const USE_ITEM_PARTY_MENU = 1;
const BATTLE_PARTY_MENU = 2;
const NAME_LENGTH = 11;
const NAME_BUFFER_LENGTH = 20;
const PAD_A = 0x01;

/** What the game asks the player, for the page's sheet. */
export type GameAsk =
  /**
   * Choose a Pokémon from the team. `purpose`: switching in battle, the target of an item, the
   * next one after a faint (which can't be cancelled), or something else the game asked.
   */
  | { kind: "party"; purpose: "switch" | "item" | "next" | "other"; inBattle: boolean }
  /**
   * Choose from a list. `list`: the bag (or the PC's item box), the Poké Mart's stock, or a
   * list of Pokémon (Bill's PC: the team or the current box). `text` is what the game asked in
   * its message box ("What do you want to deposit?"), since the same list serves several asks.
   */
  | { kind: "items"; list: "bag" | "pc-items"; entries: { item: number; quantity: number }[]; inBattle: boolean; selling: boolean; text: string }
  | { kind: "mart"; entries: number[] }
  | { kind: "mons"; list: "team" | "box"; species: number[]; text: string }
  /** How many: up to `max`, at `price` each (already halved when selling), 0 if no price. */
  | { kind: "quantity"; max: number; price: number }
  /** Yes or no, with what the game just said. */
  | { kind: "yes-no"; text: string };

/** The page's answer: an index into the team or list, a quantity, yes/no, or null to cancel. */
export type AskAnswer = { index: number } | { quantity: number } | { yes: boolean } | null;

export interface GameAsksOptions {
  rom: Uint8Array;
  onAsk(id: number, ask: GameAsk): void;
  /** Our own calls are under way (GameActions): their questions are theirs to answer. */
  busy(): boolean;
}

/** The text box's two lines on the Game Boy screen. */
export function textBoxText(gb: GameBoy): string {
  const map = addr("wTileMap");
  return [14, 16]
    .map((row) => decodeText(gb.readBytes(map + row * 20 + 1, 18)).trim())
    .filter(Boolean)
    .join("\n");
}

export class GameAsks {
  readonly #options: GameAsksOptions;
  readonly #standIns: StandIn[];
  #ids = 0;
  #asked: { id: number; ask: GameAsk } | null = null;
  #answer: { id: number; answer: AskAnswer } | null = null;
  /** The page chose a Pokémon to switch in or move in the PC: the game's next small menu gets its first item. */
  #thenFirst = false;

  constructor(gb: GameBoy, options: GameAsksOptions) {
    this.#options = options;
    const free = () => !options.busy();
    const party = (g: GameBoy) => this.#ask(g, () => this.#partyAsk(g), (a) => this.#partyAnswer(g, a));
    // Any other menu the game opens first means the moment has passed.
    const thenFirst = () => {
      const take = this.#thenFirst;
      this.#thenFirst = false;
      return take;
    };
    this.#standIns = [
      new StandIn(gb, "DisplayPartyMenu", free, party),
      new StandIn(gb, "GoBackToPartyMenu", free, party),
      new StandIn(gb, "DisplayListMenuID", (g) => free() && this.#listAsk(g) !== null, (g) =>
        this.#ask(g, () => this.#listAsk(g)!, (a) => this.#listAnswer(g, a)),
      ),
      new StandIn(gb, "DisplayChooseQuantityMenu", free, (g) => this.#ask(g, () => this.#quantityAsk(g), (a) => this.#quantityAnswer(g, a))),
      new StandIn(gb, "DisplayTextBoxID", (g) => free() && g.read(addr("wTextBoxID")) === TWO_OPTION_MENU, (g) =>
        this.#ask(g, () => ({ kind: "yes-no", text: textBoxText(g) }), (a) => {
          const yes = a !== null && "yes" in a && a.yes;
          g.write(addr("wCurrentMenuItem"), yes ? 0 : 1);
          g.write(addr("wMenuExitMethod"), yes ? CHOSE_FIRST_ITEM : CHOSE_SECOND_ITEM);
          return {};
        }),
      ),
      new StandIn(gb, "HandleMenuInput", (g) => free() && thenFirst() && g.read(addr("wMaxMenuItem")) === 2, (g) => {
        g.write(addr("wCurrentMenuItem"), 0);
        return { registers: { af: (PAD_A << 8) | (g.registers.af & 0xff) } };
      }),
    ];
  }

  /** The question the game is waiting on, if any. */
  get asking(): { id: number; ask: GameAsk } | null {
    return this.#asked;
  }

  answer(id: number, answer: AskAnswer): void {
    if (this.#asked?.id === id) this.#answer = { id, answer };
  }

  dispose(): void {
    for (const s of this.#standIns) s.dispose();
  }

  /** Asks the page once, then waits until it answers. */
  #ask(_g: GameBoy, ask: () => GameAsk, apply: (answer: AskAnswer) => Answer): Answer | undefined {
    if (!this.#asked) {
      this.#asked = { id: ++this.#ids, ask: ask() };
      this.#answer = null;
      this.#options.onAsk(this.#asked.id, this.#asked.ask);
    }
    const answer = this.#answer;
    if (!answer || answer.id !== this.#asked.id) return undefined;
    this.#asked = null;
    this.#answer = null;
    return apply(answer.answer);
  }

  #partyAsk(g: GameBoy): GameAsk {
    const inBattle = g.read(addr("wIsInBattle")) !== 0;
    const type = g.read(addr("wPartyMenuTypeOrMessageID"));
    const fainted = inBattle && readWord(g, addr("wBattleMonHP")) === 0;
    // BATTLE_PARTY_MENU is a choice the battle needs (who's next after a faint, or the switch
    // offered when the foe's Pokémon faints); the player's own PKMN choice is a NORMAL one.
    const purpose =
      type === USE_ITEM_PARTY_MENU ? "item" : type === BATTLE_PARTY_MENU ? (fainted ? "next" : "switch") : inBattle && type === NORMAL_PARTY_MENU ? "switch" : "other";
    return { kind: "party", purpose, inBattle };
  }

  /** HandlePartyMenuInput's outputs. */
  #partyAnswer(g: GameBoy, a: AskAnswer): Answer {
    const slot = a && "index" in a ? a.index : -1;
    if (slot < 0 || slot >= g.read(addr("wPartyCount"))) return { carry: true };
    const species = g.read(addr("wPartySpecies") + slot);
    g.write(addr("wCurrentMenuItem"), slot);
    g.write(addr("wWhichPokemon"), slot);
    g.write(addr("wCurPartySpecies"), species);
    g.write(addr("wBattleMonSpecies2"), species);
    // A switch in battle: the game asks SWITCH / STATS / CANCEL next.
    this.#thenFirst = g.read(addr("wIsInBattle")) !== 0 && g.read(addr("wPartyMenuTypeOrMessageID")) === NORMAL_PARTY_MENU;
    return { carry: false };
  }

  /** The list the game would show, or null for one the page doesn't ask (left to the game). */
  #listAsk(g: GameBoy): GameAsk | null {
    const id = g.read(addr("wListMenuID"));
    const list = readWord(g, addr("wListPointer"));
    const count = g.read(list);
    const inBattle = g.read(addr("wIsInBattle")) !== 0;
    if (id === ITEMLISTMENU) {
      const entries = Array.from({ length: count }, (_, i) => ({ item: g.read(list + 1 + i * 2), quantity: g.read(list + 2 + i * 2) }));
      const where = list === addr("wNumBagItems") ? "bag" : list === addr("wNumBoxItems") ? "pc-items" : null;
      if (!where) return null;
      return { kind: "items", list: where, entries, inBattle, selling: g.read(addr("hHalveItemPrices")) !== 0, text: textBoxText(g) };
    }
    if (id === PRICEDITEMLISTMENU) return { kind: "mart", entries: [...g.readBytes(list + 1, count)] };
    if (id === PCPOKEMONLISTMENU) {
      const where = list === addr("wPartyCount") ? "team" : list === addr("wBoxCount") ? "box" : null;
      if (!where) return null;
      return { kind: "mons", list: where, species: [...g.readBytes(list + 1, count)], text: textBoxText(g) };
    }
    return null;
  }

  /** DisplayListMenuID's outputs once the player has chosen (or ExitListMenu's). */
  #listAnswer(g: GameBoy, a: AskAnswer): Answer {
    const id = g.read(addr("wListMenuID"));
    const list = readWord(g, addr("wListPointer"));
    const count = g.read(list);
    const index = a && "index" in a ? a.index : -1;
    g.write(addr("wMenuItemToSwap"), 0);
    g.write(addr("hJoy7"), 0);
    if (index < 0 || index >= count) {
      g.write(addr("wChosenMenuItem"), g.read(addr("wCurrentMenuItem")));
      g.write(addr("wMenuExitMethod"), CANCELLED_MENU);
      return { carry: true };
    }
    // As if the cursor sat on the first visible row with the list scrolled to the choice.
    g.write(addr("wListScrollOffset"), index);
    g.write(addr("wCurrentMenuItem"), 0);
    g.write(addr("wChosenMenuItem"), 0);
    g.write(addr("wMenuExitMethod"), CHOSE_MENU_ITEM);
    g.write(addr("wWhichPokemon"), index);
    const entry = g.read(list + 1 + (id === ITEMLISTMENU ? index * 2 : index));
    let name: string;
    if (id === PCPOKEMONLISTMENU) {
      g.write(addr("wCurPartySpecies"), entry);
      // DEPOSIT (or WITHDRAW) / STATS / CANCEL comes next.
      this.#thenFirst = true;
      const nicks = list === addr("wPartyCount") ? addr("wPartyMonNicks") : addr("wBoxMonNicks");
      name = decodeText(g.readBytes(nicks + index * NAME_LENGTH, NAME_LENGTH));
    } else {
      g.write(addr("wCurItem"), entry);
      if (id === ITEMLISTMENU) g.write(addr("wMaxItemQuantity"), g.read(list + 2 + index * 2));
      name = itemName(this.#options.rom, entry);
    }
    const bytes = encodeText(name, NAME_BUFFER_LENGTH);
    for (const buffer of [addr("wNameBuffer"), addr("wStringBuffer")]) bytes.forEach((v, i) => g.write(buffer + i, v));
    // Items: the game's own GetItemPrice fills hItemPrice for the shop's sums, then returns.
    return id === PCPOKEMONLISTMENU ? { carry: false } : { carry: false, then: "GetItemPrice" };
  }

  #quantityAsk(g: GameBoy): GameAsk {
    const priced = g.read(addr("wListMenuID")) === PRICEDITEMLISTMENU;
    const unit = priced ? fromBcd(g.readBytes(addr("hItemPrice"), 3)) : 0;
    const halve = g.read(addr("hHalveItemPrices")) !== 0;
    return { kind: "quantity", max: g.read(addr("wMaxItemQuantity")), price: halve ? Math.floor(unit / 2) : unit };
  }

  #quantityAnswer(g: GameBoy, a: AskAnswer): Answer {
    g.write(addr("wMenuItemToSwap"), 0);
    const max = g.read(addr("wMaxItemQuantity"));
    const quantity = a && "quantity" in a ? a.quantity : 0;
    if (quantity < 1 || quantity > max) return { registers: { af: (0xff << 8) | (g.registers.af & 0xff) } };
    g.write(addr("wItemQuantity"), quantity);
    if (g.read(addr("wListMenuID")) === PRICEDITEMLISTMENU) {
      // The game's sum: the unit price times the quantity, halved when selling.
      const total = fromBcd(g.readBytes(addr("hItemPrice"), 3)) * quantity;
      const halve = g.read(addr("hHalveItemPrices")) !== 0;
      toBcd(halve ? Math.floor(total / 2) : total, 3).forEach((v, i) => g.write(addr("hMoney") + i, v));
    }
    return { registers: { af: g.registers.af & 0xff } };
  }
}
