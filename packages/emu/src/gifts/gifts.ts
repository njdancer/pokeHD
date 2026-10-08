// Gifts as safe-point jobs (D20). Each one is the game's own routine for that kind of gain or
// loss, called with the inputs its own callers use:
//
// | gift | receiving | sending (then `SaveGameData`) |
// |---|---|---|
// | money | `Predef AddBCDPredef`, as Pay Day | `Predef SubBCDPredef`, as a Poké Mart purchase |
// | item | `AddItemToInventory`, as an NPC gift | `RemoveItemFromInventory`, as tossing |
// | Pokémon | `AddEnemyMonToPlayerParty`, as the Trade Center | `RemovePokemon`, as the Trade Center |
//
// With a full party a received Pokémon goes to the current box, where the game has no routine
// for a ready-made mon: we append it in Bill's PC's layout and mark it in the Pokédex with the
// game's `FlagActionPredef`. A sender's game saves straight after the gift leaves it, so
// reloading an older save can't keep what was given away.
import type { Gift, GiftedMon } from "@pokehd/protocol";
import { isKeyItem, pokedexNumber, SYMBOLS, type SymbolName } from "@pokehd/rom";
import type { GameBoy } from "../core.ts";
import { CARRY, type Job, type Step } from "./safepoint.ts";

export const PARTYMON_STRUCT_LENGTH = 44;
export const BOXMON_STRUCT_LENGTH = 33;
export const NAME_LENGTH = 11;
const PARTY_LENGTH = 6;
export const MONS_PER_BOX = 20;
export const BAG_ITEM_CAPACITY = 20;
export const MAX_MONEY = 999_999;
const FLAG_SET = 1;
const MON_LEVEL = 33;
const MON_BOX_LEVEL = 3;
const TERMINATOR = 0x50;
const NUM_ATTACKS = 165;

/** Where a received gift went. */
export type Landed = "money" | "bag" | "party" | "box";

const addr = (name: SymbolName) => SYMBOLS[name].address;

export const fromBcd = (bytes: ArrayLike<number>) =>
  Array.from(bytes).reduce((n, b) => n * 100 + (b >> 4) * 10 + (b & 0xf), 0);
export function toBcd(n: number, length: number): Uint8Array {
  const out = new Uint8Array(length);
  for (let i = length - 1; i >= 0; i--, n = Math.floor(n / 100)) {
    const two = n % 100;
    out[i] = (Math.floor(two / 10) << 4) | two % 10;
  }
  return out;
}

/** A predef's ID: its entry in `PredefPointers`, labelled `<routine>Predef` by `add_predef`. */
function predef(name: "AddBCDPredefPredef" | "SubBCDPredefPredef" | "FlagActionPredefPredef" | "IndexToPokedexPredef"): number {
  return (addr(name) - addr("PredefPointers")) / 3;
}

const writeAll = (gb: GameBoy, address: number, bytes: ArrayLike<number>) => {
  for (let i = 0; i < bytes.length; i++) gb.write(address + i, bytes[i]!);
};

/**
 * Why a gift can't be accepted whatever the receiver's game holds, or undefined. The sender's
 * client builds it from their own save, but the receiver doesn't trust that: the species must
 * be real (no glitch slots), the level 1–100, the moves real and both names terminated; key
 * items can't be gifted (D20).
 */
export function invalidGift(rom: Uint8Array, gift: Gift): string | undefined {
  switch (gift.kind) {
    case "money":
      return gift.amount >= 1 && gift.amount <= MAX_MONEY ? undefined : "amount";
    case "item":
      return isKeyItem(rom, gift.item) ? "key item" : undefined;
    case "mon":
      return invalidMon(rom, gift.mon);
  }
}

function invalidMon(rom: Uint8Array, mon: GiftedMon): string | undefined {
  const { data, ot, nick } = mon;
  if (data.length !== PARTYMON_STRUCT_LENGTH) return "struct length";
  if (ot.length !== NAME_LENGTH || !ot.includes(TERMINATOR)) return "OT name";
  if (nick.length !== NAME_LENGTH || !nick.includes(TERMINATOR)) return "nickname";
  if (!pokedexNumber(rom, data[0]!)) return "species";
  // Only the party level: _AddPartyMon leaves the box-level byte 0 until the mon is deposited.
  const level = data[MON_LEVEL]!;
  if (level < 1 || level > 100) return "level";
  if (data.slice(8, 12).some((move) => move > NUM_ATTACKS)) return "move";
  return undefined;
}

export interface ReceiveCallbacks {
  landed(where: Landed): void;
  /** The gift can't land yet ("bag full", …). Called each idle pass it's held. */
  held?(reason: string): void;
}

/** The job that puts a received gift into the game. `done(false)` if the game turned it down at the last moment. */
export function receiveJob(gift: Gift, on: ReceiveCallbacks): Job {
  const job = buildReceiveJob(gift, on.landed);
  job.held = on.held;
  return job;
}

