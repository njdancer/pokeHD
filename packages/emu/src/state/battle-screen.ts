// What the battle screen shows, read from the Game Boy's own screen buffers each frame: the two
// pictures as the game draws them (sent out, shrunk, flickering, sliding away, a Substitute),
// the sprites a move animation is drawing, the palette and scroll effects, and which 8×8 cells
// of the screen are scene (drawn in 3D instead), HUD (drawn as HD bars instead) or UI (text,
// menus: left to the Game Boy's pixels or HD text). Screen-driven, like text (D13), so every
// animation the game plays is mirrored without knowing anything about it. Tile layouts follow
// engine/battle/core.asm (DrawPlayerHUDAndHPBar, DrawEnemyHUDAndHPBar) and home/pics.asm.
import type { Watch } from "../protocol.ts";

/** The screen in tiles. */
const COLS = 20;
const ROWS = 18;
/** A picture is 7×7 tiles. */
export const PIC_TILES = 7;
export const PIC_PIXELS = PIC_TILES * 8;
/** Background tiles at $9000 (vFrontPic, then vBackPic): the two pictures, 7×7 tiles each. */
const PIC_TILE_COUNT = 2 * PIC_TILES * PIC_TILES;
/** OBJ tiles at $8000 (vSprites): the Poké Ball and the move animation tiles. */
const OBJ_TILE_COUNT = 0x80;
const BLANK = 0x7f;
/** Box-drawing tiles (constants/charmap.asm): ┌ ─ ┐ │. */
const BOX_TOP_LEFT = 0x79;
const BOX_HORIZONTAL = 0x7a;
const BOX_TOP_RIGHT = 0x7b;
const BOX_VERTICAL = 0x7c;

/** The screen hardware registers, rLCDC ($ff40) through rWX ($ff4b). */
const LCD_REGISTERS = 0xff40;

/**
 * The extra memory `BattleScreenReader` reads, alongside `BATTLE_WATCHES` (whose tile map it
 * also uses). About 3.8 KB a frame, so watch it only while a battle is on.
 */
export const BATTLE_SCREEN_WATCHES = {
  picTiles: [0x9000, PIC_TILE_COUNT * 16],
  objTiles: [0x8000, OBJ_TILE_COUNT * 16],
  oam: [0xfe00, 40 * 4],
  lcd: [LCD_REGISTERS, 12],
} as const satisfies Record<string, Watch>;

export type BattleScreenWatched = Record<keyof typeof BATTLE_SCREEN_WATCHES, Uint8Array> & { tileMap: Uint8Array };

export type Side = "player" | "enemy";

interface SideLayout {
  /** The first picture tile: the picture's tiles run down each column, then across. */
  first: number;
  /** The picture's home cell (top left) on the screen. */
  home: { x: number; y: number };
}
const SIDES: Record<Side, SideLayout> = {
  enemy: { first: 0x00, home: { x: 12, y: 0 } },
  player: { first: 0x31, home: { x: 1, y: 5 } },
};
/** How far a picture may slide from home, in tiles, and still count as that picture. */
const MAX_SLIDE = PIC_TILES;
/** Slides are counted by a key, (dy + SLIDE_KEY) * 64 + dx + SLIDE_KEY. */
const SLIDE_KEY = 32;

/**
 * Each HUD's cells, and two of its border tiles that only it draws, at fixed spots, so it counts
 * as shown only when it's intact on screen.
 */
const HUDS: Record<Side, { x0: number; y0: number; x1: number; y1: number; marks: [x: number, y: number, tile: number][] }> = {
  enemy: { x0: 0, y0: 0, x1: 11, y1: 3, marks: [[1, 3, 0x74], [10, 3, 0x78]] },
  player: { x0: 9, y0: 7, x1: 19, y1: 11, marks: [[18, 10, 0x73], [18, 11, 0x77]] },
};

