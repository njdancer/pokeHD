// The HD text layer (p2-text): the game's text boxes and menus, decoded from its screen each
// frame, drawn over the HD world with a modern font. Boxes keep the places the game gives them on
// its 20×18 tile grid, scaled up on a stage sized for the device, so the game's layout (and every
// cursor move) carries over as it is. Only the look changes.
import { useMemo, type CSSProperties } from "react";
import { SCREEN_COLS, SCREEN_ROWS, type Menu, type ScreenText, type TextBox, type TextLine } from "@pokehd/emu";
import { CURSOR, type Glyph } from "@pokehd/rom";
import type { TextLook } from "./hd-text.ts";
import "./text-overlay.css";

interface Props {
  text: ScreenText;
  look: Exclude<TextLook, "off">;
  /** The ROM's glyphs, for the `pixel` look. */
  glyphs: readonly Glyph[];
}

export function TextOverlay({ text, look, glyphs }: Props) {
  const sheet = useMemo(() => (look === "pixel" ? glyphSheet(glyphs) : null), [look, glyphs]);
  const style = sheet ? ({ "--glyphs": `url(${sheet.url})`, "--glyph-count": sheet.count } as CSSProperties) : undefined;
  return (
    <div className="hd-text" data-look={look} data-testid="hd-text" aria-live="polite" style={style}>
      <div className="hd-text-stage">
        {text.boxes.filter((box, i) => !emptyUnder(box, text.boxes.slice(i + 1))).map((box) => (
          <Box key={`${box.x},${box.y},${box.width},${box.height}`} box={box} text={text} sheet={sheet} />
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

function Box({ box, text, sheet }: { box: TextBox; text: ScreenText; sheet: GlyphSheet | null }) {
  const menu = text.menus.find((m) => same(m.box, box));
  const dialog = text.dialog && same(text.dialog.box, box) ? text.dialog : null;
  const lines: Line[] = dialog ? dialogLines(dialog.lines, box) : menu && !sheet ? menuLines(menu) : box.lines;
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
              {sheet ? <PixelText text={line.text} sheet={sheet} /> : line.text}
              {line.detail && <span className="hd-detail">{sheet ? <PixelText text={line.detail} sheet={sheet} /> : line.detail}</span>}
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

/** The ROM's glyphs side by side in one image, drawn in the panel's ink. */
interface GlyphSheet {
  url: string;
  count: number;
  /** Index in the sheet by what a glyph reads as. */
  index: Map<string, number>;
  /** Longest glyph text, for splitting text back into tiles ("'d" is one tile). */
  longest: number;
}

const INK = [36, 36, 46];

function glyphSheet(glyphs: readonly Glyph[]): GlyphSheet | null {
  const chosen = new Map<string, Glyph>();
  for (const g of glyphs) if (g.char !== " " && !chosen.has(g.char)) chosen.set(g.char, g);
  const list = [...chosen.values()];
  const canvas = document.createElement("canvas");
  canvas.width = list.length * 8;
  canvas.height = 8;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  const image = ctx.createImageData(canvas.width, 8);
  list.forEach((g, i) => {
    for (let y = 0; y < 8; y++) {
      const lo = g.tile[y * 2]!;
      const hi = g.tile[y * 2 + 1]!;
      for (let x = 0; x < 8; x++) {
        const bit = 7 - x;
        // Colour 0 is the paper; anything darker is ink, shaded by how dark the game draws it.
        const shade = (((hi >> bit) & 1) << 1) | ((lo >> bit) & 1);
        if (shade === 0) continue;
        const p = (y * canvas.width + i * 8 + x) * 4;
        image.data.set([...INK, shade === 3 ? 255 : shade === 2 ? 200 : 120], p);
      }
    }
  });
  ctx.putImageData(image, 0, 0);
  return {
    url: canvas.toDataURL(),
    count: list.length,
    index: new Map(list.map((g, i) => [g.char, i])),
    longest: Math.max(...list.map((g) => g.char.length)),
  };
}

/** Text in the game's own letters, one tile per glyph, on the game's grid. */
function PixelText({ text, sheet }: { text: string; sheet: GlyphSheet }) {
  const tiles: (number | null)[] = [];
  for (let i = 0; i < text.length; ) {
    let n = Math.min(sheet.longest, text.length - i);
    while (n > 1 && !sheet.index.has(text.slice(i, i + n))) n--;
    tiles.push(sheet.index.get(text.slice(i, i + n)) ?? null);
    i += n;
  }
  return (
    <span className="hd-pixels" aria-label={text}>
      {tiles.map((t, i) => (
        <span key={i} className="hd-glyph" style={t === null ? undefined : ({ "--i": t } as CSSProperties)} data-blank={t === null || undefined} />
      ))}
    </span>
  );
}
