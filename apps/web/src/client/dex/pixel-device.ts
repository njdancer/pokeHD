// The Pokédex as pixel art, drawn here pixel by pixel (no outside art): the same handheld as the
// 3D one, at 90×140 pixels, in a few flat tones with a dark outline like the game's sprites.
// Two layers: the body (with the screen hole) and the cover, which flips open over it.

/** The screen is the Game Boy's: 20×18 of the game's 8-pixel letters at half the device's scale. */
export const PIXEL_DEVICE = { width: 90, height: 140, screen: { x: 5, y: 40, w: 80, h: 72 } } as const;

const OUTLINE = "#181010";
const RED = "#e03838";
const RED_SHADE = "#a82424";
const RED_LIGHT = "#f87868";
const BLUE = "#38a0f8";
const BLUE_DARK = "#1860c0";
const BLUE_LIGHT = "#b8e8ff";
const WHITE = "#f8f8f0";
const DARK = "#303038";

type Paint = (x: number, y: number, c: string) => void;

function canvas(w: number, h: number): [HTMLCanvasElement, Paint, CanvasRenderingContext2D] {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d")!;
  return [c, (x, y, colour) => ((ctx.fillStyle = colour), ctx.fillRect(x, y, 1, 1)), ctx];
}

/** Inside a rectangle with corners cut round to radius r (pixel-art rounding). */
function inRound(x: number, y: number, x0: number, y0: number, w: number, h: number, r: number): boolean {
  if (x < x0 || y < y0 || x >= x0 + w || y >= y0 + h) return false;
  const cx = Math.min(Math.max(x, x0 + r), x0 + w - 1 - r);
  const cy = Math.min(Math.max(y, y0 + r), y0 + h - 1 - r);
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r + r * 0.6;
}

/** Fills a shape, with a one-pixel outline and light on the top-left, shade on the bottom-right. */
function shade(paint: Paint, w: number, h: number, inside: (x: number, y: number) => boolean, fill: string, light: string, dark: string) {
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!inside(x, y)) continue;
      const edge = !inside(x - 1, y) || !inside(x + 1, y) || !inside(x, y - 1) || !inside(x, y + 1);
      if (edge) paint(x, y, OUTLINE);
      else if (!inside(x - 2, y) || !inside(x, y - 2)) paint(x, y, light);
      else if (!inside(x + 2, y) || !inside(x, y + 2) || !inside(x + 3, y)) paint(x, y, dark);
      else paint(x, y, fill);
    }
  }
}

function disc(paint: Paint, cx: number, cy: number, r: number, fill: string, light: string, dark: string) {
  const inside = (x: number, y: number) => (x - cx) ** 2 + (y - cy) ** 2 <= r * r + r * 0.5;
  for (let y = cy - r - 1; y <= cy + r + 1; y++) {
    for (let x = cx - r - 1; x <= cx + r + 1; x++) {
      if (!inside(x, y)) continue;
      const edge = !inside(x - 1, y) || !inside(x + 1, y) || !inside(x, y - 1) || !inside(x, y + 1);
      const d = Math.hypot(x - cx + r * 0.35, y - cy + r * 0.35);
      paint(x, y, edge ? OUTLINE : d < r * 0.35 ? light : Math.hypot(x - cx, y - cy) > r * 0.7 ? dark : fill);
    }
  }
}

/** The body: band with lens and lights, the screen's frame (the screen itself left clear), pad and buttons. */
export function drawPixelBody(): HTMLCanvasElement {
  const { width: w, height: h, screen: s } = PIXEL_DEVICE;
  const [c, paint, ctx] = canvas(w, h);
  shade(paint, w, h, (x, y) => inRound(x, y, 0, 0, w, h, 8), RED, RED_LIGHT, RED_SHADE);
  // Lens in its white ring, and the three lights.
  disc(paint, 22, 18, 13, WHITE, WHITE, "#c8c8c0");
  disc(paint, 22, 18, 10, BLUE, BLUE_LIGHT, BLUE_DARK);
  disc(paint, 44, 12, 3, "#f83030", "#ffb0a0", "#a01010");
  disc(paint, 53, 12, 3, "#f8d030", "#fff0b0", "#b08010");
  disc(paint, 62, 12, 3, "#40d050", "#c0ffc0", "#108020");
  // The screen's dark frame; the page goes in the hole.
  for (let y = s.y - 3; y < s.y + s.h + 3; y++) {
    for (let x = s.x - 3; x < s.x + s.w + 3; x++) {
      if (inRound(x, y, s.x - 3, s.y - 3, s.w + 6, s.h + 6, 3)) paint(x, y, DARK);
    }
  }
  ctx.clearRect(s.x, s.y, s.w, s.h);
  // D-pad, buttons and a grille.
  const py = 125;
  for (let i = -6; i <= 6; i++) {
    for (let j = -2; j <= 2; j++) {
      paint(20 + i, py + j, OUTLINE);
      paint(20 + j, py + i, OUTLINE);
    }
  }
  paint(19, py - 1, DARK);
  disc(paint, 64, py - 2, 4, BLUE, BLUE_LIGHT, BLUE_DARK);
  disc(paint, 75, py + 3, 4, BLUE, BLUE_LIGHT, BLUE_DARK);
  for (let i = 0; i < 4; i++) for (let x = 38; x < 50; x++) paint(x, py - 4 + i * 3, RED_SHADE);
  return c;
}

/** The cover, closed over the screen: stepped top edge, hinge on the left. */
export function drawPixelCover(): HTMLCanvasElement {
  const { width: w, height: h } = PIXEL_DEVICE;
  const [c, paint] = canvas(w, h);
  // Low (y 35) under the lens, a diagonal step, high (y 25) under the lights.
  const top = (x: number) => (x < 34 ? 35 : x > 44 ? 25 : 35 - (x - 34));
  const inside = (x: number, y: number) => inRound(x, y, 0, 0, w, h, 8) && y >= top(x) && x >= 0 && x < w;
  shade(paint, w, h, inside, RED, RED_LIGHT, RED_SHADE);
  // A raised line across it, and the hinge.
  for (let x = 8; x < w - 8; x++) paint(x, 118, RED_SHADE);
  for (let y = 40; y < h - 10; y++) paint(1, y, RED_SHADE);
  return c;
}
