// What the Pokédex menu shows of the game: the team, the bag, the PC box, money, badges and the
// rest, decoded from WRAM. The page reads `SNAPSHOT_RANGES` (EmulatorHost.read) and decodes the
// bytes here, so nothing extra runs in the emulator per frame. Layouts are party_struct and
// box_struct in macros/ram.asm, and ram/wram.asm.
import { decodeText, SYMBOLS, type SymbolName } from "@pokehd/rom";
import type { Watch } from "../protocol.ts";
import { fromBcd } from "../gifts/gifts.ts";
import { monStatus } from "../state/battle-decode.ts";
import type { MonStatus } from "../state/battle.ts";

const PARTY_LENGTH = 6;
const PARTYMON = 44;
const BOXMON = 33;
const NAME = 11;
const MONS_PER_BOX = 20;
const BAG_CAPACITY = 20;
const PC_ITEM_CAPACITY = 50;
const DEX_FLAG_BYTES = 19;

export interface MonMove {
  move: number;
  /** PP left (the low 6 bits; the top two count PP Ups). */
  pp: number;
  ppUps: number;
}

export interface TeamMon {
  species: number;
  nick: string;
  level: number;
  hp: number;
  maxHp: number;
  status: MonStatus;
  moves: MonMove[];
  /** Trainer ID of the original trainer: someone else's if traded or gifted. */
  otId: number;
  ot: string;
  exp: number;
  stats: { attack: number; defense: number; speed: number; special: number };
}

export interface BoxMon {
  species: number;
  nick: string;
  level: number;
}

export interface BagItem {
  item: number;
  quantity: number;
}

export interface GameSnapshot {
  player: string;
  rival: string;
  playerId: number;
  money: number;
  /** Bits for BOULDERBADGE (0) … EARTHBADGE (7). */
  badges: number;
  team: TeamMon[];
  bag: BagItem[];
  /** The player's PC (items stored in a Pokémon Center). */
  pcItems: BagItem[];
  /** The current box in Bill's PC (1–12). */
  boxNumber: number;
  box: BoxMon[];
  /** Pokédex flags, by Pokédex number (see `dexProgress`). */
  seen: Set<number>;
  owned: Set<number>;
  /** Species the game is showing a full Pokédex page for without owning them (Oak's starters). */
  onShow: Set<number>;
  /** wOptions: text speed, battle animations, battle style. */
  options: number;
  playTime: { hours: number; minutes: number; seconds: number };
  repelSteps: number;
  transport: "walk" | "bike" | "surf";
  map: number;
  x: number;
  y: number;
  inBattle: boolean;
  /** wIsInBattle: 1 is a wild battle, 2 a trainer's. */
  battleKind: "wild" | "trainer" | null;
  /**
   * wPlayerMonNumber: the party index of the Pokémon out in battle, in a battle (null otherwise).
   * Switching in battle never reorders the party, so this isn't always the leader (QA bug 58).
   * It still names a fainted Pokémon while the game asks who's next (ChooseNextMon sets it after).
   */
  battleMon: number | null;
}

const sym = (name: SymbolName, length: number): Watch => [SYMBOLS[name].address, length];

/** The ranges to read, in the order `decodeSnapshot` takes them. */
export const SNAPSHOT_RANGES: readonly Watch[] = [
  // wPartyCount, wPartySpecies (with its terminator) and wPartyMons are adjacent.
  sym("wPartyCount", 1 + PARTY_LENGTH + 1 + PARTY_LENGTH * PARTYMON),
  sym("wPartyMonOT", PARTY_LENGTH * NAME),
  sym("wPartyMonNicks", PARTY_LENGTH * NAME),
  sym("wNumBagItems", 1 + BAG_CAPACITY * 2),
  sym("wNumBoxItems", 1 + PC_ITEM_CAPACITY * 2),
  sym("wBoxCount", 1 + MONS_PER_BOX + 1 + MONS_PER_BOX * BOXMON),
  sym("wBoxMonNicks", MONS_PER_BOX * NAME),
  sym("wPlayerName", NAME),
  sym("wRivalName", NAME),
  sym("wPlayerID", 2),
  sym("wPlayerMoney", 3),
  sym("wObtainedBadges", 1),
  sym("wPokedexOwned", DEX_FLAG_BYTES),
  sym("wPokedexSeen", DEX_FLAG_BYTES),
  sym("wOptions", 1),
  // Hours, maxed, minutes, seconds.
  sym("wPlayTimeHours", 4),
  sym("wRepelRemainingSteps", 1),
  sym("wWalkBikeSurfState", 1),
  sym("wCurMap", 1),
  sym("wYCoord", 2),
  sym("wIsInBattle", 1),
  sym("wCurrentBoxNum", 1),
  sym("wPlayerMonNumber", 1),
];

const word = (b: Uint8Array, i: number) => ((b[i] ?? 0) << 8) | (b[i + 1] ?? 0);

function items(bytes: Uint8Array, capacity: number): BagItem[] {
  const n = Math.min(bytes[0] ?? 0, capacity);
  return Array.from({ length: n }, (_, i) => ({ item: bytes[1 + i * 2] ?? 0, quantity: bytes[2 + i * 2] ?? 0 }));
}

function flags(bytes: ArrayLike<number>): Set<number> {
  const out = new Set<number>();
  for (let n = 1; n <= 151; n++) if (((bytes[(n - 1) >> 3] ?? 0) >> ((n - 1) & 7)) & 1) out.add(n);
  return out;
}

