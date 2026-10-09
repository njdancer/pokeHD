// Pictures for the Pokédex, drawn from the player's ROM: Pokémon and trainer front pictures in
// their SGB colours, overworld people, the town map, and text in the game's own letters (for the
// pixel style). Cached per ROM, as data URLs, so React can show them as plain <img>s.
import {
  battlePalette,
  dexPicture,
  readGlyphs,
  readSgbPalettes,
  SGB_PAL,
  townMap,
  type Glyph,
  type Pic,
  type RomSymbol,
  type SgbPalette,
  type SpriteSheet,
} from "@pokehd/rom";

const cache = new WeakMap<Uint8Array, Map<string, string>>();

function cached(rom: Uint8Array, key: string, make: () => string): string {
  let map = cache.get(rom);
  if (!map) cache.set(rom, (map = new Map()));
  let url = map.get(key);
  if (url === undefined) map.set(key, (url = make()));
  return url;
}

const rgba = (c: number): [number, number, number] => [(c >> 16) & 255, (c >> 8) & 255, c & 255];

/** Draws colour numbers into a canvas: colour 0 transparent (pictures) or palette white. */
function paint(width: number, height: number, at: (x: number, y: number) => number, colours: readonly number[], clear = true): string {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d")!;
  const image = ctx.createImageData(width, height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const c = at(x, y);
      const i = (y * width + x) * 4;
      if (clear && c === 0) continue;
      const [r, g, b] = rgba(colours[c]!);
      image.data.set([r, g, b, 255], i);
    }
  }
  ctx.putImageData(image, 0, 0);
  return canvas.toDataURL();
}

const palettes: WeakMap<Uint8Array, SgbPalette[]> = new WeakMap();
function sgb(rom: Uint8Array): SgbPalette[] {
  let p = palettes.get(rom);
  if (!p) palettes.set(rom, (p = readSgbPalettes(rom)));
  return p;
}

/** A front picture as the game draws it (white is see-through), in the given SGB palette. */
function picture(rom: Uint8Array, at: RomSymbol, palette: number, flip: boolean): string {
  return cached(rom, `pic ${at.bank}:${at.address} ${palette} ${flip}`, () => {
    const pic: Pic = dexPicture(rom, at);
    const w = pic.width * 8;
    const read = (x: number, y: number) => {
      const sx = flip ? w - 1 - x : x;
      return pic.pixels[y * w + sx]!;
    };
    return paint(w, pic.height * 8, read, sgb(rom)[palette]!);
  });
}

/** A Pokémon's front picture, facing right the way the Pokédex shows it, in its own colours. */
export function monPicture(rom: Uint8Array, species: number, at: RomSymbol): string {
  return picture(rom, at, battlePalette(rom, species), true);
}

/** A trainer's front picture. */
export function trainerPicture(rom: Uint8Array, at: RomSymbol): string {
  return picture(rom, at, SGB_PAL.MEWMON, false);
}

/** One overworld person, standing facing the camera, in the given SGB palette. */
export function personPicture(rom: Uint8Array, sheet: SpriteSheet, palette: number): string {
  return cached(rom, `person ${sheet.id} ${palette}`, () => {
    // Frame 0 is standing down: tiles 0–3 as top-left, top-right, bottom-left, bottom-right.
    const read = (x: number, y: number) => {
      const t = (y >> 3) * 2 + (x >> 3);
      return sheet.tiles[t * 64 + (y & 7) * 8 + (x & 7)]!;
    };
    return paint(16, 16, read, sgb(rom)[palette]!);
  });
}

/** The town map in the town map's SGB colours. */
export function townMapPicture(rom: Uint8Array): string {
  return cached(rom, "town map", () => {
    const map = townMap(rom);
    const read = (x: number, y: number) => map.tiles[map.cells[(y >> 3) * 20 + (x >> 3)]!]![(y & 7) * 8 + (x & 7)]!;
    // SET_PAL_TOWN_MAP uses PAL_TOWNMAP ($0c), the pale greens and browns of the paper map.
    return paint(160, 144, read, sgb(rom)[0x0c]!, false);
  });
}

const glyphCache = new WeakMap<Uint8Array, Map<string, Glyph>>();
function glyphs(rom: Uint8Array): Map<string, Glyph> {
  let map = glyphCache.get(rom);
  if (!map) {
    map = new Map();
    for (const g of readGlyphs(rom)) if (!map.has(g.char)) map.set(g.char, g);
    glyphCache.set(rom, map);
  }
  return map;
}

/** A line of text in the game's own letters: 8 pixels a character, dark on transparent. */
export function pixelText(rom: Uint8Array, text: string, colour = 0x181010): string {
  return cached(rom, `text ${colour} ${text}`, () => {
    const table = glyphs(rom);
    // "POKé" and other multi-letter glyphs: match the longest first.
    const chars: (Glyph | null)[] = [];
    for (let i = 0; i < text.length; ) {
      const two = table.get(text.slice(i, i + 2));
      if (two && two.char.length === 2) {
        chars.push(two);
        i += 2;
        continue;
      }
      const ch = text[i]!;
      chars.push(ch === " " ? null : (table.get(ch) ?? table.get(ch.toUpperCase()) ?? null));
      i++;
    }
    const width = Math.max(1, chars.length * 8);
    const read = (x: number, y: number) => {
      const g = chars[x >> 3];
      if (!g) return 0;
      const row = y * 2;
      const bit = 7 - (x & 7);
      return (((g.tile[row + 1]! >> bit) & 1) << 1) | ((g.tile[row]! >> bit) & 1);
    };
    return paint(width, 8, read, [0, colour, colour, colour]);
  });
}
