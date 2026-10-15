// What the page's menu can do in the game (the Pokédex menu): each action is the game's own
// routine for it, called from the overworld idle point (SafePoint), never its menus. Where a
// routine asks the player something (the party menu's "use on which Pokémon?", a yes/no), a
// stand-in at that routine (ffi.ts) answers with what the page already chose, and its waits for
// a button pass by themselves; what it prints is kept for the page to show.
//
// | action | the game's code |
// |---|---|
// | use an item | `UseItem` with wCurItem, framed like a person's text (`DisplayTextIDInit` … `CloseTextDisplay`) |
// | CUT | `UsedCut`, as the start menu's POKéMON list calls it, in the same frame |
// | FLY, SURF, STRENGTH, FLASH, DIG, TELEPORT, SOFTBOILED | `StartMenu_Pokemon`'s branch for it, call by call (its texts, `IsSurfingAllowed`, `UseItem` with the move's pseudo-item, `PrintStrengthText`); FLY's town map stood in for |
// | toss | `RemoveItemFromInventory`, as tossing does once the player says yes |
// | reorder the team | `SwitchPartyMon_InitVarOrSwapData`, the party menu's swap without its drawing |
// | reorder moves | none outside battle: the moves and their PP swapped in the party struct |
// | reorder the bag | the swap `HandleItemListSwapping` makes, on wBagItems |
// | game options | wOptions, as the OPTION screen writes it |
// | save | `SaveGameData` |
//
// Both of the first two start where pressing START does: the tile the player faces worked out
// afresh (`GetTileAndCoordsInFrontOfPlayer`), as CUT, SURF and the rods read it.
import { isKeyItem, romOffset, SYMBOLS, type SymbolName } from "@pokehd/rom";
import type { GameBoy } from "../core.ts";
import { StandIn } from "../ffi.ts";
import { learnMoveCall, textBoxText } from "./asks.ts";
import { saveGame } from "../gifts/gifts.ts";
import { type Job, SafePoint, type Step } from "../gifts/safepoint.ts";
import { acting } from "./acting.ts";

export type GameAction =
  /**
   * `mon` is the party slot, for items used on a Pokémon. `answers` are the yes/no questions the
   * item's routine asks, in order (a TM's "Teach it to a Pokémon?"); any more are answered no.
   */
  | { kind: "use-item"; item: number; mon?: number; answers?: boolean[] }
  /** The field move CUT, by the party member in slot `mon`, on whatever the player faces. */
  | { kind: "cut"; mon: number }
  /**
   * Any other field move by the party member in slot `mon`: FLY to the town map `to` (a town the
   * player has visited), SOFTBOILED onto party member `target`.
   */
  | { kind: "field-move"; move: FieldMove; mon: number; to?: number; target?: number }
  | { kind: "toss-item"; item: number; quantity: number }
  /** Moves a party member from one slot to another (the rest shift up or down). */
  | { kind: "move-mon"; from: number; to: number }
  | { kind: "move-move"; mon: number; from: number; to: number }
  | { kind: "move-item"; from: number; to: number }
  | { kind: "options"; options: number }
  | { kind: "save" };

/** The field moves the start menu's POKéMON list offers besides CUT (`StartMenu_Pokemon`). */
export type FieldMove = "FLY" | "SURF" | "STRENGTH" | "FLASH" | "DIG" | "TELEPORT" | "SOFTBOILED";
export const FIELD_MOVES: Record<FieldMove, number> = { FLY: 0x13, SURF: 0x39, STRENGTH: 0x46, FLASH: 0x94, DIG: 0x5b, TELEPORT: 0x64, SOFTBOILED: 0x87 };
/** The badge each needs (wObtainedBadges bit, its name, its gym's town), as StartMenu_Pokemon checks. */
export const FIELD_MOVE_BADGES: Partial<Record<FieldMove, { bit: number; badge: string; town: string }>> = {
  FLASH: { bit: 0, badge: "BOULDERBADGE", town: "Pewter" },
  FLY: { bit: 2, badge: "THUNDERBADGE", town: "Vermilion" },
  STRENGTH: { bit: 3, badge: "RAINBOWBADGE", town: "Celadon" },
  SURF: { bit: 4, badge: "SOULBADGE", town: "Fuchsia" },
};
/** Towns FLY goes to: the first NUM_CITY_MAPS maps, by wTownVisitedFlag (BuildFlyLocationList). */
export const FLY_TOWNS = 11;
/** CheckIfInOutsideMap: towns and routes (tileset OVERWORLD) and Route 23 / Indigo Plateau (PLATEAU). */
export const outsideTileset = (tileset: number) => tileset === 0 || tileset === 23;

