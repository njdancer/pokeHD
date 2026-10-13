// The battle's own menus, answered by the page (p2-tapfirst): FIGHT / PKMN / ITEM / RUN (BALL /
// BAIT / THROW ROCK / RUN in the Safari Zone) and the move list. Both wait for the player in
// HandleMenuInput, called from DisplayBattleMenu (once per column) and from SelectMenuItem. A
// stand-in there (ffi.ts StandIn) asks the page instead and returns what HandleMenuInput would
// have: the keys pressed in a, wCurrentMenuItem and the cursor's place on screen. The game's own
// code goes on from there, with its rules: no items in a link battle, "No PP left for this move!",
// a disabled move, Struggle with nothing left, the party and bag menus (GameAsks), running away.
//
// | call site | answer |
// |---|---|
// | battle menu, left column (FIGHT, ITEM) | A on the choice, or RIGHT for one in the other column |
// | battle menu, right column (PKMN, RUN) | A on the choice, or LEFT |
// | move list (the turn's move, MIMIC's, an ETHER's or PP UP's in battle) | A on the move, or B |
//
// The page can choose a move straight from the battle menu (`{ fight: n }`): the menu gets FIGHT
// and the move list that follows gets the move, without asking again. A move list the game shows
// without that choice (after "No PP left!") is asked as its own question.
import { moveName, romOffset, SYMBOLS, type SymbolName } from "@pokehd/rom";
import type { GameBoy } from "../core.ts";
import { readWord, StandIn, type Answer } from "../ffi.ts";

const addr = (name: SymbolName) => SYMBOLS[name].address;

const PAD_A = 0x01;
const PAD_B = 0x02;
const PAD_RIGHT = 0x10;
const PAD_LEFT = 0x20;
const BATTLE_TYPE_SAFARI = 2;
const LINK_STATE_BATTLING = 4;
/** hUILayoutFlags' BIT_DOUBLE_SPACED_MENU: menu items on every row rather than every other. */
const EVERY_ROW = 1 << 1;
/** wPlayerBattleStatus3's TRANSFORMED: the moves are copies, each with 5 PP. */
const TRANSFORMED = 1 << 3;
const TRANSFORMED_PP = 5;
const PP_MASK = 0x3f;
const MOVE_DATA = 6;
const PARTYMON = 44;
const PARTYMON_MOVES = 8;
const PARTYMON_PP = 29;
const SCREEN_WIDTH = 20;
/** The battle menu's column whose HandleMenuInput this is. */
const LEFT = 0;
const RIGHT = 1;
const MOVE_LIST = 2;

/** One of the moves the list offers, as the game holds it. */
export interface MoveChoice {
  move: number;
  name: string;
  /** Type constant (constants/type_constants.asm). */
  type: number;
  /** Null where the game shows none (the foe's moves, for MIMIC). */
  pp: number | null;
  maxPp: number | null;
  /** DISABLE'd: the game won't let it be used. */
  disabled: boolean;
}

/** What the page shows in a battle, for the player's choice. */
export type BattleAsk =
  /**
   * The battle menu. `safari`: BALL / BAIT / THROW ROCK / RUN, with `balls` left; otherwise
   * FIGHT / PKMN / ITEM / RUN. `moves` are the Pokémon's, for choosing one straight away.
   */
  | { kind: "menu"; safari: boolean; balls: number; moves: MoveChoice[]; link: boolean }
  /**
   * The move list on its own. `purpose`: the turn's move (after the game turned one down), the
   * foe's move to copy (MIMIC, which can't be cancelled) or the move an ETHER or PP UP is for.
   */
  | { kind: "moves"; purpose: "fight" | "mimic" | "item"; moves: MoveChoice[]; cancel: boolean };

/** The menu's choices, by the game's names for them. */
export type BattleChoice = "fight" | "pkmn" | "item" | "run" | "ball" | "bait" | "rock";

/**
 * The page's answer: a battle menu choice, a move (the index in `moves`, from the battle menu or
 * the move list), or null to cancel the move list, as B would.
 */
export type BattleAnswer = { choice: BattleChoice } | { fight: number } | { move: number } | null;

/** The battle menu's items in the game's order: its left column, top then bottom, then its right. */
const MENU: Record<"normal" | "safari", BattleChoice[]> = {
  normal: ["fight", "item", "pkmn", "run"],
  safari: ["ball", "rock", "bait", "run"],
};

