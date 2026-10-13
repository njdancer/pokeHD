// Decodes TEXT_WATCHES bytes into a ScreenText. Box geometry and menu layouts follow
// vendor/pokered: home/text.asm (TextBoxBorder, the message box), home/list_menu.asm
// (DisplayListMenuID), engine/menus/draw_start_menu.asm and engine/menus/text_box.asm.
import { BOX, CURSOR, TILE_BYTES, glyphTable, tileKey, type Glyph } from "@pokehd/rom";
import {
  SCREEN_COLS,
  SCREEN_ROWS,
  type Dialog,
  type DialogState,
  type Menu,
  type MenuItem,
  type MenuKind,
  type QuantityPrompt,
  type ScreenText,
  type TextBox,
  type TextLine,
  type TextWatched,
} from "./text.ts";

/** Window Y at or past the bottom of the screen means the window is hidden. */
const SCREEN_HEIGHT = 144;
/** The message box: TextBoxBorder at 0,12 with a 18×4 interior; text on rows 14 and 16. */
const DIALOG = { x: 0, y: 12, width: 20, height: 6, rows: [14, 16] } as const;
/** Where the ▼ "more" arrow blinks (WaitForTextScrollButtonPress). */
const MORE_ARROW = { x: 18, y: 16 } as const;
/** DisplayListMenuID's box: 4,2 with a 14×9 interior. */
const LIST_BOX = { x: 4, y: 2, width: 16, height: 11 } as const;
/** wOptions bits holding the frames between letters (TEXT_DELAY_MASK). */
const TEXT_DELAY_MASK = 0b111;

const BORDER_CHARS = new Set<string>(Object.values(BOX));
const CURSOR_CHARS = new Set<string>([CURSOR.active, CURSOR.inactive]);

/** A screen of decoded characters; `null` where a tile isn't text. */
type Grid = (string | null)[];

const cell = (grid: Grid, x: number, y: number) => grid[y * SCREEN_COLS + x] ?? null;

/** Splits cells into runs of text separated by two or more spaces (or non-text tiles). */
function segments(grid: Grid, row: number, from: number, to: number): TextLine[] {
  const out: TextLine[] = [];
  let start = -1;
  let text = "";
  let gap = 0;
  const flush = () => {
    if (start >= 0) out.push({ row, col: start, text: text.trimEnd() });
    start = -1;
    text = "";
  };
  for (let x = from; x < to; x++) {
    const c = cell(grid, x, row);
    if (c === null || BORDER_CHARS.has(c) || c === " ") {
      if (start >= 0 && (c !== " " || ++gap >= 2)) flush();
      else if (start >= 0) text += " ";
      continue;
    }
    if (start < 0) start = x;
    gap = 0;
    text += c;
  }
  flush();
  return out;
}

/** A whole row inside a box as one line, or null if blank. */
function rowLine(grid: Grid, row: number, from: number, to: number): TextLine | null {
  let text = "";
  let col = -1;
  for (let x = from; x < to; x++) {
    const c = cell(grid, x, row);
    const ch = c === null || BORDER_CHARS.has(c) ? " " : c;
    if (col < 0 && ch === " ") continue;
    if (col < 0) col = x;
    text += ch;
  }
  text = text.trimEnd();
  return col < 0 || text === "" ? null : { row, col, text };
}

/** A box found on screen, with the boxes drawn over parts of it. */
interface Found {
  box: TextBox;
  above: TextBox[];
  /** 0 for boxes found whole, then 1, 2 … for each layer further down. */
  depth: number;
}

const inside = (box: TextBox, x: number, y: number) =>
  x >= box.x && x < box.x + box.width && y >= box.y && y < box.y + box.height;

/**
 * Finds bordered boxes. A box partly drawn over by another (the bag under its USE/TOSS choice)
 * still counts if its top-left and top-right corners show; the hidden cells read as blank.
 */
