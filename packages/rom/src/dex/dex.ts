// What the HD Pokédex (p2-dex) shows, read from the ROM: each species' Pokédex entry, types and
// front picture; where wild Pokémon live; trainer classes and their pictures; and the town map's
// place names and drawing. Formats are documented in vendor/pokered (data/pokemon/dex_entries.asm,
// data/pokemon/base_stats/*.asm, data/wild/*.asm, data/trainers/*.asm,
// data/maps/town_map_entries.asm, engine/items/town_map.asm).
import { SYMBOLS } from "../generated/symbols.ts";
import { romOffset, type RomSymbol } from "../symbols.ts";
import { decompressPic, type Pic } from "../explore/pic.ts";
import { decode2bpp } from "../world/parse.ts";
import { decodeText, monName, pokedexNumber } from "../text/names.ts";
import { FONT_CHARS } from "../text/charmap.ts";

export type { Pic };

/** Species in the Pokédex. */
export const DEX_SIZE = 151;
/** Internal species indices run 1–190, with gaps (MissingNo.) between them. */
const SPECIES_SLOTS = 190;
/** Bytes per species in `BaseStats` (BASE_DATA_SIZE). */
const BASE_DATA_SIZE = 28;
const TERMINATOR = 0x50;
/** `text_far`: a pointer to the entry's words in another bank. */
const TEXT_FAR = 0x17;
/** Line breaks inside a Pokédex entry: `next`, `page`, and `dex` (the end). */
const NEXT = 0x4e;
const PAGE = 0x49;
const DEX_END = 0x5f;

/** A Pokédex entry: everything the game's data page shows, and its picture's place. */
export interface DexEntry {
  /** Pokédex number, 1–151. */
  dex: number;
  /** Internal species index (wCurPartySpecies), as the game stores Pokémon. */
  species: number;
  name: string;
  /** "SEED", shown as "SEED POKéMON". */
  category: string;
  heightFeet: number;
  heightInches: number;
  /** In tenths of a pound, as the game keeps it. */
  weightTenths: number;
  /** The entry's words: pages of lines, as the data page shows them. */
  pages: string[][];
  /** One or two type names ("GRASS", "POISON"). */
  types: string[];
  /** Base HP, Attack, Defense, Speed, Special. */
  stats: { hp: number; attack: number; defense: number; speed: number; special: number };
  /** Where the front picture is, for `dexPicture`. */
  picture: RomSymbol;
}

const word = (rom: Uint8Array, at: number) => rom[at]! | (rom[at + 1]! << 8);
const inBank = (bank: number, address: number) => romOffset({ bank, address });

/** Internal species index for each Pokédex number (index 0 unused). */
export function dexToSpecies(rom: Uint8Array): number[] {
  const out = Array.from({ length: DEX_SIZE + 1 }, () => 0);
  for (let species = 1; species <= SPECIES_SLOTS; species++) {
    const dex = pokedexNumber(rom, species);
    if (dex >= 1 && dex <= DEX_SIZE && !out[dex]) out[dex] = species;
  }
  return out;
}

/**
 * The bank of a species' pictures, as UncompressMonSprite (home/pics.asm) picks it: Mew alone,
 * then five "Pics" banks by internal index (the thresholds are TANGELA, MOLTRES, BEEDRILL + 1 and
 * STARMIE; the first bank is RhydonPicFront's).
 */
function picBank(species: number): number {
  if (species === 0x15) return SYMBOLS.MewPicFront.bank;
  const first = SYMBOLS.RhydonPicFront.bank;
  if (species <= 0x1e) return first;
  if (species <= 0x49) return first + 1;
  if (species <= 0x73) return first + 2;
  if (species <= 0x98) return first + 3;
  return first + 4;
}

/** Decodes a Pokédex entry's words (`text` … `next` … `page` … `dex`) into pages of lines. */
function dexWords(rom: Uint8Array, at: number): string[][] {
  const pages: string[][] = [[""]];
  for (let i = at; i < at + 200; i++) {
    const code = rom[i]!;
    if (code === DEX_END || code === TERMINATOR) break;
    const page = pages.at(-1)!;
    if (code === NEXT) page.push("");
    else if (code === PAGE) pages.push([""]);
    else if (code >= 0x80) page[page.length - 1] += FONT_CHARS[code - 0x80];
    else if (code === 0x7f) page[page.length - 1] += " ";
    else if (code === 0x54) page[page.length - 1] += "POKé";
    // $00 (`text`) starts the words; anything else is a control code with nothing to show.
  }
  return pages;
}

/** The name of a type by its ID (TypeNames; unused IDs read as NORMAL, as in the game). */
export function typeName(rom: Uint8Array, type: number): string {
  const table = SYMBOLS.TypeNames;
  const at = inBank(table.bank, word(rom, romOffset(table) + type * 2));
  return decodeText(rom.subarray(at, at + 12));
}

/** One Pokédex entry by Pokédex number (1–151). */
export function dexEntry(rom: Uint8Array, dex: number, species = dexToSpecies(rom)[dex]!): DexEntry {
  const base = dex === DEX_SIZE ? romOffset(SYMBOLS.MewBaseStats) : romOffset(SYMBOLS.BaseStats) + (dex - 1) * BASE_DATA_SIZE;
  const types = [rom[base + 6]!, rom[base + 7]!];
  const pointers = SYMBOLS.PokedexEntryPointers;
  let at = inBank(pointers.bank, word(rom, romOffset(pointers) + (species - 1) * 2));
  const start = at;
  while (rom[at] !== TERMINATOR && at < start + 16) at++;
  const category = decodeText(rom.subarray(start, at));
  at++;
  const heightFeet = rom[at]!;
  const heightInches = rom[at + 1]!;
  const weightTenths = word(rom, at + 2);
  const far = rom[at + 4] === TEXT_FAR ? inBank(rom[at + 7]!, word(rom, at + 5)) : -1;
  return {
    dex,
    species,
    name: monName(rom, species),
    category,
    heightFeet,
    heightInches,
    weightTenths,
    pages: far >= 0 ? dexWords(rom, far) : [],
    types: types[0] === types[1] ? [typeName(rom, types[0]!)] : types.map((t) => typeName(rom, t)),
    stats: { hp: rom[base + 1]!, attack: rom[base + 2]!, defense: rom[base + 3]!, speed: rom[base + 4]!, special: rom[base + 5]! },
    picture: { bank: picBank(species), address: word(rom, base + 11) },
  };
}

