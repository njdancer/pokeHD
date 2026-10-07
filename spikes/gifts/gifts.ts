// Gifts from friends as jobs for the safe point: each one is the game's own routine for that
// kind of gain, called with the same inputs its own callers use.
//
// | gift | routine | game caller it mirrors |
// |---|---|---|
// | money | `Predef AddBCDPredef` on `wPlayerMoney` | Pay Day money after a battle |
// | item | `AddItemToInventory` on `wNumBagItems` | `GiveItem` (NPC gifts), picking up items |
// | Pokémon, party has room | `AddEnemyMonToPlayerParty` from `wLoadedMon` + OT + nickname | the Trade Center |
// | Pokémon, party full | append to the current box (our writes) + `IndexToPokedex`/`FlagAction` | Bill's PC deposit |
import type { GameBoy } from "../../packages/emu/src/core.ts";
import { CARRY, type Job, type Step, type Symbols } from "./safepoint.ts";

export type Gift =
  | { kind: "money"; amount: number }
  | { kind: "item"; item: number; quantity: number }
  | { kind: "mon"; mon: GiftedMon };

/** A Pokémon as the trade code sends it: the 44-byte party struct plus OT and nickname. */
export interface GiftedMon {
  data: Uint8Array;
  ot: Uint8Array;
  nick: Uint8Array;
}

export type Landed = "money" | "bag" | "party" | "box";

export const PARTYMON_STRUCT_LENGTH = 44;
export const BOXMON_STRUCT_LENGTH = 33;
export const NAME_LENGTH = 11;
const PARTY_LENGTH = 6;
const MONS_PER_BOX = 20;
const BAG_ITEM_CAPACITY = 20;
const MAX_MONEY = 999_999;
const FLAG_SET = 1;
const MON_LEVEL = 33;
const MON_BOX_LEVEL = 3;
const TERMINATOR = 0x50;

export const fromBcd = (bytes: Uint8Array) =>
  [...bytes].reduce((n, b) => n * 100 + (b >> 4) * 10 + (b & 0xf), 0);
export const toBcd = (n: number, length: number) => {
  const out = new Uint8Array(length);
  for (let i = length - 1; i >= 0; i--, n = Math.floor(n / 100)) {
    const two = n % 100;
    out[i] = ((Math.floor(two / 10) << 4) | two % 10) & 0xff;
  }
  return out;
};

/**
 * Checks a gifted Pokémon before it goes anywhere near the game. The friend's client builds it
 * from their own save, but the receiver shouldn't trust that. Returns a reason, or undefined.
 */
export function invalidMon(rom: Uint8Array, s: Symbols, mon: GiftedMon): string | undefined {
  const { data, ot, nick } = mon;
  if (data.length !== PARTYMON_STRUCT_LENGTH) return "struct length";
  if (ot.length !== NAME_LENGTH || !ot.includes(TERMINATOR)) return "OT name";
  if (nick.length !== NAME_LENGTH || !nick.includes(TERMINATOR)) return "nickname";
  const species = data[0]!;
  // PokedexOrder maps internal index → dex number; 0 is MissingNo and the other glitch slots.
  const order = s.get("PokedexOrder");
  const dex = species === 0 ? 0 : rom[order.bank * 0x4000 + order.address - 0x4000 + species - 1];
  if (!dex || dex > 151) return "species";
  // Only the party level: _AddPartyMon leaves the box-level byte 0 until the mon is deposited.
  const level = data[MON_LEVEL]!;
  if (level < 1 || level > 100) return "level";
  for (const move of data.subarray(8, 12)) if (move > 165) return "move";
  return undefined;
}

/** Builds the safe-point job for one gift. `landed` is called once it's in the game. */
export function giftJob(s: Symbols, gift: Gift, landed: (where: Landed) => void): Job {
  switch (gift.kind) {
    case "money":
      return moneyJob(s, gift.amount, landed);
    case "item":
      return itemJob(s, gift.item, gift.quantity, landed);
    case "mon":
      return monJob(s, gift.mon, landed);
  }
}

/** A predef's ID: its entry in `PredefPointers`, labelled `<routine>Predef` by `add_predef`. */
function predef(s: Symbols, routine: string): number {
  const id = (s.addr(`${routine}Predef`) - s.addr("PredefPointers")) / 3;
  if (!Number.isInteger(id) || id < 0 || id > 0xff) throw new Error(`Not a predef: ${routine}`);
  return id;
}

function moneyJob(s: Symbols, amount: number, landed: (where: Landed) => void): Job {
  const money = s.addr("wPlayerMoney");
  const hMoney = s.addr("hMoney");
  return {
    scratch: [[hMoney, 3]],
    // AddBCD saturates at 999999; hold rather than let a gift silently lose money.
    check: (gb) => (fromBcd(gb.readBytes(money, 3)) + amount > MAX_MONEY ? "money would exceed 999999" : undefined),
    steps: [
      {
        routine: "Predef",
        before: (gb) => toBcd(amount, 3).forEach((b, i) => gb.write(hMoney + i, b)),
        // Pay Day: de = wPlayerMoney + 2, hl = source + 2, c = 3 bytes.
        registers: () => ({ af: predef(s, "AddBCDPredef") << 8, de: money + 2, hl: hMoney + 2, bc: 3 }),
        after: () => landed("money"),
      },
    ],
  };
}