function findBoxes(grid: Grid): Found[] {
  const found: Found[] = [];
  const at = (x: number, y: number) => found.find((f) => f.box.x === x && f.box.y === y);
  const scan = (depth: number) => {
    const lenient = depth > 0;
    let added = false;
    for (let y = 0; y < SCREEN_ROWS; y++) {
      for (let x = 0; x < SCREEN_COLS; x++) {
        if (cell(grid, x, y) !== BOX.topLeft || at(x, y)) continue;
        const above = new Set<TextBox>();
        /** The cell, unless a box already found covers it. */
        const own = (cx: number, cy: number) => (found.some((f) => inside(f.box, cx, cy)) ? null : cell(grid, cx, cy));
        const is = (cx: number, cy: number, char: string) => {
          if (cell(grid, cx, cy) === char) return true;
          if (!lenient) return false;
          const over = found.find((f) => inside(f.box, cx, cy));
          if (over) above.add(over.box);
          return over !== undefined;
        };
        let right = x + 1;
        while (right < SCREEN_COLS && own(right, y) !== BOX.topRight && is(right, y, BOX.horizontal)) right++;
        if (own(right, y) !== BOX.topRight) {
          // The top-right corner may be under another box: take the first column whose right
          // border shows further down.
          right = x + 1;
          const edge = (c: number) => {
            for (let row = y + 1; row < SCREEN_ROWS; row++) {
              const ch = own(c, row);
              if (ch === BOX.vertical || ch === BOX.bottomRight) return true;
            }
            return false;
          };
          while (right < SCREEN_COLS && is(right, y, BOX.horizontal) && !(own(right, y) === null && edge(right))) right++;
          if (right >= SCREEN_COLS || own(right, y) !== null) continue;
        }
        let bottom = y + 1;
        while (
          bottom < SCREEN_ROWS &&
          own(x, bottom) !== BOX.bottomLeft &&
          own(right, bottom) !== BOX.bottomRight &&
          is(x, bottom, BOX.vertical) &&
          is(right, bottom, BOX.vertical)
        ) {
          bottom++;
        }
        if (bottom >= SCREEN_ROWS) {
          // The bottom may be under another box down to the screen's edge (a menu under the
          // message box): keep it, cut off there, if its sides show for a row first.
          const hidden = (row: number) => own(x, row) === null && own(right, row) === null;
          let first = bottom - 1;
          while (first > y && hidden(first)) first--;
          if (!lenient || first === bottom - 1 || first <= y) continue;
          bottom = SCREEN_ROWS - 1;
        } else {
          if (!is(x, bottom, BOX.bottomLeft) || !is(right, bottom, BOX.bottomRight)) continue;
          let closed = true;
          for (let i = x + 1; i < right && closed; i++) closed = is(i, bottom, BOX.horizontal);
          if (!closed) continue;
        }
        found.push({ box: { x, y, width: right - x + 1, height: bottom - y + 1, lines: [] }, above: [...above], depth });
        added = true;
      }
    }
    return added;
  };
  for (let depth = 0; scan(depth); depth++);
  // Underneath first, then in reading order.
  return found.sort((a, b) => b.depth - a.depth || a.box.y - b.box.y || a.box.x - b.box.x);
}

/** The grid as one box sees it: cells under boxes drawn over it read as blank. */
function unobscured(grid: Grid, above: readonly TextBox[]): Grid {
  if (above.length === 0) return grid;
  return grid.map((c, i) => (above.some((b) => inside(b, i % SCREEN_COLS, Math.floor(i / SCREEN_COLS))) ? null : c));
}

/** Whether a box's visible inside holds a tile that isn't text. */
function hasPicture(grid: Grid, box: TextBox, above: readonly TextBox[]): boolean {
  for (let y = box.y + 1; y < box.y + box.height - 1; y++) {
    for (let x = box.x + 1; x < box.x + box.width - 1; x++) {
      if (cell(grid, x, y) === null && !above.some((b) => inside(b, x, y))) return true;
    }
  }
  return false;
}

function boxLines(grid: Grid, box: TextBox): TextLine[] {
  const lines: TextLine[] = [];
  for (let row = box.y + 1; row < box.y + box.height - 1; row++) {
    const line = rowLine(grid, row, box.x + 1, box.x + box.width - 1);
    if (line) lines.push(line);
  }
  return lines;
}

const isBox = (box: TextBox, at: { x: number; y: number; width: number; height: number }) =>
  box.x === at.x && box.y === at.y && box.width === at.width && box.height === at.height;

function findCursor(grid: Grid, box: TextBox): { x: number; y: number; active: boolean } | null {
  for (let y = box.y + 1; y < box.y + box.height - 1; y++) {
    for (let x = box.x + 1; x < box.x + box.width - 1; x++) {
      const c = cell(grid, x, y);
      if (c !== null && CURSOR_CHARS.has(c)) return { x, y, active: c === CURSOR.active };
    }
  }
  return null;
}