export type ActionResult =
  /** `messages`: what the game said, box by box (each a line or two). */
  | { ok: true; messages: string[] }
  | { ok: false; reason: string; messages: string[] };

const addr = (name: SymbolName) => SYMBOLS[name].address;
const PARTYMON_STRUCT_LENGTH = 44;
const MON_MOVES = 8;
const MON_PP = 29;
const NUM_MOVES = 4;
const TWO_OPTION_MENU = 0x14;
/** wStatusFlags5's BIT_NO_TEXT_DELAY: PrintLetterDelay returns at once. */
const NO_TEXT_DELAY = 1 << 6;
const CHOSE_FIRST_ITEM = 1;
const CHOSE_SECOND_ITEM = 2;
/** wActionResultOrTookBattleTurn after UseItem: 0 not used, 1 used, 2 "not now" with no menu. */
const ITEM_USED = 1;
/** A text ID other than 0 (the start menu): DisplayTextIDInit draws an ordinary dialogue box. */
const TEXT_BOX = 1;
const CUT = 0x0f;
const POTION = 0x14;
const SURFBOARD = 0x07;
const ESCAPE_ROPE = 0x1d;
/** wStatusFlags1 */
const SURF_ALLOWED = 1 << 1;
/** wStatusFlags4 */
const UNKNOWN_4_1 = 1 << 1;
const NO_BATTLES = 1 << 4;
/** wStatusFlags6 */
const FLY_WARP = 1 << 3;
const ESCAPE_WARP = 1 << 6;
/** wStatusFlags7 */
const USED_FLY = 1 << 7;
const MON_HP = 1;
const MON_MAXHP = 34;
/** wObtainedBadges' BIT_CASCADEBADGE, which the start menu's CUT asks for. */
const CASCADEBADGE = 1 << 1;
/** `lda_coord 8, 9`: the screen tile under the player's feet. */
const TILE_UNDER_PLAYER = 9 * 20 + 8;

/**
 * What pressing START works out before the start menu opens (OverworldLoop's `.displayDialogue`):
 * the tile in front of the player, for the way they face now, and the one they stand on. The
 * page's menu opens without START, so without this CUT read whatever tile was last worked out
 * (QA bug 69), and so would SURF and the rods.
 */
const facingStep = (before?: (gb: GameBoy) => void): Step => ({
  routine: "Bankswitch",
  before,
  registers: () => ({ bc: SYMBOLS._GetTileAndCoordsInFrontOfPlayer.bank << 8, hl: SYMBOLS._GetTileAndCoordsInFrontOfPlayer.address }),
  after: (g) => g.write(addr("wTilePlayerStandingOn"), g.read(addr("wTileMap") + TILE_UNDER_PLAYER)),
});

/** What the page needs to know to offer an item: whether it needs a Pokémon. */
export interface ItemUse {
  /** The bag's USE goes through the party menu (data/items/use_party.asm). */
  onMon: boolean;
}

/** From the game's own lists: which items its bag uses on a Pokémon. */
export function itemUse(rom: Uint8Array, item: number): ItemUse {
  if (item >= 0xc4) return { onMon: true }; // HMs and TMs teach a Pokémon
  const list = romOffset(SYMBOLS.UsableItems_PartyMenu);
  for (let i = list; rom[i] !== 0xff; i++) if (rom[i] === item) return { onMon: true };
  return { onMon: false };
}

export interface GameActionsOptions {
  rom: Uint8Array;
}

