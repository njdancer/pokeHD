// The HD text layer (p2-text): the game's text boxes and menus, decoded from its screen each
// frame, drawn over the HD world with a modern font. Boxes keep the places the game gives them on
// its 20×18 tile grid, scaled up on a stage sized for the device, so the game's layout (and every
// cursor move) carries over as it is.
//
// Tap-first: every choice is a real button. Tapping one moves the game's cursor there and presses
// A; a tapped message box presses A; the corner button presses B. The game still runs every menu
// itself (see Controls in @pokehd/emu), and keys and gamepads still move the cursor as before.
import type { CSSProperties } from "react";
import { SCREEN_COLS, SCREEN_ROWS, type Menu, type ScreenText, type TextBox, type TextLine } from "@pokehd/emu";
import { CURSOR } from "@pokehd/rom";
import type { UiLook } from "./ui-look.ts";
import "./text-overlay.css";

/** What a tap does: pick a menu item (its index, as the game counts it) or press a button. */
export interface TextActions {
  select(item: number): void;
  press(button: "A" | "B" | "Up" | "Down"): void;
}

export function TextOverlay({ text, actions, look = "ball" }: { text: ScreenText; actions?: TextActions; look?: UiLook }) {
  return (
    <div className="hd-text" data-testid="hd-text" data-look={look} aria-live="polite">
      <div className="hd-text-stage">
        {text.boxes.filter((box, i) => !emptyUnder(box, text.boxes.slice(i + 1))).map((box) => (
          <Box key={`${box.x},${box.y},${box.width},${box.height}`} box={box} text={text} actions={actions} />
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

type Line = TextLine & { detail?: string; item?: number };

function Box({ box, text, actions }: { box: TextBox; text: ScreenText; actions?: TextActions }) {
  const menu = text.menus.find((m) => same(m.box, box));
  const dialog = text.dialog && same(text.dialog.box, box) ? text.dialog : null;
  const quantity = text.quantity && same(text.quantity.box, box) ? text.quantity : null;
  const lines: Line[] = dialog ? dialogLines(dialog.lines, box) : menu ? menuLines(menu) : box.lines;
  const rows = menu ? menuRows(menu) : new Map<number, "selected" | "chosen">();
  const inner = box.x + box.width - 1;
  // Only the menu taking input answers taps; one waiting under a submenu just shows.
  const live = actions && menu?.active ? actions : undefined;
  // A message box with nothing to choose is one big button: A, to read on.
  const advance = actions && dialog && !text.menus.some((m) => m.active) ? actions : undefined;
  const cls = ["hd-box", dialog && "dialog", menu && (menu.active ? "menu active" : "menu under"), advance && "tappable"].filter(Boolean).join(" ");
  return (
    <div
      className={cls}
      style={{
        left: `${(box.x / SCREEN_COLS) * 100}%`,
        top: `${(box.y / SCREEN_ROWS) * 100}%`,
        width: `${(box.width / SCREEN_COLS) * 100}%`,
        height: `${(box.height / SCREEN_ROWS) * 100}%`,
      }}
      onClick={advance && (() => advance.press("A"))}
    >
      <i className="hd-corner tl" />
      <i className="hd-corner tr" />
      <i className="hd-corner bl" />
      <i className="hd-corner br" />
      {lines.map((raw) => {
        const cursor = rows.get(raw.row);
        const line = cursor ? stripCursor(raw) : raw;
        const label = (
          <>
            {line.text}
            {line.detail && <span className="hd-detail">{line.detail}</span>}
          </>
        );
        return (
          <div key={raw.row} className="hd-row">
            {cursor && <div className={`hd-pick ${cursor}`} style={place(box, line.col - 1, line.row, inner - line.col + 1)} />}
            {cursor && <div className={`hd-cursor ${cursor}`} style={place(box, line.col - 1, line.row)} />}
            {live && line.item !== undefined ? (
              <button
                type="button"
                className="hd-line hd-choice"
                style={place(box, line.col, line.row, inner - line.col)}
                onClick={() => live.select(line.item!)}
              >
                {label}
              </button>
            ) : (
              <div className="hd-line" style={place(box, line.col, line.row, inner - line.col)}>{label}</div>
            )}
          </div>
        );
      })}
      {dialog?.state === "waiting" && <div className="hd-more" style={place(box, 18, 16)} />}
      {live && menu?.kind === "list" && (
        <div className="hd-scroll">
          <button type="button" aria-label="Up" onClick={() => live.press("Up")}>▲</button>
          <button type="button" aria-label="Down" onClick={() => live.press("Down")}>▼</button>
        </div>
      )}
      {actions && quantity && (
        <div className="hd-scroll hd-quantity">
          <button type="button" aria-label="More" onClick={() => actions.press("Up")}>+</button>
          <button type="button" aria-label="Less" onClick={() => actions.press("Down")}>−</button>
          <button type="button" className="ok" onClick={() => actions.press("A")}>OK</button>
        </div>
      )}
      {(live || (actions && quantity)) && (
        <button type="button" className="hd-back" aria-label="Back" onClick={() => actions!.press("B")}>×</button>
      )}
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
function menuLines(menu: Menu): Line[] {
  return menu.items.map((item, index) => {
    const raw = menu.box.lines.find((l) => l.row === item.row);
    const col = raw ? stripCursor(raw).col : menu.box.x + 2;
    const cursor = menu.cursor !== null && menu.items[menu.cursor] === item;
    return { row: item.row, col: cursor ? col - 1 : col, text: `${cursor ? CURSOR.active : ""}${item.text}`, detail: item.detail, item: index };
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
