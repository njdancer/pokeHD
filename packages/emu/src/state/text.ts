// Text boxes and menus as the game shows them, decoded from its screen buffer each frame. This is
// the contract between the emulator (Track B) and the text renderer (p2-text), which re-typesets
// it with a modern font while the game keeps driving. Screen-driven, per D13: the game's own
// screen buffer (wTileMap, 20×18 tiles) is read and each tile is identified by its pixels in VRAM.
import { SYMBOLS } from "@pokehd/rom";
import type { Watch } from "../protocol.ts";

/** Text on one row of the screen. `col` is the tile column of its first character. */
export interface TextLine {
  row: number;
  col: number;
  /** Trailing spaces trimmed. Some tiles read as two letters ("'d", "PK"), so length ≠ tiles. */
  text: string;
}

/** A bordered box on screen, in tiles, borders included. */
export interface TextBox {
  x: number;
  y: number;
  width: number;
  height: number;
  /** The rows of text inside the borders. */
  lines: TextLine[];
}

/**
 * - `printing`: letters are still appearing (or the lines are scrolling up).
 * - `waiting`: the text has stopped at a ▼ and waits for A or B.
 * - `idle`: the text is complete and nothing is prompting (a menu or prompt usually follows).
 */
export type DialogState = "printing" | "waiting" | "idle";

/** The message box along the bottom of the screen (tiles 0,12 to 19,17). */
export interface Dialog {
  box: TextBox;
  /** The box's two text lines as currently revealed, empty when blank. */
  lines: [string, string];
  state: DialogState;
}

/**
 * - `start`: the start menu (POKéDEX … EXIT).
 * - `list`: a scrolling list (`DisplayListMenuID`: bag, PC boxes, shop, moves); see `listId`.
 * - `yesNo`: a YES/NO prompt; `twoOption` is any other two-choice box (HEAL/CANCEL …).
 * - `battle`: the FIGHT/PKMN/ITEM/RUN menu.
 * - `other`: any other menu (party actions, the main menu, naming choices, moves in battle …).
 */
export type MenuKind = "start" | "list" | "yesNo" | "twoOption" | "battle" | "other";

export interface MenuItem {
  text: string;
  /** Row of the item, where the cursor points at it. */
  row: number;
  /** Text on the following rows before the next item, e.g. an item's "×3" quantity. */
  detail?: string;
}

export interface Menu {
  kind: MenuKind;
  box: TextBox;
  /** Choices in screen order. A list shows only its visible page (see `scroll`). */
  items: MenuItem[];
  /** Index into `items` the cursor is on, or null if it sits on no item. */
  cursor: number | null;
  /**
   * True for the menu taking input (cursor ▶). A menu left open under a submenu shows a hollow
   * ▷ on the choice that opened it.
   */
  active: boolean;
  /** For `list`: wListMenuID (0 PC Pokémon, 1 moves, 2 priced items, 3 items, 4 special). */
  listId?: number;
  /** For `list`: wListScrollOffset, the list index of the first visible item. */
  scroll?: number;
}

/** A number being chosen with Up/Down (how many to buy or toss), as shown: "×12". */
export interface QuantityPrompt {
  box: TextBox;
  value: number;
}

export interface ScreenText {
  /** False when the screen buffer isn't what's on screen (walking around the overworld). */
  shown: boolean;
  /**
   * Every box on screen, boxes partly drawn over by others first, then top to bottom and left to
   * right. A box's hidden cells read as blank.
   */
  boxes: TextBox[];
  dialog: Dialog | null;
  /** Boxes with a menu cursor, the active one first. */
  menus: Menu[];
  quantity: QuantityPrompt | null;
  /** Text outside any box: battle HUD names and levels, titles, the Pokédex … */
  loose: TextLine[];
}

const at = (address: number, length = 1): Watch => [address, length];
const sym = (name: keyof typeof SYMBOLS, length = 1): Watch => at(SYMBOLS[name].address, length);

export const SCREEN_COLS = 20;
export const SCREEN_ROWS = 18;
/** Tiles $80–$ff live at $8800 in the tile-data mode the game uses (LCDC bit 4 clear)… */
const VRAM_TILES_80 = 0x8800;
/** …and tiles $60–$7f at $9600. */
const VRAM_TILES_60 = 0x9600;

/**
 * The memory `ScreenTextDecoder` reads, to pass to `EmulatorHost.watch` (or read with
 * `GameBoy.readBytes` in Node). About 3 KB a frame, mostly the 160 font tiles, which change
 * rarely and are only re-matched when they do.
 */
export const TEXT_WATCHES = {
  /** wTileMap: the game's 20×18 screen buffer, which text and menus are drawn into. */
  tileMap: sym("wTileMap", SCREEN_COLS * SCREEN_ROWS),
  /** Tile data for $60–$7f: text box extras or battle HUD pieces. */
  tiles60: at(VRAM_TILES_60, 0x20 * 16),
  /** Tile data for $80–$ff: the font, unless something has drawn over it. */
  tiles80: at(VRAM_TILES_80, 0x80 * 16),
  /** The game's copy of rWY; the window is on screen when it's below 144. */
  windowY: sym("hWY"),
  /** Non-zero while the screen buffer is copied to VRAM every frame. */
  autoTransfer: sym("hAutoBGTransferEnabled"),
  listScroll: sym("wListScrollOffset"),
  listId: sym("wListMenuID"),
  /** wOptions; the low 3 bits are the frames between letters (text speed). */
  options: sym("wOptions"),
} as const satisfies Record<string, Watch>;

export type TextWatchName = keyof typeof TEXT_WATCHES;

/** The bytes `EmulatorHost` delivers in `FrameMessage.watched` for `TEXT_WATCHES`. */
export type TextWatched = Record<TextWatchName, Uint8Array>;