function itemJob(s: Symbols, item: number, quantity: number, landed: (where: Landed) => void): Job {
  const bag = s.addr("wNumBagItems");
  const held = (gb: GameBoy) => {
    for (let i = 0; i < gb.read(bag); i++) if (gb.read(bag + 1 + i * 2) === item) return gb.read(bag + 2 + i * 2);
    return undefined;
  };
  return {
    scratch: [[s.addr("wCurItem"), 1], [s.addr("wItemQuantity"), 1]],
    // AddItemToInventory itself fails cleanly when there's no room (nothing is written), but
    // checking first keeps a full bag from costing a call every overworld frame. With a free
    // slot the game fills a stack to 99 and starts a new one, so only a full bag can refuse.
    check: (gb) => {
      if (gb.read(bag) < BAG_ITEM_CAPACITY) return undefined;
      const have = held(gb);
      return have === undefined || have + quantity > 99 ? "bag full" : undefined;
    },
    steps: [
      {
        routine: "AddItemToInventory",
        before: (gb) => {
          gb.write(s.addr("wCurItem"), item);
          gb.write(s.addr("wItemQuantity"), quantity);
        },
        registers: () => ({ hl: bag }),
        after: (_gb, out) => {
          if (!(out.af & CARRY)) return false; // no room for the overflow past 99: try later
          landed("bag");
        },
      },
    ],
  };
}

function monJob(s: Symbols, mon: GiftedMon, landed: (where: Landed) => void): Job {
  const partyCount = s.addr("wPartyCount");
  const boxCount = s.addr("wBoxCount");
  const loaded = s.addr("wLoadedMon");
  const ot = s.addr("wEnemyMon1OT");
  const nick = s.addr("wEnemyMon1Nick");
  const species = mon.data[0]!;
  let toBox = false;

  const toParty: Step = {
    routine: "AddEnemyMonToPlayerParty",
    before: (gb) => {
      mon.data.forEach((b, i) => gb.write(loaded + i, b));
      mon.ot.forEach((b, i) => gb.write(ot + i, b));
      mon.nick.forEach((b, i) => gb.write(nick + i, b));
      gb.write(s.addr("wWhichPokemon"), 0);
      gb.write(s.addr("wCurPartySpecies"), species);
    },
    after: (_gb, out) => {
      if (out.af & CARRY) return false; // party full after all
      landed("party");
    },
  };

  // The party is full: deposit as Bill's PC would (`_MoveMon` PARTY_TO_BOX appends the first 33
  // bytes with the box level copied from the party level, then OT and nickname), then mark it
  // seen and owned with the game's own routines, as AddEnemyMonToPlayerParty does.
  const deposit = (gb: GameBoy) => {
    const n = gb.read(boxCount);
    gb.write(boxCount, n + 1);
    gb.write(s.addr("wBoxSpecies") + n, species);
    gb.write(s.addr("wBoxSpecies") + n + 1, 0xff);
    const box = mon.data.slice(0, BOXMON_STRUCT_LENGTH);
    box[MON_BOX_LEVEL] = mon.data[MON_LEVEL]!;
    box.forEach((b, i) => gb.write(s.addr("wBoxMons") + n * BOXMON_STRUCT_LENGTH + i, b));
    mon.ot.forEach((b, i) => gb.write(s.addr("wBoxMonOT") + n * NAME_LENGTH + i, b));
    mon.nick.forEach((b, i) => gb.write(s.addr("wBoxMonNicks") + n * NAME_LENGTH + i, b));
    gb.write(s.addr("wPokedexNum"), species);
  };
  const dexFlag = (list: string): Step => ({
    routine: "Predef",
    registers: (gb) => ({
      af: predef(s, "FlagActionPredef") << 8,
      hl: s.addr(list),
      bc: (FLAG_SET << 8) | (gb.read(s.addr("wPokedexNum")) - 1),
    }),
  });
  const toBoxSteps: Step[] = [
    { routine: "Predef", before: deposit, registers: () => ({ af: predef(s, "IndexToPokedex") << 8 }) },
    dexFlag("wPokedexOwned"),
    { ...dexFlag("wPokedexSeen"), after: () => landed("box") },
  ];

  const job: Job = {
    scratch: [
      [loaded, PARTYMON_STRUCT_LENGTH],
      [ot, NAME_LENGTH],
      [nick, NAME_LENGTH],
      [s.addr("wWhichPokemon"), 1],
      [s.addr("wCurPartySpecies"), 1],
      [s.addr("wPokedexNum"), 1],
    ],
    check: (gb) => {
      if (gb.read(partyCount) < PARTY_LENGTH) {
        toBox = false;
      } else if (gb.read(boxCount) < MONS_PER_BOX) {
        toBox = true;
      } else {
        return "party and box full";
      }
      job.steps = toBox ? toBoxSteps : [toParty];
      return undefined;
    },
    steps: [toParty],
  };
  return job;
}

export interface Delivery {
  gift: Gift;
  where: Landed;
}

/**
 * The receiving end: gifts wait here until the safe point takes them. A gift the game turns
 * down at the last moment (a stack that can't take the overflow) goes back in the queue.
 */
export class GiftInbox {
  readonly delivered: Delivery[] = [];
  readonly #safe: { enqueue(job: Job): void };
  readonly #s: Symbols;

  constructor(safePoint: { enqueue(job: Job): void }, symbols: Symbols) {
    this.#safe = safePoint;
    this.#s = symbols;
  }

  give(gift: Gift): void {
    const job = giftJob(this.#s, gift, (where) => this.delivered.push({ gift, where }));
    job.done = (completed) => {
      if (!completed) this.give(gift);
    };
    this.#safe.enqueue(job);
  }
}