function buildReceiveJob(gift: Gift, landed: (where: Landed) => void): Job {
  switch (gift.kind) {
    case "money": {
      const money = addr("wPlayerMoney");
      const hMoney = addr("hMoney");
      return {
        scratch: [[hMoney, 3]],
        // AddBCD saturates at 999999; hold rather than let a gift silently lose money.
        check: (gb) =>
          fromBcd(gb.readBytes(money, 3)) + gift.amount > MAX_MONEY ? { hold: "money would pass ¥999,999" } : undefined,
        steps: [
          {
            routine: "Predef",
            before: (gb) => writeAll(gb, hMoney, toBcd(gift.amount, 3)),
            // As Pay Day: de = wPlayerMoney + 2, hl = source + 2, c = 3 bytes.
            registers: () => ({ af: predef("AddBCDPredefPredef") << 8, de: money + 2, hl: hMoney + 2, bc: 3 }),
            after: () => landed("money"),
          },
        ],
      };
    }
    case "item": {
      const bag = addr("wNumBagItems");
      return {
        scratch: [[addr("wCurItem"), 1], [addr("wItemQuantity"), 1]],
        // With a free slot the game fills a stack to 99 and starts a new one, so only a full bag
        // can refuse; checking first means AddItemToInventory never has to.
        check: (gb) => {
          if (gb.read(bag) < BAG_ITEM_CAPACITY) return undefined;
          for (let i = 0; i < gb.read(bag); i++) {
            if (gb.read(bag + 1 + i * 2) === gift.item && gb.read(bag + 2 + i * 2) + gift.quantity <= 99) return undefined;
          }
          return { hold: "bag full" };
        },
        steps: [
          {
            routine: "AddItemToInventory",
            before: (gb) => {
              gb.write(addr("wCurItem"), gift.item);
              gb.write(addr("wItemQuantity"), gift.quantity);
            },
            registers: () => ({ hl: bag }),
            after: (_gb, out) => {
              if (!(out.af & CARRY)) return false;
              landed("bag");
            },
          },
        ],
      };
    }
    case "mon":
      return monJob(gift.mon, landed);
  }
}

function monJob(mon: GiftedMon, landed: (where: Landed) => void): Job {
  const species = mon.data[0]!;
  const loaded = addr("wLoadedMon");
  const ot = addr("wEnemyMon1OT");
  const nick = addr("wEnemyMon1Nick");

  // The Trade Center's own path: struct in wLoadedMon, OT and nickname in the enemy slots.
  const toParty: Step = {
    routine: "AddEnemyMonToPlayerParty",
    before: (gb) => {
      writeAll(gb, loaded, mon.data);
      writeAll(gb, ot, mon.ot);
      writeAll(gb, nick, mon.nick);
      gb.write(addr("wWhichPokemon"), 0);
      gb.write(addr("wCurPartySpecies"), species);
    },
    after: (_gb, out) => {
      if (out.af & CARRY) return false; // party full after all
      landed("party");
    },
  };

  // Bill's PC's deposit (`_MoveMon` PARTY_TO_BOX): the first 33 bytes with the box level set
  // from the party level, then OT and nickname; then seen and owned, as the trade routine does.
  const deposit = (gb: GameBoy) => {
    const n = gb.read(addr("wBoxCount"));
    gb.write(addr("wBoxCount"), n + 1);
    gb.write(addr("wBoxSpecies") + n, species);
    gb.write(addr("wBoxSpecies") + n + 1, 0xff);
    const box = mon.data.slice(0, BOXMON_STRUCT_LENGTH);
    box[MON_BOX_LEVEL] = mon.data[MON_LEVEL]!;
    writeAll(gb, addr("wBoxMons") + n * BOXMON_STRUCT_LENGTH, box);
    writeAll(gb, addr("wBoxMonOT") + n * NAME_LENGTH, mon.ot);
    writeAll(gb, addr("wBoxMonNicks") + n * NAME_LENGTH, mon.nick);
    gb.write(addr("wPokedexNum"), species);
  };
  const dexFlag = (list: "wPokedexOwned" | "wPokedexSeen"): Step => ({
    routine: "Predef",
    registers: (gb) => ({
      af: predef("FlagActionPredefPredef") << 8,
      hl: addr(list),
      bc: (FLAG_SET << 8) | (gb.read(addr("wPokedexNum")) - 1),
    }),
  });
  const toBox: Step[] = [
    { routine: "Predef", before: deposit, registers: () => ({ af: predef("IndexToPokedexPredef") << 8 }) },
    dexFlag("wPokedexOwned"),
    { ...dexFlag("wPokedexSeen"), after: () => landed("box") },
  ];

  const job: Job = {
    scratch: [
      [loaded, PARTYMON_STRUCT_LENGTH],
      [ot, NAME_LENGTH],
      [nick, NAME_LENGTH],
      [addr("wWhichPokemon"), 1],
      [addr("wCurPartySpecies"), 1],
      [addr("wPokedexNum"), 1],
    ],
    check: (gb) => {
      if (gb.read(addr("wPartyCount")) < PARTY_LENGTH) job.steps = [toParty];
      else if (gb.read(addr("wBoxCount")) < MONS_PER_BOX) job.steps = toBox;
      else return { hold: "party and box full" };
      return undefined;
    },
    steps: [toParty],
  };
  return job;
}