/** One side's picture as drawn this frame. */
export interface BattlePicture {
  /**
   * 56×56 colour numbers (0–3, before rBGP), rows top-down; `NOT_DRAWN` where no picture tile is
   * on screen. Colour 0 connected to the edge is the picture's background.
   */
  pixels: Uint8Array;
  /** How far the picture's window sits from its home, in tiles. */
  dx: number;
  dy: number;
  /** Changes whenever `pixels` do. */
  version: number;
}
export const NOT_DRAWN = 0xff;

/** A sprite a move animation (or the Poké Ball) is drawing. */
export interface BattleObject {
  /** Top-left on the screen, in pixels. */
  x: number;
  y: number;
  height: 8 | 16;
  /** 8 × height colour numbers, flips applied, rows top-down; 0 is transparent. */
  pixels: Uint8Array;
  /** OBP0 or OBP1. */
  palette: 0 | 1;
}

/** 0: shown in 3D. 1: a HUD, drawn as HD bars. 2: text, menus and everything else. */
export const CELL_SCENE = 0;
export const CELL_HUD = 1;
export const CELL_UI = 2;

export interface BattleScreen {
  /**
   * True while the screen shows the battle (both pictures' windows, HUDs, the text box). False
   * during the transition into a battle and on full-screen menus (party, Pokédex, evolution).
   */
  battle: boolean;
  enemy: BattlePicture | null;
  player: BattlePicture | null;
  objects: BattleObject[];
  /** Per cell, 20×18 row-major: CELL_SCENE, CELL_HUD or CELL_UI. All UI when `battle` is false. */
  cells: Uint8Array;
  /** Which HUDs are on screen, intact. */
  huds: Record<Side, boolean>;
  /** rBGP, rOBP0, rOBP1. */
  palettes: [bgp: number, obp0: number, obp1: number];
  /**
   * Where the tile map's top-left corner is on screen, in pixels: the battle screen shows
   * through the window or the background, and the game shakes it by moving either.
   */
  origin: { x: number; y: number };
}

const byte = (bytes: Uint8Array, i: number) => bytes[i] ?? 0;

/** Decodes one 2bpp 8×8 tile row into colour numbers. */
function tileRow(tiles: Uint8Array, tile: number, row: number, out: Uint8Array, at: number, flip = false) {
  const lo = byte(tiles, tile * 16 + row * 2);
  const hi = byte(tiles, tile * 16 + row * 2 + 1);
  for (let x = 0; x < 8; x++) {
    const bit = flip ? x : 7 - x;
    out[at + x] = ((lo >> bit) & 1) | (((hi >> bit) & 1) << 1);
  }
}

/**
 * Boxes drawn with box tiles, as cell rectangles (inclusive): a top edge from ┌ to ┐, and sides
 * of │ down to the bottom edge. The bottom edge only has to be there, not be whole: a box drawn
 * over another (the TYPE box over the text box) shares its bottom row.
 */
function boxes(tileMap: Uint8Array): { x0: number; y0: number; x1: number; y1: number }[] {
  const at = (x: number, y: number) => byte(tileMap, y * COLS + x);
  const found = [];
  for (let y0 = 0; y0 < ROWS - 1; y0++) {
    for (let x0 = 0; x0 < COLS - 1; x0++) {
      if (at(x0, y0) !== BOX_TOP_LEFT) continue;
      let x1 = x0 + 1;
      while (x1 < COLS && at(x1, y0) === BOX_HORIZONTAL) x1++;
      if (x1 >= COLS || at(x1, y0) !== BOX_TOP_RIGHT) continue;
      let y1 = y0 + 1;
      while (y1 < ROWS && at(x0, y1) === BOX_VERTICAL && at(x1, y1) === BOX_VERTICAL) y1++;
      if (y1 >= ROWS || y1 === y0 + 1) continue;
      found.push({ x0, y0, x1, y1 });
    }
  }
  return found;
}

const hash = (bytes: Uint8Array) => {
  let h = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) h = Math.imul(h ^ bytes[i]!, 0x01000193);
  return h >>> 0;
};