function decodeMenu(grid: Grid, box: TextBox, watched: TextWatched): Menu | null {
  const cursor = findCursor(grid, box);
  if (!cursor) return null;
  const right = box.x + box.width - 1;
  const rows: number[] = [];
  for (let y = box.y + 1; y < box.y + box.height - 1; y++) rows.push(y);

  // The FIGHT/PKMN/ITEM/RUN menu has two columns; every other menu has one, at the cursor.
  const all = rows.flatMap((y) => segments(grid, y, box.x + 1, right)).map((s) => ({
    ...s,
    text: CURSOR_CHARS.has(s.text[0]!) ? s.text.slice(1) : s.text,
    col: CURSOR_CHARS.has(s.text[0]!) ? s.col + 1 : s.col,
  }));
  if (all.some((s) => s.text === "FIGHT")) {
    const items = all.map(({ text, row }) => ({ text, row }));
    const index = all.findIndex((s) => s.row === cursor.y && s.col === cursor.x + 1);
    return { kind: "battle", box, items, cursor: index < 0 ? null : index, active: cursor.active };
  }

  const items: MenuItem[] = [];
  for (const y of rows) {
    const first = cell(grid, cursor.x + 1, y);
    const line = rowLine(grid, y, cursor.x + 1, right);
    if (line && line.col === cursor.x + 1 && first !== null && first !== " ") {
      items.push({ text: line.text, row: y });
      continue;
    }
    const detail = rowLine(grid, y, box.x + 1, right);
    const last = items.at(-1);
    if (detail && last) last.detail = last.detail ? `${last.detail} ${detail.text}` : detail.text;
  }
  const index = items.findIndex((item) => item.row === cursor.y);
  const menu: Menu = { kind: menuKind(box, items), box, items, cursor: index < 0 ? null : index, active: cursor.active };
  if (menu.kind === "list") {
    menu.listId = watched.listId[0] ?? 0;
    menu.scroll = watched.listScroll[0] ?? 0;
  }
  return menu;
}

function menuKind(box: TextBox, items: readonly MenuItem[]): MenuKind {
  const texts = items.map((i) => i.text);
  if (box.x === 10 && box.y === 0 && texts.at(-1) === "EXIT") return "start";
  // A list under the message box is cut off at the bottom of the screen.
  const clippedList = box.y + box.height === SCREEN_ROWS && box.height > LIST_BOX.height;
  if (isBox(box, LIST_BOX) || (clippedList && isBox({ ...box, height: LIST_BOX.height }, LIST_BOX))) return "list";
  if (texts.length === 2 && texts.includes("YES") && texts.includes("NO")) return "yesNo";
  if (texts.length === 2 && box.height === 5) return "twoOption";
  return "other";
}

function decodeQuantity(box: TextBox): QuantityPrompt | null {
  if (box.lines.length !== 1) return null;
  const match = /^×(\d+)/.exec(box.lines[0]!.text);
  return match ? { box, value: Number(match[1]) } : null;
}

/** Decodes the screen's text each frame. Keeps state between frames for the dialog's reveal. */
export class ScreenTextDecoder {
  readonly #table: Map<string, string>;
  /** VRAM bytes for tiles $60–$ff as last seen, and what each one reads as. */
  readonly #tiles = new Uint8Array(0xa0 * TILE_BYTES);
  readonly #chars: (string | null)[] = Array<string | null>(0xa0).fill(null);
  #frame = 0;
  #dialog: { lines: string; changed: number; waiting: boolean } | null = null;
  /** hDownArrowBlinkCount1 and 2 as last seen, which only move while the game waits at a ▼. */
  #blink = -1;

  constructor(glyphs: readonly Glyph[]) {
    this.#table = glyphTable(glyphs);
    this.#tiles.fill(0xff); // never a glyph, so the first frame matches every tile
  }

  /** Re-matches the tiles whose pixels changed. */
  #updateTiles(watched: TextWatched): void {
    const vram = new Uint8Array(this.#tiles.length);
    vram.set(watched.tiles60, 0);
    vram.set(watched.tiles80, 0x20 * TILE_BYTES);
    for (let i = 0; i < this.#chars.length; i++) {
      const tile = vram.subarray(i * TILE_BYTES, (i + 1) * TILE_BYTES);
      const seen = this.#tiles.subarray(i * TILE_BYTES, (i + 1) * TILE_BYTES);
      if (tile.every((b, j) => b === seen[j])) continue;
      seen.set(tile);
      this.#chars[i] = this.#table.get(tileKey(tile)) ?? null;
    }
  }

