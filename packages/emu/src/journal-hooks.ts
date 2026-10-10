// The play journal's eyes in the game (the Pokédex menu's Map, People, Inventory and Me tabs):
// battles, Pokémon seen and caught, items in and out, Pokémon from people, badges and
// evolutions, read at the game's own routines as they run. Read-only: every hook only reads
// WRAM and registers, so nothing in the game changes (CLAUDE.md level 1). Routines from pret
// pokered: engine/battle/core.asm, end_of_battle.asm, engine/items/inventory.asm and
// item_effects.asm, engine/pokemon/add_mon.asm and evos_moves.asm, engine/events/*.asm.
//
// Species are the game's internal indices (as wCurPartySpecies holds them), not Pokédex
// numbers; items are item IDs. Positions are the map and the player's step (wXCoord, wYCoord).
import { romOffset, SYMBOLS, type RomSymbol, type SymbolName } from "@pokehd/rom";
import type { GameBoy } from "./core.ts";
import { PARTYMON_STRUCT_LENGTH } from "./gifts/gifts.ts";
import { SafePoint } from "./gifts/safepoint.ts";

/** Where the player stood: the map and their step in it. */
export interface JournalPlace {
  map: number;
  x: number;
  y: number;
}

/** How an item reached the bag or the PC. */
export type ItemSource =
  /** An item ball on the map (PickUpItem). */
  | "found"
  /** A hidden item (HiddenItems). */
  | "hidden"
  /** A Poké Mart or a vending machine. */
  | "bought"
  /** Moved between the bag and the PC. */
  | "pc"
  /** The page called the game's routine at a safe point (a friend's gift; D20). */
  | "page"
  /** Anything else: people's gifts, prizes, the Potion in the PC at the start. */
  | "given";

/** Why an item left the bag or the PC. */
export type ItemRemoval = "sold" | "pc" | "tossed" | "page" | "used";

/** How a Pokémon joined other than by a catch. */
export type MonArrival =
  /** Oak's lab: the first Pokémon, before the game's got-starter flag. */
  | "starter"
  /** GivePokemon (Eevee, Lapras, fossils, prizes, the Magikarp salesman). */
  | "gift"
  /** An in-game trade. */
  | "trade"
  /** A trade over the link cable. */
  | "link-trade"
  /** The page called the game's routine (a friend's gift; D20). */
  | "page";

export type BattleKind = "wild" | "trainer" | "link";

/**
 * How a battle ended. `ran` covers the player running and anyone leaving by Teleport, Roar,
 * Whirlwind or a Poké Doll; `fled` is a wild Pokémon running away (Safari Zone).
 */
export type BattleEnding = "won" | "lost" | "ran" | "fled" | "caught" | "draw";

export type JournalEvent =
  | ({
      type: "battle-start";
      kind: BattleKind;
      /** wBattleType: 0 normal, 1 the old man's demonstration, 2 Safari Zone. */
      battleType: number;
      /** Wild battles: the Pokémon and its level. */
      species?: number;
      level?: number;
      /** Trainer battles: the trainer class (as in trainer_constants.asm) and number in it. */
      trainerClass?: number;
      trainerNumber?: number;
    } & JournalPlace)
  /** Each Pokémon the other side sends out (wild ones once, at the start). */
  | ({ type: "enemy-seen"; species: number; level: number; kind: BattleKind } & JournalPlace)
  | ({ type: "caught"; species: number; level: number; into: "party" | "box" } & JournalPlace)
  /** `result` is the game's wBattleResult: 0 win, 1 loss, 2 draw (or ran). */
  | ({ type: "battle-end"; kind: BattleKind; outcome: BattleEnding; result: number } & JournalPlace)
  | ({ type: "item-added"; item: number; quantity: number; inventory: "bag" | "box"; source: ItemSource } & JournalPlace)
  | ({ type: "item-removed"; item: number; quantity: number; inventory: "bag" | "box"; reason: ItemRemoval } & JournalPlace)
  | ({ type: "mon-added"; species: number; level: number; into: "party" | "box"; how: MonArrival } & JournalPlace)
  /** A badge bit newly set in wObtainedBadges: 0 Boulder … 7 Earth. */
  | ({ type: "badge"; badge: number } & JournalPlace)
  | ({ type: "evolved"; from: number; to: number; level: number; partyIndex: number } & JournalPlace);