/**
 * Reads the battle screen frame by frame. Stateful only to keep what a menu box covers: where a
 * box hides part of a picture, the picture keeps the tiles it last showed there.
 */
export class BattleScreenReader {
  #cells: Record<Side, Int16Array> = { enemy: new Int16Array(49).fill(-1), player: new Int16Array(49).fill(-1) };
  #versions: Record<Side, { hash: number; version: number }> = { enemy: { hash: 0, version: 0 }, player: { hash: 0, version: 0 } };

  /** Forgets the last pictures (a new battle). */
  reset(): void {
    this.#cells.enemy.fill(-1);
    this.#cells.player.fill(-1);
  }

  read(watched: BattleScreenWatched): BattleScreen {
    const { tileMap, picTiles, objTiles, oam, lcd } = watched;
    const palettes: BattleScreen["palettes"] = [byte(lcd, 7), byte(lcd, 8), byte(lcd, 9)];
    const signed = (v: number) => ((v + 128) & 255) - 128;
    const lcdc = byte(lcd, 0);
    const wy = byte(lcd, 10);
    const origin =
      lcdc & 0b10_0000 && wy < 144
        ? { x: signed(byte(lcd, 11) - 7), y: wy }
        : { x: signed(-byte(lcd, 3)), y: signed(-byte(lcd, 2)) };
    const cells = new Uint8Array(COLS * ROWS).fill(CELL_UI);
    const objects = readObjects(oam, objTiles, (byte(lcd, 0) & 0b100) !== 0);

    // The screen is the battle when every picture tile on it is where its picture can be.
    let stray = 0;
    const offsets: Record<Side, Map<number, number>> = { enemy: new Map(), player: new Map() };
    for (let i = 0; i < COLS * ROWS; i++) {
      const tile = byte(tileMap, i);
      if (tile >= PIC_TILE_COUNT) continue;
      const side: Side = tile < SIDES.player.first ? "enemy" : "player";
      const n = tile - SIDES[side].first;
      const dx = (i % COLS) - Math.floor(n / PIC_TILES) - SIDES[side].home.x;
      const dy = Math.floor(i / COLS) - (n % PIC_TILES) - SIDES[side].home.y;
      if (Math.abs(dx) > MAX_SLIDE || Math.abs(dy) > MAX_SLIDE) {
        stray++;
        continue;
      }
      const key = (dy + SLIDE_KEY) * 64 + dx + SLIDE_KEY;
      offsets[side].set(key, (offsets[side].get(key) ?? 0) + 1);
    }
    const huds = { enemy: hudShown(tileMap, "enemy"), player: hudShown(tileMap, "player") };
    const pictureTiles = [...offsets.enemy.values(), ...offsets.player.values()].reduce((a, b) => a + b, 0);
    // A cleared screen between steps of the intro counts too; a full-screen menu doesn't.
    const cleared = tileMap.subarray(0, 12 * COLS).every((tile) => tile === BLANK);
    const battle = stray === 0 && (pictureTiles > 0 || huds.enemy || huds.player || cleared);
    if (!battle) {
      return { battle, enemy: null, player: null, objects, cells, huds, palettes, origin };
    }

    const inBox = new Uint8Array(COLS * ROWS);
    for (const b of boxes(tileMap)) {
      for (let y = b.y0; y <= b.y1; y++) for (let x = b.x0; x <= b.x1; x++) inBox[y * COLS + x] = 1;
    }
    for (const side of ["enemy", "player"] as const) {
      if (!huds[side]) continue;
      const h = HUDS[side];
      for (let y = h.y0; y <= h.y1; y++) for (let x = h.x0; x <= h.x1; x++) if (!inBox[y * COLS + x]) cells[y * COLS + x] = CELL_HUD;
    }
    // Above the text box, blank cells and picture tiles outside boxes are the scene.
    for (let i = 0; i < 12 * COLS; i++) {
      const tile = byte(tileMap, i);
      if (!inBox[i] && cells[i] !== CELL_HUD && (tile === BLANK || tile < PIC_TILE_COUNT)) cells[i] = CELL_SCENE;
    }

    const picture = (side: Side): BattlePicture | null => {
      const { first, home } = SIDES[side];
      // The window follows the picture when most of its tiles agree on a slide; a picture drawn
      // from a subset of its tiles (growing out of the Poké Ball) stays home.
      let best = SLIDE_KEY * 64 + SLIDE_KEY;
      let bestCount = 0;
      let total = 0;
      for (const [key, count] of offsets[side]) {
        total += count;
        if (count > bestCount) [best, bestCount] = [key, count];
      }
      const slide = bestCount * 2 > total && bestCount >= PIC_TILES ? best : SLIDE_KEY * 64 + SLIDE_KEY;
      const dy = Math.floor(slide / 64) - SLIDE_KEY;
      const dx = (slide % 64) - SLIDE_KEY;
      const kept = this.#cells[side];
      let any = false;
      for (let cy = 0; cy < PIC_TILES; cy++) {
        for (let cx = 0; cx < PIC_TILES; cx++) {
          const x = home.x + dx + cx;
          const y = home.y + dy + cy;
          const k = cy * PIC_TILES + cx;
          if (x < 0 || y < 0 || x >= COLS || y >= 12) {
            kept[k] = -1;
            continue;
          }
          const i = y * COLS + x;
          const tile = byte(tileMap, i);
          if (tile >= first && tile < first + PIC_TILES * PIC_TILES) kept[k] = tile - first;
          else if (!inBox[i] && (tile === BLANK || tile < PIC_TILE_COUNT)) kept[k] = -1;
          // else a box or text covers it: keep what was there.
          if (kept[k]! >= 0) any = true;
        }
      }
      if (!any) return null;
      const pixels = new Uint8Array(PIC_PIXELS * PIC_PIXELS).fill(NOT_DRAWN);
      for (let k = 0; k < kept.length; k++) {
        const n = kept[k]!;
        if (n < 0) continue;
        const cx = k % PIC_TILES;
        const cy = Math.floor(k / PIC_TILES);
        for (let row = 0; row < 8; row++) tileRow(picTiles, first + n, row, pixels, (cy * 8 + row) * PIC_PIXELS + cx * 8);
      }
      const h = hash(pixels);
      const v = this.#versions[side];
      if (h !== v.hash) {
        v.hash = h;
        v.version++;
      }
      return { pixels, dx, dy, version: v.version };
    };

    return { battle, enemy: picture("enemy"), player: picture("player"), objects, cells, huds, palettes, origin };
  }
}

