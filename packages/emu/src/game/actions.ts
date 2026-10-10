// What the page's menu can do in the game (the Pokédex menu): each action is the game's own
// routine for it, called from the overworld idle point (SafePoint), never its menus. Where a
// routine asks the player something (the party menu's "use on which Pokémon?", a yes/no), a
// stand-in at that routine (ffi.ts) answers with what the page already chose, and its waits for
// a button pass by themselves; what it prints is kept for the page to show.
//
// | action | the game's code |
// |---|---|
// | use an item | `UseItem` with wCurItem, framed like a person's text (`DisplayTextIDInit` … `CloseTextDisplay`) |
// | toss | `RemoveItemFromInventory`, as tossing does once the player says yes |
// | reorder the team | `SwitchPartyMon_InitVarOrSwapData`, the party menu's swap without its drawing |
// | reorder moves | none outside battle: the moves and their PP swapped in the party struct |
// | reorder the bag | the swap `HandleItemListSwapping` makes, on wBagItems |
// | game options | wOptions, as the OPTION screen writes it |
// | save | `SaveGameData` |
import { isKeyItem, romOffset, SYMBOLS, type SymbolName } from "@pokehd/rom";
import type { GameBoy } from "../core.ts";
import { StandIn } from "../ffi.ts";
import { textBoxText } from "./asks.ts";
import { saveGame } from "../gifts/gifts.ts";
import { type Job, SafePoint, type Step } from "../gifts/safepoint.ts";

export type GameAction =
  /** `mon` is the party slot, for items used on a Pokémon. */
  | { kind: "use-item"; item: number; mon?: number }
  | { kind: "toss-item"; item: number; quantity: number }
  /** Moves a party member from one slot to another (the rest shift up or down). */
  | { kind: "move-mon"; from: number; to: number }
  | { kind: "move-move"; mon: number; from: number; to: number }
  | { kind: "move-item"; from: number; to: number }
  | { kind: "options"; options: number }
  | { kind: "save" };

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
const CHOSE_FIRST_ITEM = 1;
const CHOSE_SECOND_ITEM = 2;
/** wActionResultOrTookBattleTurn after UseItem: 0 not used, 1 used, 2 "not now" with no menu. */
const ITEM_USED = 1;
/** A text ID other than 0 (the start menu): DisplayTextIDInit draws an ordinary dialogue box. */
const TEXT_BOX = 1;

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
  readonly #rom: Uint8Array;
  readonly #safe: SafePoint;
  readonly #standIns: StandIn[];
  /** Set while one of our calls is running: its answers and what it printed. */
  #running: { mon?: number; yesNo: boolean[]; messages: string[] } | null = null;
  #queued = 0;

  constructor(gb: GameBoy, options: GameActionsOptions) {
    this.#rom = options.rom;
    this.#safe = SafePoint.of(gb);
    const ours = () => this.#running !== null;
    const keep = (g: GameBoy) => {
      const text = textBoxText(g);
      const messages = this.#running?.messages;
      if (text && messages && messages.at(-1) !== text) messages.push(text);
    };
    this.#standIns = [
      // "Use on which Pokémon?": the party menu's outputs (HandlePartyMenuInput), or cancelled.
      new StandIn(gb, "DisplayPartyMenu", ours, (g) => {
        const slot = this.#running?.mon;
        if (slot === undefined || slot >= g.read(addr("wPartyCount"))) return { carry: true };
        const species = g.read(addr("wPartySpecies") + slot);
        g.write(addr("wCurrentMenuItem"), slot);
        g.write(addr("wWhichPokemon"), slot);
        g.write(addr("wCurPartySpecies"), species);
        g.write(addr("wBattleMonSpecies2"), species);
        return { carry: false };
      }),
      // A yes/no: "delete an older move?" and the like. Answered from the action, else no.
      new StandIn(gb, "DisplayTextBoxID", (g) => ours() && g.read(addr("wTextBoxID")) === TWO_OPTION_MENU, (g) => {
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
  }

  /** Actions queued or running. */
  get pending(): number {
    return this.#queued;
  }

  run(action: GameAction, done: (result: ActionResult) => void): void {
    const job = this.#job(action, done);
    this.#queued++;
    const finish = job.done;
    job.done = (completed) => {
      this.#queued--;
      finish?.(completed);
    };
    this.#safe.enqueue(job);
  }

  dispose(): void {
    for (const s of this.#standIns) s.dispose();
  }

  #job(action: GameAction, done: (result: ActionResult) => void): Job {
    let failed: string | undefined;
    const fail = (reason: string) => ({ drop: reason });
    const finish = (completed: boolean) => {
      const messages = this.#running?.messages ?? [];
      this.#running = null;
      done(completed && !failed ? { ok: true, messages } : { ok: false, reason: failed ?? "not now", messages });
    };
    const begin = (mon?: number) => {
      this.#running = { mon, yesNo: [], messages: [] };
    };
    switch (action.kind) {
      case "use-item": {
        const { item, mon } = action;
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
            // The frame every message from a person gets: font loaded, sprites still, box drawn.
            {
              routine: "Bankswitch",
              before: (g) => {
                begin(mon);
                g.write(addr("hTextID"), TEXT_BOX);
              },
              registers: () => ({ bc: SYMBOLS.DisplayTextIDInit.bank << 8, hl: SYMBOLS.DisplayTextIDInit.address }),
            },
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
