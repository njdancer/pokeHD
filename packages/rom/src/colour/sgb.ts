import { MAP_NAMES, TILESET_NAMES } from "../generated/names.ts";
import { romOffset, SYMBOLS } from "../symbols.ts";
import { pokedexNumber } from "../text/names.ts";
import type { MapId } from "../world/types.ts";

// The Super Game Boy palettes the game sends (D11): SuperPalettes in data/sgb/sgb_palettes.asm,
// four RGB555 colours each, lightest first. The overworld paints the whole screen, sprites
// included, with one of them, picked per map by SetPal_Overworld (engine/gfx/palettes.asm).

/** Four colours as 0xRRGGBB, colour 0 (lightest) to 3 (darkest), in the order the game sends them. */
export type SgbPalette = readonly [number, number, number, number];

/** PAL_* constants (constants/palette_constants.asm) this codebase uses. */
export const SGB_PAL = {
  ROUTE: 0x00,
  PALLET: 0x01,
  VIRIDIAN: 0x02,
  PEWTER: 0x03,
  CERULEAN: 0x04,
  LAVENDER: 0x05,
  VERMILION: 0x06,
  CELADON: 0x07,
  FUCHSIA: 0x08,
  CINNABAR: 0x09,
  INDIGO: 0x0a,
  SAFFRON: 0x0b,
  MEWMON: 0x10,
  REDMON: 0x12,
  GRAYMON: 0x19,
  CAVE: 0x23,
} as const;

/** NUM_SGB_PALS. */
export const SGB_PALETTE_COUNT = 0x25;

/** An RGB555 channel (0–31) widened to 8 bits the usual way, so 31 is 255. */
const widen = (v: number) => (v << 3) | (v >> 2);

export function readSgbPalettes(rom: Uint8Array): SgbPalette[] {
  const base = romOffset(SYMBOLS.SuperPalettes);
  return Array.from({ length: SGB_PALETTE_COUNT }, (_, p) => {
    const colours = [0, 1, 2, 3].map((c) => {
      const i = base + p * 8 + c * 2;
      const v = rom[i]! | (rom[i + 1]! << 8);
      return (widen(v & 31) << 16) | (widen((v >> 5) & 31) << 8) | widen((v >> 10) & 31);
    });
    return colours as unknown as SgbPalette;
  });
}

const mapId = (name: string) => MAP_NAMES.indexOf(name);
/** The towns come first; their palette ID is the map ID + 1 (NUM_CITY_MAPS). */
const NUM_CITY_MAPS = mapId("SAFFRON_CITY") + 1;
/** Maps from here on are indoors (buildings, caves, gates); before it, towns and routes. */
export const FIRST_INDOOR_MAP = mapId("REDS_HOUSE_1F");
const CERULEAN_CAVE_2F = mapId("CERULEAN_CAVE_2F");
const CERULEAN_CAVE_1F = mapId("CERULEAN_CAVE_1F");
const LORELEIS_ROOM = mapId("LORELEIS_ROOM");
const BRUNOS_ROOM = mapId("BRUNOS_ROOM");
const CEMETERY = TILESET_NAMES.indexOf("CEMETERY");
const CAVERN = TILESET_NAMES.indexOf("CAVERN");

/**
 * The palette SetPal_Overworld picks. Buildings and most dungeons take the palette of the town
 * or route outside (`lastMap`, wLastMap); without it they fall back to the route palette.
 */
export function overworldPalette(map: MapId, tileset: number, lastMap?: MapId): number {
  if (tileset === CEMETERY) return SGB_PAL.GRAYMON;
  if (tileset === CAVERN) return SGB_PAL.CAVE;
  let town = map;
  if (map >= FIRST_INDOOR_MAP) {
    if (map >= CERULEAN_CAVE_2F && map <= CERULEAN_CAVE_1F) return SGB_PAL.CAVE;
    if (map === BRUNOS_ROOM) return SGB_PAL.CAVE;
    // Lorelei's room asks for palette 0 the same way a town does: PAL_ROUTE.
    if (map === LORELEIS_ROOM) return SGB_PAL.ROUTE;
    town = lastMap ?? NUM_CITY_MAPS;
  }
  return town < NUM_CITY_MAPS ? town + 1 : SGB_PAL.ROUTE;
}

/**
 * The palette a battle gives a Pokémon (DeterminePaletteID in engine/gfx/palettes.asm): its
 * MonsterPalettes entry by Pokédex number, Ditto's grey once it has transformed. Species 0, an
 * empty slot, is MonsterPalettes' first entry: the trainers' palette.
 */
export function battlePalette(rom: Uint8Array, species: number, transformed = false): number {
  if (transformed) return SGB_PAL.GRAYMON;
  const dex = species === 0 ? 0 : pokedexNumber(rom, species);
  return rom[romOffset(SYMBOLS.MonsterPalettes) + dex] ?? SGB_PAL.MEWMON;
}