  /** What tile `code` currently reads as, or null if it isn't text. */
  charAt(code: number): string | null {
    return code >= 0x60 ? (this.#chars[code - 0x60] ?? null) : null;
  }

  decode(watched: TextWatched): ScreenText {
    this.#frame++;
    this.#updateTiles(watched);
    const shown = (watched.windowY[0] ?? 0) < SCREEN_HEIGHT || (watched.autoTransfer[0] ?? 0) !== 0;
    if (!shown) {
      this.#dialog = null;
      return { shown, boxes: [], dialog: null, menus: [], quantity: null, loose: [], pictures: false };
    }
    const grid: Grid = Array.from(watched.tileMap, (code) => this.charAt(code));
    const found = findBoxes(grid);
    const boxes: TextBox[] = [];
    const menus: Menu[] = [];
    let quantity: QuantityPrompt | null = null;
    let dialog: Dialog | null = null;
    let pictures = false;
    for (const { box, above } of found) {
      const view = unobscured(grid, above);
      pictures ||= hasPicture(grid, box, above);
      box.lines = boxLines(view, box);
      boxes.push(box);
      const menu = decodeMenu(view, box, watched);
      if (menu) menus.push(menu);
      else if (isBox(box, DIALOG)) dialog = this.#decodeDialog(view, box, watched.options[0] ?? 0);
      else quantity ??= decodeQuantity(box);
    }
    menus.sort((a, b) => Number(b.active) - Number(a.active));
    const blink = ((watched.arrowBlink[0] ?? 0) << 8) | (watched.arrowBlink[1] ?? 0);
    const blinking = this.#blink >= 0 && blink !== this.#blink;
    this.#blink = blink;
    // At a ▼ the game waits for A or B (WaitForTextScrollButtonPress), so no menu takes input,
    // though one just chosen still shows its ▶ (the PC's menu while it says "Accessed my PC.").
    // The arrow blinks; between blinks, the waiting loop still moves the blink counters.
    const prompt = !!dialog && (cell(grid, MORE_ARROW.x, MORE_ARROW.y) === CURSOR.more || (dialog.state === "waiting" && blinking));
    if (dialog && prompt) {
      dialog.state = "waiting";
      this.#dialog!.waiting = true;
      for (const menu of menus) menu.active = false;
    } else if (dialog && menus[0]?.active) {
      // While a menu takes input, the text above it has finished.
      dialog.state = "idle";
      this.#dialog!.waiting = false;
    }
    if (!dialog) this.#dialog = null;

    const loose: TextLine[] = [];
    for (let y = 0; y < SCREEN_ROWS; y++) {
      for (const s of segments(grid, y, 0, SCREEN_COLS)) {
        if (!boxes.some((b) => inside(b, s.col, y)) && /[\p{L}\p{N}]/u.test(s.text)) loose.push(s);
      }
    }
    return { shown, boxes, dialog, menus, quantity, loose, pictures };
  }

  #decodeDialog(grid: Grid, box: TextBox, options: number): Dialog {
    const arrow = cell(grid, MORE_ARROW.x, MORE_ARROW.y) === CURSOR.more;
    // Lines are 18 letters wide, right up to the border ("To make a complete"); only the ▼'s
    // own cell is left out, while it shows.
    const right = box.x + box.width - 1;
    const [first, second] = DIALOG.rows.map(
      (row) => rowLine(grid, row, box.x + 1, row === MORE_ARROW.y && arrow ? MORE_ARROW.x : right)?.text ?? "",
    ) as [string, string];
    const key = `${first}\n${second}`;
    const prev = this.#dialog;
    const changed = !prev || prev.lines !== key;
    const next = {
      lines: key,
      changed: changed ? this.#frame : prev.changed,
      waiting: arrow || (!changed && (prev?.waiting ?? false)),
    };
    this.#dialog = next;
    let state: DialogState = "idle";
    if (next.waiting) state = "waiting";
    // A space between words doesn't change what's on screen, so allow two letters' time.
    else if (this.#frame - next.changed <= 2 * ((options & TEXT_DELAY_MASK) || 1) + 1) state = "printing";
    return { box, lines: [first, second], state };
  }
}
