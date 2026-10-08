import { describe, expect, it } from "vitest";
import {
  BATTLE_SCREEN_WATCHES, BattleScreenReader, CELL_HUD, CELL_SCENE, CELL_UI, NOT_DRAWN, PIC_PIXELS, type BattleScreenWatched,
} from "./battle-screen.ts";

const BLANK = 0x7f;
const at = (x: number, y: number) => y * 20 + x;

/** The battle screen as the game draws it once both Pokémon are out (see battle-screen.ts). */
function battleScreen(): BattleScreenWatched {
  const w = {} as BattleScreenWatched;
  for (const [name, [, length]] of Object.entries(BATTLE_SCREEN_WATCHES)) w[name as keyof typeof BATTLE_SCREEN_WATCHES] = new Uint8Array(length);
  w.tileMap = new Uint8Array(360).fill(BLANK);
  // Pictures: tiles run down each column, then across.
  for (let n = 0; n < 49; n++) {
    w.tileMap[at(12 + Math.floor(n / 7), n % 7)] = n;
    w.tileMap[at(1 + Math.floor(n / 7), 5 + (n % 7))] = 0x31 + n;
  }
  // Tile n of each picture: its top row colour 1, the rest colour 3.
  for (let n = 0; n < 98; n++) {
    w.picTiles.set([0xff, 0x00], n * 16);
    for (let row = 1; row < 8; row++) w.picTiles.set([0xff, 0xff], n * 16 + row * 2);
  }
  // The HUDs' corner tiles.
  w.tileMap[at(1, 3)] = 0x74;
  w.tileMap[at(10, 3)] = 0x78;
  w.tileMap[at(18, 10)] = 0x73;
  w.tileMap[at(18, 11)] = 0x77;
  // The text box, rows 12–17.
  box(w.tileMap, 0, 12, 19, 17);
  w.lcd.set([0xe3, 0, 0, 0, 0, 0, 0, 0xe4, 0xe4, 0x6c, 0, 7]);
  return w;
}

function box(tileMap: Uint8Array, x0: number, y0: number, x1: number, y1: number) {
  for (let x = x0; x <= x1; x++) {
    tileMap[at(x, y0)] = 0x7a;
    tileMap[at(x, y1)] = 0x7a;
  }
  for (let y = y0 + 1; y < y1; y++) {
    tileMap[at(x0, y)] = 0x7c;
    tileMap[at(x1, y)] = 0x7c;
    for (let x = x0 + 1; x < x1; x++) tileMap[at(x, y)] = BLANK;
  }
  tileMap[at(x0, y0)] = 0x79;
  tileMap[at(x1, y0)] = 0x7b;
  tileMap[at(x0, y1)] = 0x7d;
  tileMap[at(x1, y1)] = 0x7e;
}

describe("BattleScreenReader", () => {
  it("reads both pictures, the HUDs and the cells of the battle screen", () => {
    const screen = new BattleScreenReader().read(battleScreen());
    expect(screen.battle).toBe(true);
    expect(screen.huds).toEqual({ enemy: true, player: true });
    expect(screen.palettes).toEqual([0xe4, 0xe4, 0x6c]);
    expect(screen.origin).toEqual({ x: 0, y: 0 });
    for (const side of [screen.enemy!, screen.player!]) {
      expect(side).toMatchObject({ dx: 0, dy: 0 });
      expect(side.pixels).toHaveLength(PIC_PIXELS * PIC_PIXELS);
      expect([side.pixels[0], side.pixels[PIC_PIXELS], side.pixels[PIC_PIXELS * 8]]).toEqual([1, 3, 1]);
    }
    expect(screen.cells[at(14, 3)]).toBe(CELL_SCENE); // the enemy's picture
    expect(screen.cells[at(5, 2)]).toBe(CELL_HUD);
    expect(screen.cells[at(15, 9)]).toBe(CELL_HUD);
    expect(screen.cells[at(10, 6)]).toBe(CELL_SCENE); // blank, above the text box
    expect(screen.cells[at(5, 14)]).toBe(CELL_UI);
  });

  it("follows a picture sliding away, and drops it once it's gone", () => {
    const w = battleScreen();
    const reader = new BattleScreenReader();
    // The player's picture two tiles left: its first two columns off screen.
    for (let y = 5; y < 12; y++) for (let x = 0; x < 9; x++) w.tileMap[at(x, y)] = BLANK;
    for (let n = 14; n < 49; n++) w.tileMap[at(1 + Math.floor(n / 7) - 2, 5 + (n % 7))] = 0x31 + n;
    expect(reader.read(w).player).toMatchObject({ dx: -2, dy: 0 });
    for (let y = 5; y < 12; y++) for (let x = 0; x < 9; x++) w.tileMap[at(x, y)] = BLANK;
    expect(reader.read(w).player).toBeNull();
  });

  it("keeps what a menu box covers", () => {
    const w = battleScreen();
    const reader = new BattleScreenReader();
    const before = reader.read(w).player!;
    // The move menu's TYPE box over the bottom of the player's picture.
    box(w.tileMap, 0, 8, 10, 12);
    const screen = reader.read(w);
    expect(screen.player!.pixels).toEqual(before.pixels);
    expect(screen.player!.version).toBe(before.version);
    expect(screen.cells[at(3, 10)]).toBe(CELL_UI);
  });

  it("isn't the battle screen on a full-screen menu or the overworld", () => {
    const menu = battleScreen();
    menu.tileMap.fill(BLANK);
    menu.tileMap[at(3, 1)] = 0x81; // text
    expect(new BattleScreenReader().read(menu)).toMatchObject({ battle: false, enemy: null, player: null });
    expect(new BattleScreenReader().read(menu).cells.every((c) => c === CELL_UI)).toBe(true);
    const overworld = battleScreen();
    overworld.tileMap.fill(0x10);
    expect(new BattleScreenReader().read(overworld).battle).toBe(false);
    const cleared = battleScreen();
    cleared.tileMap.fill(BLANK);
    expect(new BattleScreenReader().read(cleared).battle).toBe(true);
  });

  it("marks undrawn pixels and reads sprites and shakes", () => {
    const w = battleScreen();
    w.tileMap[at(12, 0)] = BLANK;
    w.oam.set([16 + 40, 8 + 50, 0x31, 0x20]); // tile $31, flipped across
    w.objTiles.set([0x80, 0x00], 0x31 * 16);
    w.lcd[11] = 9; // rWX: the window two pixels right
    const screen = new BattleScreenReader().read(w);
    expect(screen.enemy!.pixels[0]).toBe(NOT_DRAWN);
    expect(screen.objects).toHaveLength(1);
    expect(screen.objects[0]).toMatchObject({ x: 50, y: 40, height: 8, palette: 0 });
    expect([...screen.objects[0]!.pixels.subarray(0, 8)]).toEqual([0, 0, 0, 0, 0, 0, 0, 1]);
    expect(screen.origin).toEqual({ x: 2, y: 0 });
  });
});
