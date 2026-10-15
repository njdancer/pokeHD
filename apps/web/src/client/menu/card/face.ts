// The trading card's printed side, drawn with canvas 2D: the colours (`face`) and, packed in a
// second image (`maps`), what the light needs: R the surface's height (raised border, frame and
// lettering, a recessed picture window), G where the foil is, B where it's metal. The shader
// (gl.ts) lights both. Card units: 630 × 880, the 63 × 88 mm of a real card, scaled to `width`.
import { TYPE_COLOUR, typeName } from "../env.tsx";

export const CARD_W = 630;
export const CARD_H = 880;

/** How the card is printed: a holo picture, foil everywhere but the picture, or all-over gold. */
export type Finish = "holo" | "reverse" | "gold";

export interface CardData {
  dex: number;
  name: string;
  /** "Mouse", as in the Mouse Pokémon. */
  kind: string;
  types: readonly string[];
  stats: { hp: number; attack: number; defense: number; speed: number; special: number };
  height: string;
  weight: string;
  words: string;
  /** Up to two moves to print, with the level each is learned at (0 from the start). */
  moves: readonly (readonly [string, number])[];
  /** PokeAPI's artwork (fetched live, CORS-enabled), if any. */
  art?: string;
  /** The cartridge's picture (a data URL), always there. */
  pixel: string;
}

export interface CardImages {
  face: HTMLCanvasElement;
  maps: HTMLCanvasElement;
}

const FONT = `Nunito, ui-rounded, "SF Pro Rounded", system-ui, sans-serif`;

function load(src: string, cors: boolean): Promise<HTMLImageElement | null> {
  return new Promise((done) => {
    const img = new Image();
    if (cors) img.crossOrigin = "anonymous";
    img.decoding = "async";
    img.onload = () => done(img);
    img.onerror = () => done(null);
    img.src = src;
  });
}

/** The artwork, CORS-clean so WebGL may read it. A copy cached without CORS headers (the dex grid's plain <img>) can refuse, so a second try asks the host afresh. */
async function loadArt(url: string): Promise<HTMLImageElement | null> {
  return (await load(url, true)) ?? (await load(`${url}?card`, true));
}

/** Both pictures a card can show: the artwork (null offline) and the cartridge's. */
export async function cardPictures(card: CardData): Promise<{ art: HTMLImageElement | null; pixel: HTMLImageElement | null }> {
  const [art, pixel] = await Promise.all([card.art ? loadArt(card.art) : null, card.pixel ? load(card.pixel, false) : null]);
  return { art, pixel };
}

const mix = (a: string, b: string, t: number) => {
  const p = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const x = p(a), y = p(b);
  return `rgb(${x.map((v, i) => Math.round(v + (y[i]! - v) * t)).join(",")})`;
};

function stops(g: CanvasGradient, list: [number, string][]) {
  for (const [at, colour] of list) g.addColorStop(at, colour);
}

function rounded(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  c.beginPath();
  c.roundRect(x, y, w, h, r);
}

/** Lines that fit `width`, at most `max`, the last cut with an ellipsis if the words run on. */
function wrap(c: CanvasRenderingContext2D, text: string, width: number, max: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (let i = 0; i < words.length; i++) {
    const next = line ? `${line} ${words[i]}` : words[i]!;
    if (c.measureText(next).width <= width) line = next;
    else {
      lines.push(line);
      line = words[i]!;
      if (lines.length === max) {
        let last = lines[max - 1]!;
        while (last && c.measureText(`${last}…`).width > width) last = last.slice(0, -1);
        lines[max - 1] = `${last.trimEnd()}…`;
        return lines;
      }
    }
  }
  if (line) lines.push(line);
  return lines;
}

// Where things sit, in card units.
const ART = { x: 50, y: 98, w: 530, h: 372 };
const RIBBON = { y: 482, h: 34 };
const WORDS = { x: 50, y: 742, w: 530, h: 92 };

/**
 * Draws the card's front at `width` pixels wide. Every part is drawn twice, once for colour and
 * once for the light (height, foil, metal), so the light follows the print exactly.
 */
