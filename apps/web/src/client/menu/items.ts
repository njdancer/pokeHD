// What the Pokédex menu says about items: a shelf for each (for the filters), the price the
// game's own table gives, and a line about what it does. Shelves and lines are our own labels;
// names and prices come from the ROM.
import { isKeyItem, itemName, MAP_NAMES, romOffset, SYMBOLS, type SymbolName } from "@pokehd/rom";
import { fromBcd } from "@pokehd/emu";

export type Shelf = "Healing" | "Balls" | "Battle" | "Travel" | "Machines" | "Key" | "Other";
export const SHELVES: Shelf[] = ["Healing", "Balls", "Battle", "Travel", "Machines", "Key", "Other"];

const HM01 = 0xc4;
const TM01 = 0xc9;
const BALLS = new Set([0x01, 0x02, 0x03, 0x04, 0x08]);
const HEALING = new Set([0x0b, 0x0c, 0x0d, 0x0e, 0x0f, 0x10, 0x11, 0x12, 0x13, 0x14, 0x34, 0x35, 0x36, 0x3c, 0x3d, 0x3e, 0x50, 0x51, 0x52, 0x53]);
const BATTLE = new Set([0x2e, 0x37, 0x3a, 0x41, 0x42, 0x43, 0x44, 0x33]);
const TRAVEL = new Set([0x1d, 0x1e, 0x38, 0x39, 0x06, 0x47, 0x4c, 0x4d, 0x4e, 0x49]);
/** Items whose USE asks for a move as well (PP restorers): not offered by the menu yet. */
const NEEDS_MOVE = new Set([0x4f, 0x50, 0x51]);

export function shelf(rom: Uint8Array, item: number): Shelf {
  if (item >= HM01) return "Machines";
  if (BALLS.has(item)) return "Balls";
  if (HEALING.has(item)) return "Healing";
  if (TRAVEL.has(item)) return "Travel";
  if (BATTLE.has(item)) return "Battle";
  if (isKeyItem(rom, item)) return "Key";
  return "Other";
}

/**
 * The game's price, as its GetItemPrice finds it: `ItemPrices` (3 BCD bytes per item), or for a
 * TM, GetMachinePrice's nybble in `TechnicalMachinePrices` (thousands: TM01's high nybble, TM02's
 * low…). 0 for an HM (GetMachinePrice gives none: they can't be sold) or no item.
 */
export function itemPrice(rom: Uint8Array, item: number): number {
  if (item >= TM01) {
    const tm = item - TM01;
    const byte = rom[romOffset(SYMBOLS.TechnicalMachinePrices) + (tm >> 1)]!;
    return (tm & 1 ? byte & 0x0f : byte >> 4) * 1000;
  }
  if (item >= HM01 || item < 1) return 0;
  const at = romOffset(SYMBOLS.ItemPrices) + (item - 1) * 3;
  return fromBcd(rom.subarray(at, at + 3));
}

/** A tileset list in the ROM, ended by $ff (EscapeRopeTilesets, BikeRidingTilesets). */
function tilesets(rom: Uint8Array, table: SymbolName): Set<number> {
  const out = new Set<number>();
  for (let i = romOffset(SYMBOLS[table]); i < rom.length && rom[i] !== 0xff; i++) out.add(rom[i]!);
  return out;
}

const AGATHAS_ROOM = MAP_NAMES.indexOf("AGATHAS_ROOM");
const ROUTE_23 = MAP_NAMES.indexOf("ROUTE_23");
const INDIGO_PLATEAU = MAP_NAMES.indexOf("INDIGO_PLATEAU");

/**
 * Whether an Escape Rope works here, by the game's own test (ItemUseEscapeRope): outside a battle,
 * anywhere but Agatha's room whose tileset (wCurMapTileset, the map header's) is in
 * EscapeRopeTilesets: forest, cemetery, cavern, facility and interior. Elsewhere it's "not the time".
 */
export function escapeRopeWorks(rom: Uint8Array, map: number, tileset: number): boolean {
  return map !== AGATHAS_ROOM && tilesets(rom, "EscapeRopeTilesets").has(tileset);
}

/**
 * Whether the game lets the player get on the bike here (IsBikeRidingAllowed): Route 23, the
 * Indigo Plateau, or a map whose tileset is in BikeRidingTilesets. Getting off works anywhere.
 */
export function bikeAllowed(rom: Uint8Array, map: number, tileset: number): boolean {
  return map === ROUTE_23 || map === INDIGO_PLATEAU || tilesets(rom, "BikeRidingTilesets").has(tileset);
}

export const niceItem = (rom: Uint8Array, item: number) => itemName(rom, item);

export function needsMove(item: number): boolean {
  return NEEDS_MOVE.has(item);
}

const LINES: Record<number, string> = {
  0x01: "Catches any wild Pokémon, every time.",
  0x02: "A very good ball for catching wild Pokémon.",
  0x03: "A good ball for catching wild Pokémon.",
  0x04: "Throw it at a wild Pokémon to catch it. Works better when it's weak.",
  0x06: "Twice as fast as walking. You can't ride it indoors.",
  0x0b: "Cures poison.",
  0x0c: "Heals a burn.",
  0x0d: "Thaws out a frozen Pokémon.",
  0x0e: "Wakes up a sleeping Pokémon.",
  0x0f: "Cures paralysis.",
  0x10: "Gives back all HP and cures everything.",
  0x11: "Gives back all HP.",
  0x12: "Gives one Pokémon 200 HP back.",
  0x13: "Gives one Pokémon 50 HP back.",
  0x14: "Gives one Pokémon 20 HP back.",
  0x1d: "Takes you straight out of a cave.",
  0x1e: "Wild Pokémon weaker than your leader stay away for 100 steps.",
  0x28: "Makes a Pokémon one level stronger.",
  0x34: "Cures any problem: poison, burns, sleep and the rest.",
  0x35: "Wakes up a fainted Pokémon with half its HP.",
  0x36: "Wakes up a fainted Pokémon with all its HP.",
  0x38: "Wild Pokémon weaker than your leader stay away for 200 steps.",
  0x39: "Wild Pokémon weaker than your leader stay away for 250 steps.",
  0x3c: "Gives one Pokémon 50 HP back.",
  0x3d: "Gives one Pokémon 60 HP back.",
  0x3e: "Gives one Pokémon 80 HP back.",
  0x45: "Holds the coins for the Game Corner's slots.",
  0x46: "A delivery for PROF. OAK.",
  0x47: "Beeps when an item is hidden nearby.",
  0x49: "A tune that wakes up a sleeping Pokémon.",
  0x4c: "Fish where you face the water. Only MAGIKARP bite.",
  0x4d: "Fish where you face the water. Better fish bite.",
  0x4e: "Fish where you face the water. The best fish bite.",
};

/** A line about the item, or a shelf's line. */
export function itemLine(rom: Uint8Array, item: number): string {
  const line = LINES[item];
  if (line) return line;
  if (item >= HM01 + 5) return "Teaches a Pokémon a move. Used up once taught.";
  if (item >= HM01) return "Teaches a Pokémon a move. Never runs out.";
  if (shelf(rom, item) === "Key") return "An important thing for your adventure.";
  return "";
}

/** "6:42", hours and minutes. */
export const playTime = (t: { hours: number; minutes: number }) => `${t.hours}:${String(t.minutes).padStart(2, "0")}`;
export const money = (n: number) => `₽${n.toLocaleString("en")}`;