/**
 * Runs the page's actions, one at a time, at the overworld idle point. Actions wait for it (a
 * message on screen, a battle, a script), so one asked for mid-message happens once it ends.
 */
export class GameActions {
  readonly #gb: GameBoy;
  readonly #rom: Uint8Array;
  readonly #safe: SafePoint;
  readonly #standIns: StandIn[];
  readonly #removePause: () => void;
  /** Set while one of our calls is running: its answers and what it printed. */
  #running: { mon?: number; yesNo: boolean[]; messages: string[] } | null = null;
  #queued = 0;

  constructor(gb: GameBoy, options: GameActionsOptions) {
    this.#gb = gb;
    this.#rom = options.rom;
    this.#safe = SafePoint.of(gb);
    const ours = () => this.#running !== null;
    const keep = (g: GameBoy) => this.#keep(g);
    // "Use on which Pokémon?": the party menu's outputs (HandlePartyMenuInput), or cancelled.
    const party = (g: GameBoy) => {
      const slot = this.#running?.mon;
      if (slot === undefined || slot >= g.read(addr("wPartyCount"))) return { carry: true };
      const species = g.read(addr("wPartySpecies") + slot);
      g.write(addr("wCurrentMenuItem"), slot);
      g.write(addr("wWhichPokemon"), slot);
      g.write(addr("wCurPartySpecies"), species);
      g.write(addr("wBattleMonSpecies2"), species);
      return { carry: false };
    };
    this.#standIns = [
      new StandIn(gb, "DisplayPartyMenu", ours, party),
      // SOFTBOILED's (ItemUseMedicine goes back to the party menu the start menu left up).
      new StandIn(gb, "GoBackToPartyMenu", ours, party),
      // A yes/no: a TM's "Teach … to a POKéMON?" and the like. Answered from the action, else no.
      // LearnMove's ("Delete an older move…?", "Abandon learning…?") and its move list are the
      // page's to ask (GameAsks): answering them ourselves went round and round (QA bug 48). What
      // the action printed until then goes with the question, so the result starts afresh.
      new StandIn(gb, "DisplayTextBoxID", (g) => ours() && g.read(addr("wTextBoxID")) === TWO_OPTION_MENU && !this.#leftToPage(g), (g) => {
        keep(g);
        const yes = this.#running?.yesNo.shift() ?? false;
        g.write(addr("wCurrentMenuItem"), yes ? 0 : 1);
        g.write(addr("wMenuExitMethod"), yes ? CHOSE_FIRST_ITEM : CHOSE_SECOND_ITEM);
        return {};
      }),
      // Waits for a button: read, and carry on.
      new StandIn(gb, "WaitForTextScrollButtonPress", ours, (g) => (keep(g), {})),
      new StandIn(gb, "ManualTextScroll", ours, (g) => (keep(g), {})),
    ];
    // Words the game shows for a moment and moves on from, waiting for no button: FishingInit's
    // "<PLAYER> used OLD ROD!" sits there for DelayFrames (QA bug 73).
    this.#removePause = gb.addHook("DelayFrames", (g) => {
      if (ours()) keep(g);
    });
  }

  /** Keeps the text box's words for the result, unless it still shows the last kept. */
  #keep(g: GameBoy): void {
    // Without the ▼ the box shows while it waits, so the same words read the same after it.
    const text = textBoxText(g)
      .split("\n")
      .map((l) => l.replace(/▼/g, "").trim())
      .filter(Boolean)
      .join("\n");
    const messages = this.#running?.messages;
    if (text && messages && messages.at(-1) !== text) messages.push(text);
  }

  /** LearnMove asks the page (GameAsks), not the action: true, with what was printed so far dropped. */
  #leftToPage(g: GameBoy): boolean {
    if (!learnMoveCall(g)) return false;
    if (this.#running) this.#running.messages = [];
    return true;
  }

  /** Whether one of the actions is running in the game right now (not just queued). */
  get running(): boolean {
    return this.#running !== null;
  }

  /** Actions queued or running. */
  get pending(): number {
    return this.#queued;
  }

  /**
   * Queues the action for the next idle point. The returned function cancels it if it hasn't
   * started yet (a page's queued tap the player took back); `done` then gets "cancelled".
   */
  run(action: GameAction, done: (result: ActionResult) => void): () => void {
    let cancelled = false;
    let started = false;
    const job = this.#job(action, (result) => done(cancelled ? { ok: false, reason: "cancelled", messages: [] } : result));
    const check = job.check;
    job.check = (g) => {
      if (cancelled) return { drop: "cancelled" };
      const verdict = check?.(g);
      if (!verdict) started = true;
      return verdict;
    };
    this.#queued++;
    const finish = job.done;
    job.done = (completed) => {
      this.#queued--;
      finish?.(completed);
    };
    this.#safe.enqueue(job);
    return () => {
      if (!started) cancelled = true;
    };
  }

  dispose(): void {
    for (const s of this.#standIns) s.dispose();
    this.#removePause();
  }

  /**
   * StartMenu_Pokemon's `.choseOutOfBattleMove` branches (engine/menus/start_sub_menus.asm), one
   * call at a time from the idle point. Where a branch would go back to the party menu (a refusal
   * printed), the action ends with that text instead; FLY's town map is the page's to show, so its
   * pick is written as LoadTownMap_Fly writes it.
   */
  #fieldMove(
    action: Extract<GameAction, { kind: "field-move" }>,
    ctx: { begin: (mon?: number) => void; fail: (reason: string, say?: string) => { drop: string }; finish: (completed: boolean) => void; failed: (why: string) => void },
  ): Job {
    const { move, mon, to, target } = action;
    const rom = this.#rom;
    const last = () => this.#running?.messages.at(-1);
    /** The branch's calls, decided at the idle point (they read the game as it is then). */
    let steps: Step[] = [];
    const nameMon: Step = { routine: "GetPartyMonName", registers: () => ({ af: mon << 8, hl: addr("wPartyMonNicks") }) };
    const refuse = (text: SymbolName, why: string): Step[] => [...say(rom, text), { routine: "DelayFrame", after: () => void ctx.failed(last() ?? why) }];
    const itemStep = (item: number, user = mon): Step => ({
      routine: "UseItem",
      before: (g) => {
        g.write(addr("wCurItem"), item);
        g.write(addr("wPseudoItemID"), item);
        g.write(addr("wWhichPokemon"), user);
      },
      after: (g) => {
        this.#keep(g);
        if (g.read(addr("wActionResultOrTookBattleTurn")) === 0) ctx.failed(last() ?? `${move} didn't work here`);
      },
    });
    const job: Job = {
      scratch: [
        [addr("hTextID"), 1],
        [addr("wPseudoItemID"), 1],
        [addr("wUpdateSpritesEnabled"), 1],
        [addr("wPartyMenuTypeOrMessageID"), 1],
        [addr("wWhichPokemon"), 1],
        [addr("wStringBuffer"), 5],
      ],
      check: (g) => {
        if (mon >= g.read(addr("wPartyCount"))) return ctx.fail("no such Pokémon");
        const moves = g.readBytes(addr("wPartyMons") + mon * PARTYMON_STRUCT_LENGTH + MON_MOVES, NUM_MOVES);
        if (!moves.includes(FIELD_MOVES[move])) return ctx.fail(`doesn't know ${move}`);
        const badge = FIELD_MOVE_BADGES[move];
        if (badge && !((g.read(addr("wObtainedBadges")) >> badge.bit) & 1)) return ctx.fail(`needs the ${badge.badge}`, `${move} needs the ${badge.badge} from ${badge.town}'s Gym.`);
        const outside = outsideTileset(g.read(addr("wCurMapTileset")));
        switch (move) {
          case "FLY":
            if (!outside) steps = refuse("StartMenu_Pokemon.cannotFlyHereText", "can't fly here");
            else {
              if (to === undefined || to >= FLY_TOWNS) return ctx.fail("no town to fly to");
              const visited = g.read(addr("wTownVisitedFlag") + (to >> 3)) & (1 << (to & 7));
              if (!visited) return ctx.fail("not a town you've been to");
              // ChooseFlyDestination, then what LoadTownMap_Fly's A writes (its town list holds map IDs).
              steps = [{
                routine: "DelayFrame",
                before: (g2) => {
                  g2.write(addr("wStatusFlags4"), g2.read(addr("wStatusFlags4")) & ~NO_BATTLES);
                  g2.write(addr("wDestinationMap"), to);
                  g2.write(addr("wStatusFlags6"), g2.read(addr("wStatusFlags6")) | FLY_WARP);
                  g2.write(addr("wStatusFlags7"), g2.read(addr("wStatusFlags7")) | USED_FLY);
                },
              }];
            }
            break;
          case "SURF": {
            let allowed = false;
            steps = [
              farcall("IsSurfingAllowed"),
              {
                routine: "DelayFrame",
                before: (g2) => {
                  const flags = g2.read(addr("wStatusFlags1"));
                  allowed = !!(flags & SURF_ALLOWED);
                  g2.write(addr("wStatusFlags1"), flags & ~SURF_ALLOWED);
                },
                after: () => {
                  if (!allowed) ctx.failed(last() ?? "can't surf here");
                },
              },
            ];
            // UseItem only once IsSurfingAllowed said yes; else a frame, and on to the end.
            const surf = itemStep(SURFBOARD);
            steps.push({ ...surf, routine: "Bankswitch", registers: () => (allowed ? { bc: SYMBOLS.UseItem.bank << 8, hl: SYMBOLS.UseItem.address } : { bc: 0, hl: SYMBOLS.DelayFrame.address }), before: (g2) => allowed && surf.before!(g2), after: (g2, out) => (allowed ? surf.after!(g2, out) : undefined) });
            break;
          }
          case "STRENGTH":
            steps = [farcall("PrintStrengthText", (g2) => g2.write(addr("wCurPartySpecies"), g2.read(addr("wPartySpecies") + mon)))];
            break;
          case "FLASH":
            steps = [{ routine: "DelayFrame", before: (g2) => g2.write(addr("wMapPalOffset"), 0) }, ...say(rom, "StartMenu_Pokemon.flashLightsAreaText")];
            break;
          case "DIG":
            steps = [itemStep(ESCAPE_ROPE)];
            break;
          case "TELEPORT":
            if (!outside) steps = refuse("StartMenu_Pokemon.cannotUseTeleportNowText", "can't teleport here");
            else
              steps = [
                ...say(rom, "StartMenu_Pokemon.warpToLastPokemonCenterText"),
                {
                  routine: "DelayFrame",
                  before: (g2) => {
                    g2.write(addr("wStatusFlags6"), g2.read(addr("wStatusFlags6")) | FLY_WARP | ESCAPE_WARP);
                    g2.write(addr("wStatusFlags4"), (g2.read(addr("wStatusFlags4")) | UNKNOWN_4_1) & ~NO_BATTLES);
                  },
                },
              ];
            break;
          case "SOFTBOILED": {
            if (target === undefined || target >= g.read(addr("wPartyCount"))) return ctx.fail("no Pokémon to heal");
            const at = addr("wPartyMons") + mon * PARTYMON_STRUCT_LENGTH;
            const word = (a: number) => (g.read(a) << 8) | g.read(a + 1);
            // More HP than a fifth of its most, or "Not healthy enough."
            if (Math.floor(word(at + MON_MAXHP) / 5) >= word(at + MON_HP)) steps = refuse("StartMenu_Pokemon.notHealthyEnoughText", "not healthy enough");
            // ItemUseMedicine's Softboiled: the user in wWhichPokemon, the one it heals from the party menu.
            else steps = [itemStep(POTION)];
            break;
          }
        }
        // As pressing START works out what the player faces; the menu's frame; the Pokémon's
        // name where the branch's texts read it (`.choseOutOfBattleMove`); the branch; the way back.
        // The party menu's stand-in answers with SOFTBOILED's target.
        job.steps = [facingStep(() => ctx.begin(target ?? mon)), textFrame(), nameMon, ...steps, closeText];
        return undefined;
      },
      steps: [],
      done: ctx.finish,
    };
    return job;
  }

  #job(action: GameAction, done: (result: ActionResult) => void): Job {
    let failed: string | undefined;
    /** What the player is told when the action is refused before the game is asked. */
    let refusal: string[] = [];
    const fail = (reason: string, say?: string) => {
      failed = reason;
      if (say) refusal = [say];
      return { drop: reason };
    };
    /** We set the game's "no text delay" flag (it wasn't set before): cleared again at the end. */
    let quick = false;
    const finish = (completed: boolean) => {
      const messages = this.#running?.messages ?? refusal;
      this.#running = null;
      acting.delete(this.#gb);
      if (quick) this.#gb.write(addr("wStatusFlags5"), this.#gb.read(addr("wStatusFlags5")) & ~NO_TEXT_DELAY);
      quick = false;
      done(completed && !failed ? { ok: true, messages } : { ok: false, reason: failed ?? "not now", messages });
    };
    const begin = (mon?: number, answers: boolean[] = []) => {
      this.#running = { mon, yesNo: [...answers], messages: [] };
      acting.add(this.#gb);
      // Nobody sees what the action prints (the menu reports it afterwards), so it prints with no
      // letter delay, the game's own flag for that: a question it asks the page on the way
      // (LearnMove's) comes up at once, not after seconds of unseen text (QA bug 47).
      const flags = this.#gb.read(addr("wStatusFlags5"));
      quick = !(flags & NO_TEXT_DELAY);
      this.#gb.write(addr("wStatusFlags5"), flags | NO_TEXT_DELAY);
    };
    switch (action.kind) {
      case "use-item": {
        const { item, mon, answers } = action;
        const job: Job = {
          scratch: [
            [addr("hTextID"), 1],
            [addr("wPseudoItemID"), 1],
            [addr("wUpdateSpritesEnabled"), 1],
            [addr("wPartyMenuTypeOrMessageID"), 1],
            [addr("wWhichPokemon"), 1],
          ],
          check: (g) => {
            if (bagIndex(g, item) < 0) return fail("no longer in the bag");
            if (itemUse(this.#rom, item).onMon && (mon === undefined || mon >= g.read(addr("wPartyCount")))) return fail("needs a Pokémon");
            return undefined;
          },
          steps: [
            facingStep(() => begin(mon, answers)),
            // The frame every message from a person gets: font loaded, sprites still, box drawn.
            {
              routine: "Bankswitch",
              before: (g) => g.write(addr("hTextID"), TEXT_BOX),
              registers: () => ({ bc: SYMBOLS.DisplayTextIDInit.bank << 8, hl: SYMBOLS.DisplayTextIDInit.address }),
            },
            // As the bag's "USE" does (StartMenu_Item) before UseItem: the item's name in
            // wStringBuffer, where "<PLAYER> used OLD ROD!" reads it (QA bug 73: "used !").
            { routine: "GetItemName", before: (g) => g.write(addr("wNamedObjectIndex"), item) },
            { routine: "CopyToStringBuffer", registers: () => ({ de: addr("wNameBuffer") }) },
            {
              routine: "UseItem",
              before: (g) => {
                g.write(addr("wCurItem"), item);
                // As the bag's list leaves them: the item's place in the bag, which the item's
                // routine removes it from once it has worked.
                g.write(addr("wWhichPokemon"), bagIndex(g, item));
                g.write(addr("wPseudoItemID"), 0);
              },
              after: (g) => {
                // Its last words may wait for no button ("… did not learn MEGA PUNCH!").
                this.#keep(g);
                const result = g.read(addr("wActionResultOrTookBattleTurn"));
                if (result !== ITEM_USED) failed = this.#running?.messages.at(-1) ?? "it can't be used now";
              },
            },
            // And the way back: CloseTextDisplay pops the ROM bank DisplayTextID pushed.
            { routine: "CloseTextDisplay", push: (g) => [g.read(addr("hLoadedROMBank")) << 8] },
          ],
          done: finish,
        };
        return job;
      }
      case "cut": {
        const { mon } = action;
        return {
          scratch: [
            [addr("hTextID"), 1],
            [addr("wUpdateSpritesEnabled"), 1],
            [addr("wWhichPokemon"), 1],
          ],
          check: (g) => {
            if (mon >= g.read(addr("wPartyCount"))) return fail("no such Pokémon");
            const moves = g.readBytes(addr("wPartyMons") + mon * PARTYMON_STRUCT_LENGTH + MON_MOVES, NUM_MOVES);
            if (!moves.includes(CUT)) return fail("doesn't know CUT");
            // StartMenu_Pokemon's `.cut`, before it calls UsedCut.
            if (!(g.read(addr("wObtainedBadges")) & CASCADEBADGE)) return fail("needs the CASCADEBADGE", "CUT needs the CASCADEBADGE from Cerulean's Gym.");
            return undefined;
          },
          steps: [
            facingStep(() => begin(mon)),
            {
              routine: "Bankswitch",
              before: (g) => g.write(addr("hTextID"), TEXT_BOX),
              registers: () => ({ bc: SYMBOLS.DisplayTextIDInit.bank << 8, hl: SYMBOLS.DisplayTextIDInit.address }),
            },
            {
              routine: "Bankswitch",
              // The party menu leaves the chosen Pokémon here; UsedCut names it from wPartyMonNicks.
              before: (g) => g.write(addr("wWhichPokemon"), mon),
              registers: () => ({ bc: SYMBOLS.UsedCut.bank << 8, hl: SYMBOLS.UsedCut.address }),
              after: (g) => {
                // 0: "There isn't anything to CUT!", already kept from its prompt.
                if (g.read(addr("wActionResultOrTookBattleTurn")) === 0) failed = this.#running?.messages.at(-1) ?? "nothing to cut";
              },
            },
            { routine: "CloseTextDisplay", push: (g) => [g.read(addr("hLoadedROMBank")) << 8] },
          ],
          done: finish,
        };
      }
      case "field-move":
        return this.#fieldMove(action, { begin, fail, finish, failed: (why) => (failed = why) });
      case "toss-item": {
        const { item, quantity } = action;
        return {
          scratch: [[addr("wItemQuantity"), 1], [addr("wWhichPokemon"), 1]],
          check: (g) => {
            if (isKeyItem(this.#rom, item)) return fail("too important to toss");
            const i = bagIndex(g, item);
            if (i < 0) return fail("no longer in the bag");
            if (g.read(addr("wNumBagItems") + 2 + i * 2) < quantity) return fail("not that many");
            return undefined;
          },
          steps: [
            {
              routine: "RemoveItemFromInventory",
              before: (g) => {
                begin();
                g.write(addr("wWhichPokemon"), bagIndex(g, item));
                g.write(addr("wItemQuantity"), quantity);
              },
              registers: () => ({ hl: addr("wNumBagItems") }),
            },
          ],
          done: finish,
        };
      }
      case "move-mon": {
        const { from, to } = action;
        // Neighbouring swaps, as the player would make them, so the rest keep their order.
        const steps: Step[] = [];
        const dir = to > from ? 1 : -1;
        for (let i = from; i !== to; i += dir) {
          const a = i;
          const b = i + dir;
          steps.push({
            routine: "Bankswitch",
            before: (g) => {
              if (a === from) begin();
              g.write(addr("wMenuItemToSwap"), a + 1);
              g.write(addr("wCurrentMenuItem"), b);
            },
            registers: () => ({ bc: SYMBOLS.SwitchPartyMon_InitVarOrSwapData.bank << 8, hl: SYMBOLS.SwitchPartyMon_InitVarOrSwapData.address }),
          });
        }
        return {
          scratch: [
            [addr("wMenuItemToSwap"), 1],
            [addr("wCurrentMenuItem"), 1],
            [addr("wSwappedMenuItem"), 1],
            [addr("wPartyMenuTypeOrMessageID"), 1],
            [addr("wSwitchPartyMonTempBuffer"), PARTYMON_STRUCT_LENGTH],
            [addr("hSwapTemp"), 1],
          ],
          check: (g) => {
            const n = g.read(addr("wPartyCount"));
            if (from === to || from < 0 || to < 0 || from >= n || to >= n) return fail("no such slot");
            return undefined;
          },
          steps,
          done: finish,
        };
      }
      case "move-move": {
        const { mon, from, to } = action;
        return direct(
          (g) => {
            const base = addr("wPartyMons") + mon * PARTYMON_STRUCT_LENGTH;
            const moves = [...g.readBytes(base + MON_MOVES, NUM_MOVES)];
            const pp = [...g.readBytes(base + MON_PP, NUM_MOVES)];
            const count = moves.filter((m) => m !== 0).length;
            if (mon >= g.read(addr("wPartyCount")) || from >= count || to >= count) return "no such move";
            const [m] = moves.splice(from, 1);
            const [p] = pp.splice(from, 1);
            moves.splice(to, 0, m!);
            pp.splice(to, 0, p!);
            moves.forEach((v, i) => g.write(base + MON_MOVES + i, v));
            pp.forEach((v, i) => g.write(base + MON_PP + i, v));
            return undefined;
          },
          done,
        );
      }
      case "move-item": {
        const { from, to } = action;
        return direct(
          (g) => {
            const bag = addr("wNumBagItems");
            const n = g.read(bag);
            if (from >= n || to >= n) return "no such item";
            const items = Array.from({ length: n }, (_, i) => [...g.readBytes(bag + 1 + i * 2, 2)]);
            const [it] = items.splice(from, 1);
            items.splice(to, 0, it!);
            items.flat().forEach((v, i) => g.write(bag + 1 + i, v));
            return undefined;
          },
          done,
        );
      }
      case "options":
        return direct((g) => (g.write(addr("wOptions"), action.options), undefined), done);
      case "save":
        return { scratch: [], steps: [{ ...saveGame, before: () => begin() }], done: finish };
    }
  }
}

/** A routine in any bank, called through Bankswitch as `farcall` does. */
const farcall = (name: SymbolName, before?: (gb: GameBoy) => void): Step => ({
  routine: "Bankswitch",
  before,
  registers: () => ({ bc: SYMBOLS[name].bank << 8, hl: SYMBOLS[name].address }),
});

/** DisplayTextIDInit's frame: what every message from a person gets (font, sprites still, the box). */
const textFrame = (before?: (gb: GameBoy) => void): Step => ({
  routine: "Bankswitch",
  before: (g) => {
    before?.(g);
    g.write(addr("hTextID"), TEXT_BOX);
  },
  registers: () => ({ bc: SYMBOLS.DisplayTextIDInit.bank << 8, hl: SYMBOLS.DisplayTextIDInit.address }),
});
/** And its end: CloseTextDisplay pops the ROM bank DisplayTextID pushed. */
const closeText: Step = { routine: "CloseTextDisplay", push: (g) => [g.read(addr("hLoadedROMBank")) << 8] };

/** A text of StartMenu_Pokemon's (`text_far` and `text_end`), printed as its `PrintText` does. */
function say(rom: Uint8Array, text: SymbolName): Step[] {
  const bytes = rom.subarray(romOffset(SYMBOLS[text]), romOffset(SYMBOLS[text]) + 5);
  // The text's bank isn't mapped at the idle point: its five bytes go where any bank sees them.
  return [{ routine: "PrintText", before: (g) => bytes.forEach((b, i) => g.write(addr("wStringBuffer") + i, b)), registers: () => ({ hl: addr("wStringBuffer") }) }];
}

/** A change made straight to the game's data at the idle point (no routine of its own). */
function direct(change: (gb: GameBoy) => string | undefined, done: (result: ActionResult) => void): Job {
  let reason: string | undefined;
  return {
    scratch: [],
    check: (gb) => {
      reason = change(gb);
      return { drop: reason ?? "done" };
    },
    steps: [],
    done: () => done(reason ? { ok: false, reason, messages: [] } : { ok: true, messages: [] }),
  };
}

function bagIndex(gb: GameBoy, item: number): number {
  const bag = addr("wNumBagItems");
  for (let i = 0; i < gb.read(bag); i++) if (gb.read(bag + 1 + i * 2) === item) return i;
  return -1;
}