export function drawFront(card: CardData, finish: Finish, pics: { art: HTMLImageElement | null; pixel: HTMLImageElement | null }, width: number): CardImages {
  const s = width / CARD_W;
  const w = Math.round(width), h = Math.round(CARD_H * s);
  const make = () => {
    const el = document.createElement("canvas");
    el.width = w;
    el.height = h;
    const c = el.getContext("2d")!;
    c.scale(s, s);
    return { el, c };
  };
  const face = make(), height = make(), foil = make(), metal = make();
  const f = face.c, hc = height.c, fc = foil.c, mc = metal.c;
  const type = card.types[0] ?? "NORMAL";
  const tc = TYPE_COLOUR[type] ?? "#a8a077";
  const gold = finish === "gold";
  const grey = (c: CanvasRenderingContext2D, v: number) => (c.fillStyle = c.strokeStyle = `rgb(${v},${v},${v})`);

  // Light maps start black: flat (well, low), no foil, no metal.
  for (const c of [hc, fc, mc]) {
    c.fillStyle = "#000";
    c.fillRect(0, 0, CARD_W, CARD_H);
  }

  // The card and its border.
  rounded(f, 0, 0, CARD_W, CARD_H, 30);
  f.save();
  f.clip();
  const edge = f.createLinearGradient(0, 0, CARD_W, CARD_H);
  if (gold) stops(edge, [[0, "#b8862b"], [0.45, "#f7dd8a"], [0.55, "#e8bf55"], [1, "#9c6d1f"]]);
  else stops(edge, [[0, "#f7d64a"], [1, "#e9b92a"]]);
  f.fillStyle = edge;
  f.fillRect(0, 0, CARD_W, CARD_H);
  grey(hc, 150);
  rounded(hc, 0, 0, CARD_W, CARD_H, 30);
  hc.fill();
  if (gold) {
    grey(mc, 255);
    rounded(mc, 0, 0, CARD_W, CARD_H, 30);
    mc.fill();
  }

  // The body, washed in the Pokémon's type.
  const body = f.createLinearGradient(0, 22, 0, CARD_H - 22);
  if (gold) stops(body, [[0, "#f3d98e"], [1, "#d8ac4c"]]);
  else stops(body, [[0, mix(tc, "#ffffff", 0.62)], [1, mix(tc, "#ffffff", 0.3)]]);
  f.fillStyle = body;
  rounded(f, 22, 22, CARD_W - 44, CARD_H - 44, 14);
  f.fill();
  // A fine print texture across the body, so it reads as card, not screen.
  f.save();
  f.clip();
  f.globalAlpha = gold ? 0.18 : 0.07;
  f.strokeStyle = gold ? "#7a5414" : "#ffffff";
  f.lineWidth = 2;
  for (let d = -CARD_H; d < CARD_W; d += 9) {
    f.beginPath();
    f.moveTo(d, 0);
    f.lineTo(d + CARD_H, CARD_H);
    f.stroke();
  }
  f.restore();
  grey(hc, 112);
  rounded(hc, 22, 22, CARD_W - 44, CARD_H - 44, 14);
  hc.fill();
  if (finish !== "holo") {
    grey(fc, gold ? 150 : 255);
    rounded(fc, 22, 22, CARD_W - 44, CARD_H - 44, 14);
    fc.fill();
  }

  // Name, HP and type.
  const ink = gold ? "#4a300c" : "#1f1a14";
  const both = (fn: (c: CanvasRenderingContext2D, isFace: boolean) => void) => {
    fn(f, true);
    fn(hc, false);
  };
  both((c, isFace) => {
    c.font = `900 40px ${FONT}`;
    c.textBaseline = "alphabetic";
    c.textAlign = "left";
    c.fillStyle = isFace ? ink : "rgb(165,165,165)";
    c.fillText(card.name, 46, 74, 360);
    c.textAlign = "right";
    c.font = `900 36px ${FONT}`;
    c.fillText(String(card.stats.hp), CARD_W - 92, 74);
    const hpW = c.measureText(String(card.stats.hp)).width;
    c.font = `900 17px ${FONT}`;
    c.fillText("HP", CARD_W - 98 - hpW, 74);
  });
  typeMark(f, hc, CARD_W - 64, 61, 20, type);

  // The picture window: a raised frame around a recessed picture.
  const win = (c: CanvasRenderingContext2D, grow = 0) => rounded(c, ART.x - grow, ART.y - grow, ART.w + grow * 2, ART.h + grow * 2, 6 + grow);
  const frame = f.createLinearGradient(ART.x, ART.y, ART.x + ART.w, ART.y + ART.h);
  stops(frame, [[0, "#fff4c4"], [0.35, "#c9a04a"], [0.65, "#f4dc92"], [1, "#a37b2c"]]);
  f.fillStyle = frame;
  win(f, 9);
  f.fill();
  grey(hc, 205);
  win(hc, 9);
  hc.fill();
  grey(mc, 255);
  win(mc, 9);
  mc.fill();
  // Inside: a backdrop the foil plays over (holo, gold), or a printed sky (reverse).
  const bg = f.createRadialGradient(ART.x + ART.w * 0.5, ART.y + ART.h * 0.62, 20, ART.x + ART.w * 0.5, ART.y + ART.h * 0.5, ART.w * 0.7);
  if (finish === "reverse") stops(bg, [[0, "#fffdf4"], [0.6, mix(tc, "#ffffff", 0.55)], [1, mix(tc, "#ffffff", 0.2)]]);
  else if (gold) stops(bg, [[0, "#fff1c0"], [1, "#c79a3c"]]);
  else stops(bg, [[0, mix(tc, "#ffffff", 0.7)], [0.7, mix(tc, "#b9c4d6", 0.35)], [1, mix(tc, "#4c5670", 0.35)]]);
  f.fillStyle = bg;
  win(f);
  f.fill();
  grey(hc, 78);
  win(hc);
  hc.fill();
  grey(mc, 0);
  win(mc);
  mc.fill();
  grey(fc, finish === "reverse" ? 0 : 255);
  win(fc);
  fc.fill();

  // The Pokémon, standing a little low in the window, with a soft shadow under it.
  const pic = pics.art ?? pics.pixel;
  if (pic) {
    const pixel = pic === pics.pixel;
    const room = { w: ART.w - 40, h: ART.h - 24 };
    let k = Math.min(room.w / pic.naturalWidth, room.h / pic.naturalHeight);
    if (pixel) k = Math.max(1, Math.floor(k * s)) / s; // whole pixels, so the cartridge's art stays crisp
    const pw = pic.naturalWidth * k, ph = pic.naturalHeight * k;
    const px = ART.x + (ART.w - pw) / 2, py = ART.y + ART.h - ph - (pixel ? 18 : 8);
    f.save();
    win(f);
    f.clip();
    const shadow = f.createRadialGradient(0, 0, 0, 0, 0, 1);
    stops(shadow, [[0, "#0005"], [1, "#0000"]]);
    f.setTransform(s * pw * 0.42, 0, 0, s * 22, s * (px + pw / 2), s * (ART.y + ART.h - 20));
    f.fillStyle = shadow;
    f.fillRect(-1, -1, 2, 2);
    f.setTransform(s, 0, 0, s, 0, 0);
    f.imageSmoothingEnabled = !pixel;
    f.drawImage(pic, px, py, pw, ph);
    f.restore();
    // The Pokémon is printed, not foiled, and stands a touch proud of the backdrop (its inked
    // lines too, from the picture's own shading, for a faint embossed feel).
    for (const [c, mode, v] of [[fc, "destination-out", 0], [hc, "source-over", 120]] as const) {
      c.save();
      win(c);
      c.clip();
      const tmp = document.createElement("canvas");
      tmp.width = Math.max(1, Math.round(pw * s));
      tmp.height = Math.max(1, Math.round(ph * s));
      const t = tmp.getContext("2d")!;
      t.imageSmoothingEnabled = !pixel;
      t.drawImage(pic, 0, 0, tmp.width, tmp.height);
      if (c === hc) {
        // Height from the picture's lightness: dark ink lines sit lower than the paint.
        const d = t.getImageData(0, 0, tmp.width, tmp.height);
        const a = d.data;
        for (let i = 0; i < a.length; i += 4) {
          const l = (a[i]! * 0.3 + a[i + 1]! * 0.59 + a[i + 2]! * 0.11) / 255;
          const g = Math.round(v + 30 * l);
          a[i] = a[i + 1] = a[i + 2] = g;
        }
        t.putImageData(d, 0, 0);
      }
      c.globalCompositeOperation = mode;
      c.imageSmoothingEnabled = !pixel;
      c.drawImage(tmp, px, py, pw, ph);
      c.restore();
    }
  }

  // The ribbon under the picture: number, kind, height and weight.
  const ribbon = f.createLinearGradient(0, RIBBON.y, CARD_W, RIBBON.y);
  stops(ribbon, [[0, "#d4ab52"], [0.5, "#fbe9a9"], [1, "#d4ab52"]]);
  f.fillStyle = ribbon;
  rounded(f, 76, RIBBON.y, CARD_W - 152, RIBBON.h, 8);
  f.fill();
  grey(hc, 150);
  rounded(hc, 76, RIBBON.y, CARD_W - 152, RIBBON.h, 8);
  hc.fill();
  grey(mc, 200);
  rounded(mc, 76, RIBBON.y, CARD_W - 152, RIBBON.h, 8);
  mc.fill();
  both((c, isFace) => {
    c.font = `italic 800 16px ${FONT}`;
    c.textAlign = "center";
    c.fillStyle = isFace ? "#4a330d" : "rgb(170,170,170)";
    c.fillText(`No. ${String(card.dex).padStart(3, "0")}   ${card.kind} Pokémon   HT ${card.height}   WT ${card.weight}`, CARD_W / 2, RIBBON.y + 23, CARD_W - 176);
  });

  // Two moves, as a card's attacks: its type's marks, the name, and when it's learned.
  const moves = card.moves.slice(0, 2);
  const rowH = 82, top = 532;
  moves.forEach(([move, level], i) => {
    const y = top + i * rowH;
    const marks = Math.min(3, 1 + Math.floor(level / 20));
    for (let m = 0; m < marks; m++) typeMark(f, hc, 64 + m * 30, y + 38, 13, type);
    both((c, isFace) => {
      c.textAlign = "left";
      c.font = `900 30px ${FONT}`;
      c.fillStyle = isFace ? ink : "rgb(160,160,160)";
      c.fillText(move, 168, y + 49, 300);
      c.textAlign = "right";
      c.font = `800 19px ${FONT}`;
      c.fillStyle = isFace ? mix(ink, "#ffffff", 0.25) : "rgb(140,140,140)";
      c.fillText(level === 0 ? "From the start" : `Level ${level}`, CARD_W - 52, y + 47);
    });
    f.fillStyle = gold ? "#8a601c55" : "#0000001f";
    f.fillRect(52, y + rowH - 4, CARD_W - 104, 2);
  });

  // Its strengths, along the bottom like a card's weakness row.
  const stats = [["Attack", card.stats.attack], ["Defence", card.stats.defense], ["Speed", card.stats.speed], ["Special", card.stats.special]] as const;
  stats.forEach(([label, v], i) => {
    const cx = 50 + (CARD_W - 100) * ((i + 0.5) / stats.length);
    both((c, isFace) => {
      c.textAlign = "center";
      c.font = `800 13px ${FONT}`;
      c.fillStyle = isFace ? mix(ink, "#ffffff", 0.3) : "rgb(130,130,130)";
      c.fillText(label, cx, 704);
      c.font = `900 20px ${FONT}`;
      c.fillStyle = isFace ? ink : "rgb(150,150,150)";
      c.fillText(String(v), cx, 728);
    });
  });

  // The Pokédex's words, in a framed box.
  f.fillStyle = gold ? "#fff2c8aa" : "#fffdf4cc";
  rounded(f, WORDS.x, WORDS.y, WORDS.w, WORDS.h, 8);
  f.fill();
  f.lineWidth = 2.5;
  f.strokeStyle = gold ? "#a77b28" : "#c9a04a";
  f.stroke();
  // Printed matte, so the words stay easy to read on any finish.
  grey(fc, 0);
  rounded(fc, WORDS.x, WORDS.y, WORDS.w, WORDS.h, 8);
  fc.fill();
  grey(hc, 150);
  hc.lineWidth = 3;
  rounded(hc, WORDS.x, WORDS.y, WORDS.w, WORDS.h, 8);
  hc.stroke();
  both((c, isFace) => {
    c.font = `italic 700 16.5px ${FONT}`;
    c.textAlign = "left";
    c.fillStyle = isFace ? "#3b3024" : "rgb(130,130,130)";
    wrap(c, card.words, WORDS.w - 28, 4).forEach((line, i) => c.fillText(line, WORDS.x + 14, WORDS.y + 24 + i * 20));
  });

  // The small print: where it's from, and its number in the set.
  both((c, isFace) => {
    c.font = `800 13px ${FONT}`;
    c.fillStyle = isFace ? (gold ? "#5a3c10" : "#5b4a1e") : "rgb(165,165,165)";
    c.textAlign = "left";
    c.fillText("pokeHD · Kanto", 46, CARD_H - 30);
    c.textAlign = "right";
    c.fillText(`${String(card.dex).padStart(3, "0")}/151 ${finish === "holo" ? "★" : finish === "gold" ? "★★" : "●"}`, CARD_W - 46, CARD_H - 30);
  });
  f.restore();

  return { face: face.el, maps: pack(height.el, foil.el, metal.el, s) };
}