export interface BattleMenusOptions {
  rom: Uint8Array;
  onAsk(id: number, ask: BattleAsk): void;
}

export class BattleMenus {
  readonly #rom: Uint8Array;
  readonly #onAsk: (id: number, ask: BattleAsk) => void;
  readonly #standIn: StandIn;
  #ids = 0;
  #asked: { id: number; ask: BattleAsk } | null = null;
  #answer: { id: number; answer: BattleAnswer } | null = null;
  /** The battle menu item chosen, in the game's order, until the column it's in takes it. */
  #target: number | null = null;
  /** A move chosen from the battle menu, for the move list that follows FIGHT. */
  #move: number | null = null;

  constructor(gb: GameBoy, options: BattleMenusOptions) {
    this.#rom = options.rom;
    this.#onAsk = options.onAsk;
    this.#standIn = new StandIn(gb, "HandleMenuInput", (g) => this.#site(g) !== null, (g) => this.#stand(g));
  }

  /** The question the game is waiting on, if any. */
  get asking(): { id: number; ask: BattleAsk } | null {
    return this.#asked;
  }

  answer(id: number, answer: BattleAnswer): void {
    if (this.#asked?.id === id) this.#answer = { id, answer };
  }

  dispose(): void {
    this.#standIn.dispose();
  }

  /** Which of the battle's menus called HandleMenuInput, or null for any other menu. */
  #site(g: GameBoy): number | null {
    if (g.read(addr("wIsInBattle")) === 0) {
      this.#target = this.#move = null;
      return null;
    }
    // Link battles keep the Game Boy's menus: both games must read the same keys.
    if (g.read(addr("wLinkState")) === LINK_STATE_BATTLING) return null;
    if (g.read(addr("hLoadedROMBank")) !== SYMBOLS["DisplayBattleMenu.AButtonPressed"].bank) return null;
    const back = readWord(g, g.registers.sp);
    const within = (from: SymbolName, to: SymbolName) => back > addr(from) && back <= addr(to);
    if (within("DisplayBattleMenu.leftColumn_WaitForInput", "DisplayBattleMenu.rightColumn")) return LEFT;
    if (within("DisplayBattleMenu.rightColumn_WaitForInput", "DisplayBattleMenu.AButtonPressed")) return RIGHT;
    if (within("SelectMenuItem.select", "SelectMenuItem.notB")) return MOVE_LIST;
    return null;
  }