export interface JournalHooksOptions {
  rom: Uint8Array;
  emit(event: JournalEvent): void;
  /**
   * True while the page, not the game, is behind a routine call (items and Pokémon then carry
   * source "page"). Defaults to the GameBoy's SafePoint being mid-call.
   */
  ours?(gb: GameBoy): boolean;
}

const addr = (name: SymbolName) => SYMBOLS[name].address;

const LD_A_NN = 0xfa;
const LD_HL_NN = 0x21;
const PUSH_HL = 0xe5;
const POP_HL = 0xe1;
const TRAINER_OFFSET = 200; // OPP_ID_OFFSET
const LINK_STATE_BATTLING = 0x04;
const LINK_STATE_TRADING = 0x32;
const BIT_GOT_STARTER = 3; // in wStatusFlags4
const PARTY_LENGTH = 6;
const MON_LEVEL = 33; // in a party_struct (wLoadedMon)
/** wMonDataLocation as the in-game trade sets it (player's party, no naming). */
const IN_GAME_TRADE = 0x80;

/**
 * The routines the journal hooks, checked against the ROM's bytes so a different revision fails
 * loudly instead of reading the wrong moment.
 */
export function journalHooks(rom: Uint8Array) {
  const at = (sym: RomSymbol) => rom[romOffset(sym)];
  const ldA = (sym: RomSymbol, from: SymbolName) =>
    at(sym) === LD_A_NN && rom[romOffset(sym) + 1] === (addr(from) & 0xff) && rom[romOffset(sym) + 2] === addr(from) >> 8;
  const expect = (ok: boolean, what: string) => {
    if (!ok) throw new Error(`Journal: ${what} isn't where expected`);
  };
  expect(ldA(SYMBOLS.AddItemToInventory_, "wItemQuantity"), "AddItemToInventory_");
  expect(at(SYMBOLS["AddItemToInventory_.done"]) === POP_HL, "AddItemToInventory_'s end");
  expect(at(SYMBOLS.RemoveItemFromInventory_) === PUSH_HL, "RemoveItemFromInventory_");
  expect(ldA(SYMBOLS.LoadEnemyMonData, "wLinkState"), "LoadEnemyMonData");
  expect(ldA(SYMBOLS.EndOfBattle, "wLinkState"), "EndOfBattle");
  expect(ldA(SYMBOLS["ItemUseBall.skip6"], "wCurPartySpecies"), "a caught Pokémon");
  expect(ldA(SYMBOLS["ItemUseBall.skipShowingPokedexData"], "wPartyCount"), "a caught Pokémon's destination");
  const enemyMon = romOffset(SYMBOLS._AddEnemyMonToPlayerParty);
  const partyCount = addr("wPartyCount");
  expect(rom[enemyMon] === LD_HL_NN && rom[enemyMon + 1] === (partyCount & 0xff) && rom[enemyMon + 2] === partyCount >> 8, "_AddEnemyMonToPlayerParty");
  return SYMBOLS;
}

/** The interaction an item add or removal happens in, from the routine that started it. */
type Context = "found" | "hidden" | "bought" | "pc" | "tossed";

const CONTEXTS: [SymbolName, Context][] = [
  ["PickUpItem", "found"],
  ["HiddenItems", "hidden"],
  ["DisplayPokemartDialogue_", "bought"],
  ["VendingMachineMenu", "bought"],
  ["PlayerPCDeposit", "pc"],
  ["PlayerPCWithdraw", "pc"],
  ["TossItem_", "tossed"],
];

/**
 * Hooks the game's routines and emits a JournalEvent as each thing happens. Only reads.
 * Call `resync()` after loading a save state, so badges already held aren't news.
 */
export class JournalHooks {
  readonly #remove: (() => void)[] = [];
  /** Set by the routine that started the current text or menu; cleared by the overworld loop. */
  #context: Context | undefined;
  #battle: BattleKind | undefined;
  /** Between a ball's success and the caught Pokémon landing in the party or box. */
  #capturing = false;
  #caught = false;
  #adding: { item: number; quantity: number; inventory: "bag" | "box" | undefined } | undefined;
  /** wObtainedBadges as last seen in the overworld; undefined until then (a save may load first). */
  #badges: number | undefined;