function hudShown(tileMap: Uint8Array, side: Side): boolean {
  return HUDS[side].marks.every(([x, y, tile]) => byte(tileMap, y * COLS + x) === tile);
}

/** The sprites on screen, from OAM. */
function readObjects(oam: Uint8Array, tiles: Uint8Array, tall: boolean): BattleObject[] {
  const objects: BattleObject[] = [];
  const height = tall ? 16 : 8;
  for (let i = 0; i < 40; i++) {
    const y = byte(oam, i * 4) - 16;
    const x = byte(oam, i * 4 + 1) - 8;
    if (y <= -height || y >= 144 || x <= -8 || x >= 160) continue;
    const tile = byte(oam, i * 4 + 2) & (tall ? 0xfe : 0xff);
    const flags = byte(oam, i * 4 + 3);
    const flipX = (flags & 0x20) !== 0;
    const flipY = (flags & 0x40) !== 0;
    if (tile >= OBJ_TILE_COUNT) continue;
    const pixels = new Uint8Array(8 * height);
    for (let row = 0; row < height; row++) {
      const src = flipY ? height - 1 - row : row;
      tileRow(tiles, tile + (src >> 3), src & 7, pixels, row * 8, flipX);
    }
    if (!pixels.some((p) => p !== 0)) continue;
    objects.push({ x, y, height, pixels, palette: flags & 0x10 ? 1 : 0 });
  }
  return objects;
}
