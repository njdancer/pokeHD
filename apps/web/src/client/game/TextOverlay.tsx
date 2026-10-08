// The HD text layer (p2-text): the game's text boxes and menus, decoded from its screen each
// frame, drawn over the HD world with a modern font. Boxes keep the places the game gives them on
// its 20×18 tile grid, scaled up on a stage sized for the device, so the game's layout (and every
// cursor move) carries over as it is. Only the look changes.
import type { CSSProperties } from "react";
import { SCREEN_COLS, SCREEN_ROWS, type Menu, type ScreenText, type TextBox, type TextLine } from "@pokehd/emu";
import { CURSOR } from "@pokehd/rom";
import "./text-overlay.css";

/** The Storybook look (D29): rounded letters on warm paper. */
export function TextOverlay({ text }: { text: ScreenText }) {
  return (
    <div className="hd-text" data-testid="hd-text" aria-live="polite">
      <div className="hd-text-stage">
        {text.boxes.filter((box, i) => !emptyUnder(box, text.boxes.slice(i + 1))).map((box) => (
          <Box key={`${box.x},${box.y},${box.width},${box.height}`} box={box} text={text} />
        ))}
      </div>
    </div>
  );
}

const overlaps = (a: TextBox, b: TextBox) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

/** A box left empty under another (the start menu under the bag) only adds a blank edge. */
const emptyUnder = (box: TextBox, above: readonly TextBox[]) => box.lines.length === 0 && above.some((b) => overlaps(box, b));

const same = (a: TextBox, b: TextBox) => a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;

/** Position in a box, in percent of the box, from tile coordinates. */
const place = (box: TextBox, x: number, y: number, width = 1, height = 1): CSSProperties => ({
  left: `${((x - box.x) / box.width) * 100}%`,
  top: `${((y - box.y) / box.height) * 100}%`,
  width: `${(width / box.width) * 100}%`,
  height: `${(height / box.height) * 100}%`,
});

type Line = TextLine & { detail?: string };

function Box({ box, text }: { box: TextBox; text: ScreenText }) {
  const menu = text.menus.find((m) => same(m.box, box));
  const dialog = text.dialog && same(text.dialog.box, box) ? text.dialog : null;
  const lines: Line[] = dialog ? dialogLines(dialog.lines, box) : menu ? menuLines(menu) : box.lines;
  const rows = menu ? menuRows(menu) : new Map<number, "selected" | "chosen">();
  const inner = box.x + box.width - 1;
  const cls = ["hd-box", dialog && "dialog", menu && (menu.active ? "menu active" : "menu under")].filter(Boolean).join(" ");
  return (
    <div
      className={cls}
      style={{
        left: `${(box.x / SCREEN_COLS) * 100}%`,
        top: `${(box.y / SCREEN_ROWS) * 100}%`,
        width: `${(box.width / SCREEN_COLS) * 100}%`,
        height: `${(box.height / SCREEN_ROWS) * 100}%`,
      }}
    >
      {lines.map((raw) => {
        const cursor = rows.get(raw.row);
        const line = cursor ? stripCursor(raw) : raw;
        return (
          <div key={raw.row} className="hd-row">
            {cursor && <div className={`hd-pick ${cursor}`} style={place(box, line.col - 1, line.row, inner - line.col + 1)} />}
            {cursor && <div className={`hd-cursor ${cursor}`} style={place(box, line.col - 1, line.row)} />}
            <div className="hd-line" style={place(box, line.col, line.row, inner - line.col)}>
              {line.text}
              {line.detail && <span className="hd-detail">{line.detail}</span>}
            </div>
          </div>
        );
      })}
      {dialog?.state === "waiting" && <div className="hd-more" style={place(box, 18, 16)} />}
    </div>
  );
}

/** The message box's two lines (rows 14 and 16), without the ▼ the game blinks after them. */
function dialogLines(lines: readonly [string, string], box: TextBox): TextLine[] {
  return lines.flatMap((text, i) => (text ? [{ row: box.y + 2 + i * 2, col: box.x + 1, text }] : []));
}

/**
 * A menu's items at their rows. The game prints an item's quantity on the row below it; here it
 * goes at the end of the item's own row, where it reads better in a proportional font.
 */
function menuLines(menu: Menu): (TextLine & { detail?: string })[] {
  return menu.items.map((item) => {
    const raw = menu.box.lines.find((l) => l.row === item.row);
    const col = raw ? stripCursor(raw).col : menu.box.x + 2;
    const cursor = menu.cursor !== null && menu.items[menu.cursor] === item;
    return { row: item.row, col: cursor ? col - 1 : col, text: `${cursor ? CURSOR.active : ""}${item.text}`, detail: item.detail };
  });
}

/** The row the cursor is on, and whether the menu takes input there or waits under a submenu. */
function menuRows(menu: Menu): Map<number, "selected" | "chosen"> {
  const item = menu.cursor === null ? undefined : menu.items[menu.cursor];
  return new Map(item ? [[item.row, menu.active ? "selected" : "chosen"]] : []);
}

function stripCursor<T extends TextLine>(line: T): T {
  const first = line.text[0];
  return first === CURSOR.active || first === CURSOR.inactive ? { ...line, col: line.col + 1, text: line.text.slice(1) } : line;
}