/** A type's mark: a ringed coin in its colour with its first letter. */
function typeMark(f: CanvasRenderingContext2D, hc: CanvasRenderingContext2D, x: number, y: number, r: number, type: string) {
  const tc = TYPE_COLOUR[type] ?? "#a8a077";
  const g = f.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.1, x, y, r);
  stops(g, [[0, mix(tc, "#ffffff", 0.45)], [1, mix(tc, "#000000", 0.15)]]);
  f.fillStyle = g;
  f.beginPath();
  f.arc(x, y, r, 0, Math.PI * 2);
  f.fill();
  f.lineWidth = Math.max(2, r * 0.16);
  f.strokeStyle = "#ffffffd0";
  f.stroke();
  f.fillStyle = "#fff";
  f.font = `900 ${r * 1.15}px ${FONT}`;
  f.textAlign = "center";
  f.textBaseline = "middle";
  f.fillText(typeName(type)[0]!, x, y + r * 0.06);
  f.textBaseline = "alphabetic";
  hc.fillStyle = "rgb(190,190,190)";
  hc.beginPath();
  hc.arc(x, y, r, 0, Math.PI * 2);
  hc.fill();
}

/** The card's back: deep blue swirls around a big ball, with a raised rim. */
export function drawBack(width: number): CardImages {
  const s = width / CARD_W;
  const w = Math.round(width), h = Math.round(CARD_H * s);
  const mk = () => {
    const el = document.createElement("canvas");
    el.width = w;
    el.height = h;
    const c = el.getContext("2d")!;
    c.scale(s, s);
    return { el, c };
  };
  const face = mk(), height = mk(), foil = mk(), metal = mk();
  const f = face.c, hc = height.c;
  for (const c of [height.c, foil.c, metal.c]) {
    c.fillStyle = "#000";
    c.fillRect(0, 0, CARD_W, CARD_H);
  }
  rounded(f, 0, 0, CARD_W, CARD_H, 30);
  f.clip();
  f.fillStyle = "#1d3c8f";
  f.fillRect(0, 0, CARD_W, CARD_H);
  const cx = CARD_W / 2, cy = CARD_H / 2;
  const sky = f.createRadialGradient(cx, cy, 30, cx, cy, CARD_H * 0.62);
  stops(sky, [[0, "#6aa6ff"], [0.45, "#2a58c9"], [1, "#0e2463"]]);
  f.fillStyle = sky;
  rounded(f, 26, 26, CARD_W - 52, CARD_H - 52, 14);
  f.fill();
  hc.fillStyle = "rgb(165,165,165)";
  hc.fillRect(0, 0, CARD_W, CARD_H);
  hc.fillStyle = "rgb(110,110,110)";
  rounded(hc, 26, 26, CARD_W - 52, CARD_H - 52, 14);
  hc.fill();
  // Swirls: soft arms turning out from the middle.
  f.save();
  rounded(f, 26, 26, CARD_W - 52, CARD_H - 52, 14);
  f.clip();
  for (let arm = 0; arm < 7; arm++) {
    f.beginPath();
    for (let t = 0; t < 1; t += 0.01) {
      const a = arm * ((Math.PI * 2) / 7) + t * 4.2;
      const r = 60 + t * 420;
      const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r * 1.1;
      if (t === 0) f.moveTo(x, y);
      else f.lineTo(x, y);
    }
    f.lineWidth = 34;
    f.strokeStyle = "#9cc4ff22";
    f.stroke();
    f.lineWidth = 10;
    f.strokeStyle = "#cfe1ff26";
    f.stroke();
  }
  f.restore();
  // The ball, raised.
  const r = 150;
  f.save();
  f.beginPath();
  f.arc(cx, cy, r, 0, Math.PI * 2);
  f.clip();
  const red = f.createLinearGradient(0, cy - r, 0, cy);
  stops(red, [[0, "#ff6a5a"], [1, "#d42a22"]]);
  f.fillStyle = red;
  f.fillRect(cx - r, cy - r, r * 2, r);
  const white = f.createLinearGradient(0, cy, 0, cy + r);
  stops(white, [[0, "#ffffff"], [1, "#d4d8e2"]]);
  f.fillStyle = white;
  f.fillRect(cx - r, cy, r * 2, r);
  f.fillStyle = "#24242c";
  f.fillRect(cx - r, cy - 13, r * 2, 26);
  f.restore();
  f.lineWidth = 12;
  f.strokeStyle = "#24242c";
  f.beginPath();
  f.arc(cx, cy, r, 0, Math.PI * 2);
  f.stroke();
  f.fillStyle = "#24242c";
  f.beginPath();
  f.arc(cx, cy, 46, 0, Math.PI * 2);
  f.fill();
  f.fillStyle = "#f4f5f8";
  f.beginPath();
  f.arc(cx, cy, 30, 0, Math.PI * 2);
  f.fill();
  hc.fillStyle = "rgb(190,190,190)";
  hc.beginPath();
  hc.arc(cx, cy, r + 6, 0, Math.PI * 2);
  hc.fill();
  hc.fillStyle = "rgb(150,150,150)";
  hc.fillRect(cx - r, cy - 13, r * 2, 26);
  hc.fillStyle = "rgb(215,215,215)";
  hc.beginPath();
  hc.arc(cx, cy, 30, 0, Math.PI * 2);
  hc.fill();
  return { face: face.el, maps: pack(height.el, foil.el, metal.el, s) };
}