  constructor(gb: GameBoy, options: JournalHooksOptions) {
    journalHooks(options.rom);
    const { emit } = options;
    const ours = options.ours ?? ((g: GameBoy) => SafePoint.callingOn(g));
    const r = (name: SymbolName, offset = 0) => gb.read(addr(name) + offset);
    const where = (): JournalPlace => ({ map: r("wCurMap"), x: r("wXCoord"), y: r("wYCoord") });
    const inventory = (hl: number) => (hl === addr("wNumBagItems") ? "bag" : hl === addr("wNumBoxItems") ? "box" : undefined);
    const hook = (target: SymbolName, callback: () => void) => this.#remove.push(gb.addHook(target, callback));

    for (const [routine, context] of CONTEXTS) hook(routine, () => (this.#context = context));
    hook("OverworldLoop", () => {
      this.#context = undefined;
      const badges = r("wObtainedBadges");
      const gained = this.#badges === undefined ? 0 : badges & ~this.#badges;
      this.#badges = badges;
      for (let b = 0; b < 8; b++) if (gained & (1 << b)) emit({ type: "badge", badge: b, ...where() });
    });
    // The save's badges arrive with the rest of its data: not news.
    hook("LoadMainData", () => (this.#badges = undefined));

    // InitBattleCommon runs once a battle is certain: wild (after the encounter roll), trainer
    // and link. wEnemyMonSpecies2 is the wild species or OPP_ID_OFFSET + the trainer class.
    hook("InitBattleCommon", () => {
      const kind: BattleKind = r("wLinkState") === LINK_STATE_BATTLING ? "link" : r("wEnemyMonSpecies2") >= TRAINER_OFFSET ? "trainer" : "wild";
      this.#battle = kind;
      this.#capturing = false;
      this.#caught = false;
      const opponent = r("wEnemyMonSpecies2");
      emit({
        type: "battle-start",
        kind,
        battleType: r("wBattleType"),
        ...(kind === "wild" ? { species: opponent, level: r("wCurEnemyLevel") } : {}),
        ...(kind === "trainer" ? { trainerClass: opponent - TRAINER_OFFSET, trainerNumber: r("wTrainerNo") } : {}),
        ...where(),
      });
    });
    // Every Pokémon the other side puts out, before its data is filled in. GivePokemon calls it
    // outside battles, and a caught Pokémon's data is reloaded through it: neither is a sighting.
    hook("LoadEnemyMonData", () => {
      if (r("wIsInBattle") === 0 || this.#capturing || !this.#battle) return;
      // A link battle's Pokémon come whole from the friend's party (LoadEnemyMonFromParty).
      const mon = r("wWhichPokemon") * PARTYMON_STRUCT_LENGTH;
      const link = r("wLinkState") === LINK_STATE_BATTLING;
      const species = link ? r("wEnemyMons", mon) : r("wEnemyMonSpecies2");
      const level = link ? r("wEnemyMons", mon + MON_LEVEL) : r("wCurEnemyLevel");
      emit({ type: "enemy-seen", species, level, kind: this.#battle, ...where() });
    });
    // ItemUseBall reaches .skip6 only once the ball has worked.
    hook("ItemUseBall.skip6", () => (this.#capturing = true));
    // After the Pokédex flags: the old man's catch has jumped away by now.
    hook("ItemUseBall.skipShowingPokedexData", () => {
      this.#caught = true;
      const into = r("wPartyCount") < PARTY_LENGTH ? "party" : "box";
      emit({ type: "caught", species: r("wCapturedMonSpecies"), level: r("wEnemyMonLevel"), into, ...where() });
    });
    hook("EndOfBattle", () => {
      const kind = this.#battle ?? (r("wLinkState") === LINK_STATE_BATTLING ? "link" : "wild");
      const result = r("wBattleResult");
      let outcome: BattleEnding;
      if (kind === "link") outcome = result === 0 ? "won" : result === 1 ? "lost" : "draw";
      else if (this.#caught) outcome = "caught";
      else if (result === 1) outcome = "lost";
      else if (result === 2 || r("wEscapedFromBattle") !== 0) outcome = "ran";
      else if (kind === "wild" && (r("wEnemyMonHP") | r("wEnemyMonHP", 1)) !== 0) outcome = "fled";
      else outcome = "won";
      emit({ type: "battle-end", kind, outcome, result, ...where() });
      this.#battle = undefined;
      this.#capturing = false;
      this.#caught = false;
    });

    // Items: the inputs at the start (wItemQuantity changes on the way), success (carry) at .done.
    hook("AddItemToInventory_", () => {
      this.#adding = { item: r("wCurItem"), quantity: r("wItemQuantity"), inventory: inventory(gb.registers.hl) };
    });
    hook("AddItemToInventory_.done", () => {
      const adding = this.#adding;
      this.#adding = undefined;
      if (!adding?.inventory || !(gb.registers.af & 0x10)) return;
      const context = this.#context;
      let source: ItemSource = "given";
      if (ours(gb)) source = "page";
      else if (context === "pc") source = "pc";
      else if (adding.inventory === "bag" && (context === "found" || context === "hidden" || context === "bought")) source = context;
      emit({ type: "item-added", ...adding, inventory: adding.inventory, source, ...where() });
    });
    hook("RemoveItemFromInventory_", () => {
      const hl = gb.registers.hl;
      const from = inventory(hl);
      if (!from) return;
      const index = r("wWhichPokemon");
      const context = this.#context;
      const reason: ItemRemoval = ours(gb)
        ? "page"
        : context === "bought"
          ? "sold"
          : context === "pc" || context === "tossed"
            ? context
            : "used";
      emit({ type: "item-removed", item: gb.read(hl + 1 + index * 2), quantity: r("wItemQuantity"), inventory: from, reason, ...where() });
    });

    // Pokémon that join other than by a catch.
    hook("AddPartyMon", () => {
      const location = r("wMonDataLocation");
      if (location & 0x0f || r("wPartyCount") >= PARTY_LENGTH) return; // the enemy's party, or full
      if (this.#capturing) {
        this.#capturing = false;
        return;
      }
      const how: MonArrival = ours(gb)
        ? "page"
        : location === IN_GAME_TRADE
          ? "trade"
          : r("wStatusFlags4") & (1 << BIT_GOT_STARTER)
            ? "gift"
            : "starter";
      emit({ type: "mon-added", species: r("wCurPartySpecies"), level: r("wCurEnemyLevel"), into: "party", how, ...where() });
    });
    hook("SendNewMonToBox", () => {
      if (this.#capturing) {
        this.#capturing = false;
        return;
      }
      emit({ type: "mon-added", species: r("wCurPartySpecies"), level: r("wCurEnemyLevel"), into: "box", how: ours(gb) ? "page" : "gift", ...where() });
    });
    // The Trade Center's routine (and friends' gifts, D20): the mon arrives whole in wLoadedMon.
    hook("_AddEnemyMonToPlayerParty", () => {
      if (r("wPartyCount") >= PARTY_LENGTH) return;
      const how: MonArrival = ours(gb) ? "page" : r("wLinkState") === LINK_STATE_TRADING ? "link-trade" : "trade";
      emit({ type: "mon-added", species: r("wCurPartySpecies"), level: r("wLoadedMon", MON_LEVEL), into: "party", how, ...where() });
    });

    // RenameEvolvedMon runs only once EvolveMon wasn't cancelled; wEvoNewSpecies holds the new
    // species by then.
    hook("RenameEvolvedMon", () => {
      emit({
        type: "evolved",
        from: r("wEvoOldSpecies"),
        to: r("wEvoNewSpecies"),
        level: r("wCurEnemyLevel"),
        partyIndex: r("wWhichPokemon"),
        ...where(),
      });
    });
  }

  /** After a save state loads: forget the badges seen so far and any routine in progress. */
  resync(): void {
    this.#badges = undefined;
    this.#context = undefined;
    this.#battle = undefined;
    this.#capturing = false;
    this.#caught = false;
    this.#adding = undefined;
  }

  dispose(): void {
    for (const remove of this.#remove) remove();
    this.#remove.length = 0;
  }
}