/** All 151 entries, in Pokédex order. */
export function dexEntries(rom: Uint8Array): DexEntry[] {
  const species = dexToSpecies(rom);
  return Array.from({ length: DEX_SIZE }, (_, i) => dexEntry(rom, i + 1, species[i + 1]));
}

/** A front picture (Pokémon or trainer), decompressed: colour numbers 0–3 per pixel. */
export function dexPicture(rom: Uint8Array, at: RomSymbol): Pic {
  return decompressPic(rom, romOffset(at));
}

/** One slot of a wild encounter table. */
export interface WildSlot {
  level: number;
  species: number;
}

/** A map's wild Pokémon: grass (or cave floor) and water, ten slots each, with their rates. */
export interface WildArea {
  map: number;
  grassRate: number;
  grass: WildSlot[];
  waterRate: number;
  water: WildSlot[];
}

/** Every map with wild Pokémon (WildDataPointers, ended by $ffff). */
export function wildAreas(rom: Uint8Array): WildArea[] {
  const table = SYMBOLS.WildDataPointers;
  const base = romOffset(table);
  const out: WildArea[] = [];
  for (let map = 0; map < 256; map++) {
    const pointer = word(rom, base + map * 2);
    if (pointer === 0xffff) break;
    let at = inBank(table.bank, pointer);
    const slots = (rate: number) => {
      if (!rate) return [];
      const list = Array.from({ length: 10 }, (_, i) => ({ level: rom[at + i * 2]!, species: rom[at + i * 2 + 1]! }));
      at += 20;
      return list;
    };
    const grassRate = rom[at++]!;
    const grass = slots(grassRate);
    const waterRate = rom[at++]!;
    const water = slots(waterRate);
    if (grass.length || water.length) out.push({ map, grassRate, grass, waterRate, water });
  }
  return out;
}

/** A trainer class: its name ("BUG CATCHER") and picture. Class IDs start at 1. */
export interface TrainerClass {
  id: number;
  name: string;
  picture: RomSymbol;
}

/** Trainer classes (TrainerNames, TrainerPicAndMoneyPointers): 47 of them. */
export function trainerClasses(rom: Uint8Array): TrainerClass[] {
  const names = romOffset(SYMBOLS.TrainerNames);
  const pics = romOffset(SYMBOLS.TrainerPicAndMoneyPointers);
  // The pictures share one bank ("Trainer Pics"); the player's rival's sits with the others.
  const bank = SYMBOLS.YoungsterPic.bank;
  const out: TrainerClass[] = [];
  let at = names;
  for (let id = 1; id <= 47; id++) {
    const start = at;
    while (rom[at] !== TERMINATOR && at < start + 16) at++;
    out.push({ id, name: decodeText(rom.subarray(start, at)), picture: { bank, address: word(rom, pics + (id - 1) * 5) } });
    at++;
  }
  return out;
}

/** Where a map sits on the town map, in its 8-pixel cells, and its name ("ROUTE 1"). */
export interface TownMapPlace {
  x: number;
  y: number;
  name: string;
}

/** Maps before this are towns and routes (with their own town map entry); after, indoors. */
const FIRST_INDOOR = 0x25;

/** A map's town map place (LoadTownMapEntry): its own entry outdoors, its group's indoors. */
export function townMapPlace(rom: Uint8Array, map: number): TownMapPlace {
  const bank = SYMBOLS.ExternalMapEntries.bank;
  let at: number;
  if (map < FIRST_INDOOR) at = romOffset(SYMBOLS.ExternalMapEntries) + map * 3;
  else {
    at = romOffset(SYMBOLS.InternalMapEntries);
    while (rom[at] !== 0xff && map >= rom[at]!) at += 4;
    at++;
  }
  const coords = rom[at]!;
  const name = inBank(bank, word(rom, at + 1));
  return { x: coords & 0xf, y: coords >> 4, name: decodeText(rom.subarray(name, name + 24)) };
}

/** The town map: 20×18 tiles (LoadTownMap's run lengths) and the 2bpp tiles they index. */
export interface TownMap {
  width: 20;
  height: 18;
  /** Tile number (0–15, into `tiles`) per cell, row-major. */
  cells: Uint8Array;
  /** 16 tiles of 8×8 colour numbers (0–3). */
  tiles: Uint8Array[];
}

export function townMap(rom: Uint8Array): TownMap {
  const cells = new Uint8Array(20 * 18);
  let at = romOffset(SYMBOLS.CompressedMap);
  for (let i = 0; rom[at] && i < cells.length; at++) {
    const run = rom[at]!;
    for (let n = run & 0xf; n > 0 && i < cells.length; n--) cells[i++] = run >> 4;
  }
  const gfx = romOffset(SYMBOLS.WorldMapTileGraphics);
  const tiles = Array.from({ length: 16 }, (_, t) => decode2bpp(rom.subarray(gfx + t * 16, gfx + t * 16 + 16)));
  return { width: 20, height: 18, cells, tiles };
}