/** Height, foil and metal into one image's R, G and B; the height softened into bevels. */
function pack(height: HTMLCanvasElement, foil: HTMLCanvasElement, metal: HTMLCanvasElement, s: number): HTMLCanvasElement {
  const w = height.width, h = height.height;
  const read = (el: HTMLCanvasElement) => el.getContext("2d")!.getImageData(0, 0, w, h).data;
  const hd = read(height), fd = read(foil), md = read(metal);
  const hf = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) hf[i] = hd[i * 4]!;
  // Two box blurs ≈ a tent: edges become slopes about a card unit and a half wide.
  const r = Math.max(1, Math.round(1.6 * s));
  boxBlur(hf, w, h, r);
  boxBlur(hf, w, h, r);
  const out = document.createElement("canvas");
  out.width = w;
  out.height = h;
  const c = out.getContext("2d")!;
  const img = c.createImageData(w, h);
  const o = img.data;
  for (let i = 0; i < w * h; i++) {
    o[i * 4] = hf[i]!;
    o[i * 4 + 1] = fd[i * 4]!;
    o[i * 4 + 2] = md[i * 4]!;
    o[i * 4 + 3] = 255;
  }
  c.putImageData(img, 0, 0);
  return out;
}

function boxBlur(a: Float32Array, w: number, h: number, r: number) {
  const tmp = new Float32Array(Math.max(w, h));
  const n = r * 2 + 1;
  for (let y = 0; y < h; y++) {
    let sum = 0;
    for (let x = -r; x <= r; x++) sum += a[y * w + Math.min(w - 1, Math.max(0, x))]!;
    for (let x = 0; x < w; x++) {
      tmp[x] = sum / n;
      sum += a[y * w + Math.min(w - 1, x + r + 1)]! - a[y * w + Math.max(0, x - r)]!;
    }
    for (let x = 0; x < w; x++) a[y * w + x] = tmp[x]!;
  }
  for (let x = 0; x < w; x++) {
    let sum = 0;
    for (let y = -r; y <= r; y++) sum += a[Math.min(h - 1, Math.max(0, y)) * w + x]!;
    for (let y = 0; y < h; y++) {
      tmp[y] = sum / n;
      sum += a[Math.min(h - 1, y + r + 1) * w + x]! - a[Math.max(0, y - r) * w + x]!;
    }
    for (let y = 0; y < h; y++) a[y * w + x] = tmp[y]!;
  }
}