  #stand(g: GameBoy): Answer | undefined {
    const site = this.#site(g)!;
    if (site === MOVE_LIST) {
      const menuType = g.read(addr("wMoveMenuType"));
      if (menuType === 0 && this.#move !== null) {
        const move = this.#move;
        this.#move = null;
        return this.#pick(g, move + 1);
      }
      const answer = this.#ask(() => this.#movesAsk(g));
      if (answer === undefined) return undefined;
      const move = answer && "move" in answer ? answer.move : -1;
      const count = g.read(addr("wNumMovesMinusOne")) + 1;
      if (move >= 0 && move < count) return this.#pick(g, move + 1);
      // MIMIC's list doesn't watch B: it gets its first move rather than wait for ever.
      return menuType === 1 ? this.#pick(g, 1) : this.#keys(g, PAD_B);
    }
    if (this.#target === null) {
      const answer = this.#ask(() => this.#menuAsk(g));
      if (answer === undefined) return undefined;
      const safari = g.read(addr("wBattleType")) === BATTLE_TYPE_SAFARI;
      const choice = answer && "fight" in answer ? (safari ? null : "fight") : answer && "choice" in answer ? answer.choice : null;
      const index = choice ? MENU[safari ? "safari" : "normal"].indexOf(choice) : -1;
      // Nothing the menu offers (it can't be cancelled): ask again.
      if (index < 0) return undefined;
      this.#target = index;
      this.#move = answer && "fight" in answer ? answer.fight : null;
    }
    const column = this.#target >> 1;
    if (column !== site) return this.#keys(g, column === RIGHT ? PAD_RIGHT : PAD_LEFT);
    const item = this.#target & 1;
    this.#target = null;
    return this.#pick(g, item);
  }

  /** Asks the page once, then waits until it answers (undefined until then). */
  #ask(ask: () => BattleAsk): BattleAnswer | undefined {
    if (!this.#asked) {
      this.#asked = { id: ++this.#ids, ask: ask() };
      this.#answer = null;
      this.#onAsk(this.#asked.id, this.#asked.ask);
    }
    const answer = this.#answer;
    if (!answer || answer.id !== this.#asked.id) return undefined;
    this.#asked = null;
    this.#answer = null;
    return answer.answer;
  }

  /** HandleMenuInput's outputs for A on `item`: the cursor there, as PlaceMenuCursor puts it. */
  #pick(g: GameBoy, item: number): Answer {
    g.write(addr("wCurrentMenuItem"), item);
    const step = g.read(addr("hUILayoutFlags")) & EVERY_ROW ? SCREEN_WIDTH : SCREEN_WIDTH * 2;
    const at = addr("wTileMap") + g.read(addr("wTopMenuItemY")) * SCREEN_WIDTH + g.read(addr("wTopMenuItemX")) + item * step;
    g.write(addr("wMenuCursorLocation"), at & 0xff);
    g.write(addr("wMenuCursorLocation") + 1, at >> 8);
    return this.#keys(g, PAD_A);
  }

  /** HandleMenuInput's return: the keys in a, its flags reset. */
  #keys(g: GameBoy, keys: number): Answer {
    g.write(addr("wPartyMenuAnimMonEnabled"), 0);
    g.write(addr("wMenuWrappingEnabled"), 0);
    return { registers: { af: (keys << 8) | (g.registers.af & 0xff) } };
  }

  #menuAsk(g: GameBoy): BattleAsk {
    this.#move = null;
    return {
      kind: "menu",
      safari: g.read(addr("wBattleType")) === BATTLE_TYPE_SAFARI,
      balls: g.read(addr("wNumSafariBalls")),
      moves: this.#ownMoves(g, addr("wBattleMonMoves"), addr("wBattleMonPP"), true),
      link: g.read(addr("wLinkState")) === LINK_STATE_BATTLING,
    };
  }

  #movesAsk(g: GameBoy): BattleAsk {
    const menuType = g.read(addr("wMoveMenuType"));
    if (menuType === 1) {
      const moves = [...g.readBytes(addr("wEnemyMonMoves"), 4)].filter(Boolean).map((move) => this.#choice(move, null, null, false));
      return { kind: "moves", purpose: "mimic", moves, cancel: false };
    }
    if (menuType === 2) {
      const mon = addr("wPartyMons") + g.read(addr("wWhichPokemon")) * PARTYMON;
      return { kind: "moves", purpose: "item", moves: this.#ownMoves(g, mon + PARTYMON_MOVES, mon + PARTYMON_PP, false), cancel: true };
    }
    return { kind: "moves", purpose: "fight", moves: this.#ownMoves(g, addr("wBattleMonMoves"), addr("wBattleMonPP"), true), cancel: true };
  }

  /** The moves at `moves`, with PP at `pp` (PP UPs in the top bits), as the list shows them. */
  #ownMoves(g: GameBoy, moves: number, pp: number, battleMon: boolean): MoveChoice[] {
    const disabled = battleMon ? (g.read(addr("wPlayerDisabledMove")) >> 4) - 1 : -1;
    const transformed = battleMon && (g.read(addr("wPlayerBattleStatus3")) & TRANSFORMED) !== 0;
    const out: MoveChoice[] = [];
    for (let i = 0; i < 4; i++) {
      const move = g.read(moves + i);
      if (!move) break;
      const raw = g.read(pp + i);
      const base = this.#moveData(move).pp;
      const maxPp = transformed ? TRANSFORMED_PP : base + Math.floor(base / 5) * (raw >> 6);
      out.push(this.#choice(move, raw & PP_MASK, maxPp, i === disabled));
    }
    return out;
  }

  #choice(move: number, pp: number | null, maxPp: number | null, disabled: boolean): MoveChoice {
    return { move, name: moveName(this.#rom, move), type: this.#moveData(move).type, pp, maxPp, disabled };
  }

  /** A move's type and PP from the ROM's Moves table (animation, effect, power, type, accuracy, PP). */
  #moveData(move: number) {
    const at = romOffset(SYMBOLS.Moves) + (move - 1) * MOVE_DATA;
    return { type: this.#rom[at + 3]!, pp: this.#rom[at + 5]! };
  }
}

