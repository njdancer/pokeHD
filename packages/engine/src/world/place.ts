import { overworldPalette, SGB_PAL, type MapId, type SgbPalette, type WorldData } from "@pokehd/rom";
import { hexToLch, hueRamp } from "./colour.ts";
import type { Ramp } from "./palette.ts";
import { SPRITE_RAMP } from "./sprites.ts";

// Per-place colour from the ROM's Super Game Boy palettes (p1-colour, D11). On a Super Game Boy
// the overworld is one palette per town (routes share one): near-white, the town's colour, a pale
// blue and near-black, sprites included. Painting the HD world with those four colours would
// flatten it, so the town colour is used where it reads as the town's identity instead:
// - roofs take the town colour (Viridian green, Cerulean blue, Vermilion orange…);
// - people wear it, as they do on the Super Game Boy; the player keeps red (PAL_REDMON);
// - the whole frame is graded slightly toward it (`placeTint`, eased by the engine).
// Pallet Town's town colour is nearly white ("pallet"), so its roofs and grade stay neutral and
// its people wear the palette's pale blue.

export interface PlaceColours {
  /** The PAL_* palette the game picks here. */
  palette: number;
  /** The town colour (SGB colour 1) for the grade, as "#rrggbb"; null where it's near-grey. */
  tint: string | null;
  /** Ramps that replace `LABEL_RAMPS` entries for this place's tiles. */
  ramps: Partial<Record<"roof", Ramp>>;
  /** Sprite ramp for people and objects (DMG shades 0–3; shade 2 goes unused). */
  people: Ramp;
}

/** No place colours: the base label ramps and neutral people. */
export const PLAIN_COLOURS: PlaceColours = { palette: -1, tint: null, ramps: {}, people: SPRITE_RAMP };

/** Below this OKLCh chroma a palette's town colour counts as grey. */
const NEUTRAL_CHROMA = 0.04;

const cache = new WeakMap<readonly SgbPalette[], Map<number, PlaceColours>>();

/** The sprite ramp around one hue; `c` is the clothes' chroma. */
const peopleRamp = (h: number, c: number) =>
  hueRamp(h, [
    { l: 0.97, c: 0.02, lean: 30 },
    { l: 0.66, c, lean: 0 },
    { l: 0.46, c: c * 0.8, lean: -15 },
    { l: 0.2, c: 0.035, lean: -40 },
  ]);

/** What a palette gives the HD world. */
export function paletteColours(palettes: readonly SgbPalette[], id: number): PlaceColours {
  let byId = cache.get(palettes);
  if (!byId) cache.set(palettes, (byId = new Map()));
  let out = byId.get(id);
  if (out) return out;
  const [, town, other] = palettes[id] ?? [];
  const lch = town === undefined ? null : hexToLch(town);
  if (!lch || lch.c < NEUTRAL_CHROMA) {
    // No town colour: people wear the palette's other colour (Pallet Town's pale blue), so no
    // one is grey.
    const alt = other === undefined ? null : hexToLch(other);
    out = { palette: id, tint: null, ramps: {}, people: alt && alt.c >= NEUTRAL_CHROMA ? peopleRamp(alt.h, 0.12) : SPRITE_RAMP };
  } else {
    const c = Math.min(Math.max(lch.c * 1.1, 0.1), 0.17);
    out = {
      palette: id,
      tint: `#${town!.toString(16).padStart(6, "0")}`,
      ramps: {
        roof: hueRamp(lch.h, [
          { l: 0.92, c: 0.045, lean: 20 },
          { l: 0.66, c, lean: 0 },
          { l: 0.47, c: c * 0.85, lean: -15 },
          { l: 0.24, c: 0.05, lean: -40 },
        ]),
      },
      people: peopleRamp(lch.h, c * 0.9),
    };
  }
  byId.set(id, out);
  return out;
}

/** The colours for `map`; buildings take those of the town or route outside (`lastMap`). */
export function placeColours(world: WorldData, map: MapId, lastMap?: MapId): PlaceColours {
  const tileset = world.maps[map]?.tileset ?? 0;
  return paletteColours(world.sgbPalettes, overworldPalette(map, tileset, lastMap));
}

/** The player in red, from the red Pokémon palette (PAL_REDMON's main colour), wherever they are. */
export function playerRamp(world: WorldData): Ramp {
  const red = world.sgbPalettes[SGB_PAL.REDMON]?.[2];
  if (red === undefined) return SPRITE_RAMP;
  const { h } = hexToLch(red);
  return hueRamp(h, [
    { l: 0.97, c: 0.02, lean: 30 },
    { l: 0.6, c: 0.17, lean: 0 },
    { l: 0.45, c: 0.14, lean: -10 },
    { l: 0.2, c: 0.035, lean: -40 },
  ]);
}