/**
 * The player's Pokédex from wPokedexOwned and wPokedexSeen, by Pokédex number. The game never owns
 * a species it hasn't seen: catching, gifts, trades and evolution set both flags (add_mon.asm,
 * evos_moves.asm; a wild Pokémon is seen when the battle starts). The one exception is StarterDex
 * (engine/events/starter_dex.asm): looking at a Poké Ball in Oak's lab sets the owned bits of
 * 001, 002, 004 and 007 while ShowPokedexData shows the starter's page in full, then clears them.
 * Those species are `onShow`, not caught.
 */
export function dexProgress(ownedBytes: ArrayLike<number>, seenBytes: ArrayLike<number>): { seen: Set<number>; owned: Set<number>; onShow: Set<number> } {
  const seen = flags(seenBytes);
  const owned = new Set<number>();
  const onShow = new Set<number>();
  for (const n of flags(ownedBytes)) (seen.has(n) ? owned : onShow).add(n);
  return { seen, owned, onShow };
}

function teamMon(struct: Uint8Array, ot: Uint8Array, nick: Uint8Array): TeamMon {
  const moves: MonMove[] = [];
  for (let i = 0; i < 4; i++) {
    const move = struct[8 + i] ?? 0;
    if (!move) continue;
    const pp = struct[29 + i] ?? 0;
    moves.push({ move, pp: pp & 0x3f, ppUps: pp >> 6 });
  }
  return {
    species: struct[0] ?? 0,
    hp: word(struct, 1),
    status: monStatus(struct[4] ?? 0),
    moves,
    otId: word(struct, 12),
    exp: ((struct[14] ?? 0) << 16) | word(struct, 15),
    level: struct[33] ?? 0,
    maxHp: word(struct, 34),
    stats: { attack: word(struct, 36), defense: word(struct, 38), speed: word(struct, 40), special: word(struct, 42) },
    ot: decodeText(ot),
    nick: decodeText(nick),
  };
}

/**
 * How many entries of a mon list are whole: the count, cut at the first entry whose struct's
 * species isn't the species list's. _AddPartyMon (engine/pokemon/add_mon.asm) bumps the count and
 * writes the species list first, then asks for a nickname (AskName) and only then writes the
 * struct, so for the whole "give a nickname?" prompt after a catch the new last entry's struct is
 * stale (species 0 for a fresh slot). SwitchPartyMon and the box's add/remove are just as stepwise.
 */
function wholeCount(list: Uint8Array, capacity: number, structLength: number): number {
  const count = Math.min(list[0] ?? 0, capacity);
  const structs = 1 + capacity + 1;
  for (let i = 0; i < count; i++) {
    const species = list[1 + i] ?? 0;
    if (species === 0 || species === 0xff || list[structs + i * structLength] !== species) return i;
  }
  return count;
}

export function decodeSnapshot(bytes: readonly Uint8Array[]): GameSnapshot {
  const [party, partyOt, partyNicks, bag, pcItems, box, boxNicks, player, rival, id, money, badges, owned, seen, options, time, repel, transport, map, coords, battle, boxNumber, battleMon] =
    bytes as Uint8Array[];
  const teamCount = wholeCount(party!, PARTY_LENGTH, PARTYMON);
  const mons = 1 + PARTY_LENGTH + 1;
  const team = Array.from({ length: teamCount }, (_, i) =>
    teamMon(party!.subarray(mons + i * PARTYMON, mons + (i + 1) * PARTYMON), partyOt!.subarray(i * NAME, (i + 1) * NAME), partyNicks!.subarray(i * NAME, (i + 1) * NAME)),
  );
  const boxCount = wholeCount(box!, MONS_PER_BOX, BOXMON);
  const boxMons = 1 + MONS_PER_BOX + 1;
  return {
    player: decodeText(player!),
    rival: decodeText(rival!),
    playerId: word(id!, 0),
    money: fromBcd(money!),
    badges: badges![0] ?? 0,
    team,
    bag: items(bag!, BAG_CAPACITY),
    pcItems: items(pcItems!, PC_ITEM_CAPACITY),
    boxNumber: ((boxNumber![0] ?? 0) & 0x7f) + 1,
    box: Array.from({ length: boxCount }, (_, i) => {
      const s = box!.subarray(boxMons + i * BOXMON, boxMons + (i + 1) * BOXMON);
      return { species: s[0] ?? 0, level: s[3] ?? 0, nick: decodeText(boxNicks!.subarray(i * NAME, (i + 1) * NAME)) };
    }),
    ...dexProgress(owned!, seen!),
    options: options![0] ?? 0,
    playTime: { hours: time![0] ?? 0, minutes: time![2] ?? 0, seconds: time![3] ?? 0 },
    repelSteps: repel![0] ?? 0,
    transport: (["walk", "bike", "surf"] as const)[transport![0] ?? 0] ?? "walk",
    map: map![0] ?? 0,
    y: coords![0] ?? 0,
    x: coords![1] ?? 0,
    inBattle: (battle![0] ?? 0) !== 0,
    battleKind: battle![0] === 1 ? "wild" : battle![0] === 2 ? "trainer" : null,
    battleMon: (battle![0] ?? 0) !== 0 && (battleMon![0] ?? 0xff) < teamCount ? battleMon![0]! : null,
  };
}