/** What to take out of the sender's game. `slot` is the index in the bag or party. */
export type GiftSpec =
  | { kind: "money"; amount: number }
  | { kind: "item"; slot: number; item: number; quantity: number }
  | { kind: "mon"; slot: number; species: number };

export type TakeResult = { ok: true; gift: Gift } | { ok: false; reason: string };

/** The game's own save (what the start menu's SAVE calls), far-called through `Bankswitch`. */
const saveGame: Step = {
  routine: "Bankswitch",
  registers: () => ({ bc: SYMBOLS.SaveGameData.bank << 8, hl: SYMBOLS.SaveGameData.address }),
};

/**
 * The job that takes a gift out of the sender's game and saves (D20). The spec is checked
 * against the game as it is at the idle point, since the player may have used the item or
 * reordered the party since choosing; a mismatch drops the job with a reason.
 */
export function takeJob(rom: Uint8Array, spec: GiftSpec, done: (result: TakeResult) => void): Job {
  let gift: Gift | undefined;
  let failure = "";
  const fail = (reason: string) => ((failure = reason), { drop: reason });
  const job: Job = {
    scratch: [],
    steps: [],
    done: (completed) => done(completed && gift ? { ok: true, gift } : { ok: false, reason: failure || "the game refused" }),
  };
  switch (spec.kind) {
    case "money": {
      const hMoney = addr("hMoney");
      job.scratch = [[hMoney, 3]];
      job.check = (gb) => {
        if (spec.amount < 1 || spec.amount > MAX_MONEY) return fail("amount");
        if (fromBcd(gb.readBytes(addr("wPlayerMoney"), 3)) < spec.amount) return fail("not enough money");
        gift = { kind: "money", amount: spec.amount };
        return undefined;
      };
      job.steps = [
        {
          routine: "Predef",
          before: (gb) => writeAll(gb, hMoney, toBcd(spec.amount, 3)),
          // As a Poké Mart purchase: [de] -= [hl], 3 BCD bytes.
          registers: () => ({ af: predef("SubBCDPredefPredef") << 8, de: addr("wPlayerMoney") + 2, hl: hMoney + 2, bc: 3 }),
        },
        saveGame,
      ];
      break;
    }
    case "item": {
      const bag = addr("wNumBagItems");
      job.scratch = [[addr("wWhichPokemon"), 1], [addr("wItemQuantity"), 1]];
      job.check = (gb) => {
        if (spec.slot >= gb.read(bag) || gb.read(bag + 1 + spec.slot * 2) !== spec.item) return fail("item moved");
        if (isKeyItem(rom, spec.item)) return fail("key item");
        if (spec.quantity < 1 || gb.read(bag + 2 + spec.slot * 2) < spec.quantity) return fail("not enough");
        gift = { kind: "item", item: spec.item, quantity: spec.quantity };
        return undefined;
      };
      job.steps = [
        {
          routine: "RemoveItemFromInventory",
          before: (gb) => {
            gb.write(addr("wWhichPokemon"), spec.slot);
            gb.write(addr("wItemQuantity"), spec.quantity);
          },
          registers: () => ({ hl: bag }),
        },
        saveGame,
      ];
      break;
    }
    case "mon": {
      job.scratch = [[addr("wWhichPokemon"), 1], [addr("wRemoveMonFromBox"), 1]];
      job.check = (gb) => {
        const count = gb.read(addr("wPartyCount"));
        if (spec.slot >= count || gb.read(addr("wPartySpecies") + spec.slot) !== spec.species) return fail("party changed");
        // The PC won't deposit the last Pokémon either.
        if (count < 2) return fail("last Pokémon");
        gift = {
          kind: "mon",
          mon: {
            data: [...gb.readBytes(addr("wPartyMons") + spec.slot * PARTYMON_STRUCT_LENGTH, PARTYMON_STRUCT_LENGTH)],
            ot: [...gb.readBytes(addr("wPartyMonOT") + spec.slot * NAME_LENGTH, NAME_LENGTH)],
            nick: [...gb.readBytes(addr("wPartyMonNicks") + spec.slot * NAME_LENGTH, NAME_LENGTH)],
          },
        };
        const invalid = invalidMon(rom, gift.mon);
        return invalid ? fail(invalid) : undefined;
      };
      job.steps = [
        {
          routine: "RemovePokemon",
          before: (gb) => {
            gb.write(addr("wWhichPokemon"), spec.slot);
            gb.write(addr("wRemoveMonFromBox"), 0);
          },
        },
        saveGame,
      ];
      break;
    }
  }
  return job;
}
